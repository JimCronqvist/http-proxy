if (process.env.ENABLE_TRACING === 'true') {
  await import('./tracing.mjs');
}

import express from 'express';
import pinoHttp from 'pino-http';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { copyHeaders, env } from './utils.mjs';

console.log('http-proxy server starting...');

let handlerFile = process.env.HANDLER_FILE || 'log.mjs';
if(!handlerFile.includes('/')) {
  handlerFile = `./handlers/${handlerFile}`;
}
console.debug('http-proxy using handler file:', handlerFile);
const { onRequest, onResponse } = await import(handlerFile);

const UPSTREAM = process.env.UPSTREAM || 'http://host.docker.internal:3000';
const MAX_BUFFER_SIZE = env('BUFFER_SIZE_MB', 1) * 1024 * 1024;
const BUFFERABLE_CONTENT_TYPES = [
  'application/json',
  'application/xml',
  'application/x-www-form-urlencoded',
  'text/html',
  'text/plain',
  'text/xml',
];

const ENABLE_PINO              = env('ENABLE_PINO', false);
const ENABLE_PINO_AUTO_LOGGING = env('ENABLE_PINO_AUTO_LOGGING', true);
const PARSE_RESPONSE_BODY      = env('PARSE_RESPONSE_BODY', true);
const LOG_HEALTH_CHECK         = env('LOG_HEALTH_CHECK', false);
const PROXY_TIMEOUT            = env('PROXY_TIMEOUT', 0); // upstream timeout, no timeout by default (note: if streaming, clients will slow down the response)
const CLIENT_TIMEOUT           = env('TIMEOUT', 0); // client timeout, no timeout by default

const app = express();
app.set('trust proxy', true); // Sets the 'req.ip' to the real client IP when behind a reverse proxy

// Health check endpoint
app.get('/health', (req, res) => {
  if(LOG_HEALTH_CHECK) {
    console.debug('http-proxy GET /health');
  }
  res.status(200).end('OK');
});

if(ENABLE_PINO) {
  const logger = pinoHttp({
    autoLogging: ENABLE_PINO_AUTO_LOGGING,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  });
  app.use(logger);
}

if(onRequest) {
  app.use(async (req, res, next) => {
    await onRequest(req, res);
    next();
  });
}

if(onResponse && PARSE_RESPONSE_BODY) {
  app.use(express.json({ strict: true })); // Parse JSON body
  app.use(express.urlencoded({ extended: true })); // Parse URL-encoded body
}

app.use('/', createProxyMiddleware({
  target: UPSTREAM,
  changeOrigin: true,
  proxyTimeout: (PROXY_TIMEOUT ? PROXY_TIMEOUT*1000 : undefined), // Use the PROXY_TIMEOUT env variable if set, default: no timeout.
  timeout: (CLIENT_TIMEOUT ? CLIENT_TIMEOUT*1000 : undefined), // Use the CLIENT_TIMEOUT env variable if set, default: no timeout.
  preserveHeaderKeyCase: true,
  xfwd: true,
  //logger: console,
  selfHandleResponse: Boolean(onResponse),

  on: {
    proxyReq: (proxyReq, req) => {
      req.startTime = Date.now();
      // Disable upstream compression to ensure accurate content-length
      proxyReq.setHeader('Accept-Encoding', 'identity');
    },

    proxyRes: (proxyRes, req, res) => {
      res.duration = Date.now() - req.startTime;

      if (!onResponse) {
        copyHeaders(proxyRes, res, false);
        res.setHeader('X-Http-Proxy-Mode', 'passthrough');
        proxyRes.pipe(res);
        return;
      }

      const contentType = (proxyRes.headers['content-type'] || 'text/html').split(';')[0].trim();
      const contentLength = parseInt(proxyRes.headers['content-length'], 10) || 0;
      //console.log('Content-Type:', contentType, contentLength);

      const shouldBuffer =
        BUFFERABLE_CONTENT_TYPES.includes(contentType) &&
        (!isNaN(contentLength) && contentLength <= MAX_BUFFER_SIZE);

      if(shouldBuffer) {
        res.setHeader('X-Http-Proxy-Mode', 'buffer');

        let buffer = Buffer.from([]);

        proxyRes.on('data', chunk => {
          buffer = Buffer.concat([buffer, chunk]);

          // Do we get problems with chunked transfer here? can we skip if the content-length is set? or chunked?
          // buffer full at that time anyway? memory leak issue?
          if(buffer.length > MAX_BUFFER_SIZE) {
            console.warn(`Response exceeded ${MAX_BUFFER_SIZE} bytes, switching to streaming. onResponse() won't be called.`);
            copyHeaders(proxyRes, res, true);
            res.write(buffer);
            proxyRes.pipe(res);
            proxyRes.removeAllListeners('data');
            proxyRes.removeAllListeners('end');
          }
        });

        proxyRes.on('end', async () => {
          try {
            const payload = buffer.toString();
            const modifiedBody = await onResponse(req, res, payload, proxyRes);
            copyHeaders(proxyRes, res, true);
            res.send(modifiedBody || buffer);
          } catch(err) {
            console.error('Error in onResponse:', err);
            res.status(500).send('Internal Server Error');
          }
        });
      } else {
        res.setHeader('X-Http-Proxy-Mode', 'stream');
        copyHeaders(proxyRes, res);
        proxyRes.pipe(res);
      }
    },

    error: (err, req, res) => {
      console.error('Proxy error:', err);
      if (res.headersSent) {
        res.end('Internal Server Error');
      } else {
        res.status(500).send('Internal Server Error');
      }
    },
  },
}));

// Global Express error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('Internal Server Error');
});

// Start server
const port = process.env.PORT || 8080;
const server = app.listen(port, () => {
  console.log(`http-proxy listening on port ${port}. Proxy upstream: '${UPSTREAM}'`);
});

app.on('error', (err) => {
  console.error('Express app error:', err);
});

server.on('error', (err) => {
  console.error('HTTP Server error:', err);
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`Received ${signal}. Shutting down server gracefully...`);
  server.close(() => {
    console.log(`Server closed gracefully, due to ${signal}.`);
    process.exit(signal.startsWith('SIG') ? 0 : 1);
  });
  // Force shutdown after 10 seconds if not closed
  const GRACEFUL_SHUTDOWN_TIMEOUT = env('GRACEFUL_SHUTDOWN_TIMEOUT', 10);
  setTimeout(() => {
    console.error(`Forcing shutdown after ${GRACEFUL_SHUTDOWN_TIMEOUT}s...`);
    process.exit(1);
  }, GRACEFUL_SHUTDOWN_TIMEOUT*1000);
};

// Node process error handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  gracefulShutdown('uncaughtException'); // Shutdown (exit) to prevent an unstable state
});

// Handle unhandled promise rejections (async errors outside Express)
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection'); // Shutdown (exit) to prevent an unstable state
});

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
