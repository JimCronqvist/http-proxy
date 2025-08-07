if (process.env.ENABLE_TRACING === 'true') {
  await import('./tracing.mjs');
}

import { pipeline } from 'stream';
import express from 'express';
import pinoHttp from 'pino-http';
import pino from 'pino';
//import pretty from 'pino-pretty';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { copyHeaders, env } from './utils.mjs';
const isProduction = env('NODE_ENV', 'production') === 'production';

const logger = pino({
  level: env('LOG_LEVEL', 'info'),
  transport: env('NODE_ENV', 'production') === 'production' ? undefined : {
    target: 'pino-pretty',
    options: {
      colorize: true, // pretty.isColorSupported || !isProduction
      translateTime: 'yyyy-mm-dd HH:MM:ss.l o',
      //messageFormat: '[{time}] {levelLabel}: {msg}',
      ignore: 'pid,hostname',
      singleLine: true,
    }
  }
}, isProduction ? undefined : pino.destination({ sync: true }));

logger.info('http-proxy server starting...');

let handlerFile = process.env.HANDLER_FILE || 'log.mjs';
if(!handlerFile.includes('/')) {
  handlerFile = `./handlers/${handlerFile}`;
}
logger.info('http-proxy using handler file:', handlerFile);
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

const ENABLE_PINO_AUTO_LOGGING = env('ENABLE_PINO_AUTO_LOGGING', false);
const PARSE_REQUEST_BODY       = env('PARSE_REQUEST_BODY', false); // If true, the request body will be parsed and available in req.body
const LOG_HEALTH_CHECK         = env('LOG_HEALTH_CHECK', false);
const PROXY_TIMEOUT            = env('PROXY_TIMEOUT', 3600); // upstream timeout, no timeout by default (note: if streaming, clients will slow down the response)
const CLIENT_TIMEOUT           = env('TIMEOUT', 3600); // client timeout for the entire lifecycle (request + response), no timeout by default

const app = express();
app.set('trust proxy', true); // Sets the 'req.ip' to the real client IP when behind a reverse proxy

// Health check endpoint
app.get('/health', (req, res) => {
  if(LOG_HEALTH_CHECK) {
    logger.debug('http-proxy GET /health');
  }
  res.status(200).end('OK');
});

app.use(pinoHttp({
  logger: logger,
  quietReqLogger: true,
  quietResLogger: true,
  autoLogging: ENABLE_PINO_AUTO_LOGGING,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      //'reqId',
    ],
    remove: !isProduction,
  }
}));

if(onRequest && PARSE_REQUEST_BODY) {
  // Parse JSON request body
  app.use(express.json({
    strict: true,
    verify: (req, res, buf) => req.rawBody = buf, // Preserve the raw request body so the proxy can forward it upstream
  }));
  // Parse URL-encoded request body
  app.use(express.urlencoded({
    extended: true,
    verify: (req, res, buf) => req.rawBody = buf, // Preserve the raw request body so the proxy can forward it upstream
  }));
}

if(onRequest) {
  app.use(async (req, res, next) => {
    await onRequest(req, res);
    if(!res.headersSent && !res.writableEnded) {
      next();
    }
  });
}

app.use('/', createProxyMiddleware({
  target: UPSTREAM,
  changeOrigin: true,
  proxyTimeout: (PROXY_TIMEOUT ? PROXY_TIMEOUT*1000 : undefined), // Use the PROXY_TIMEOUT env variable if set, default: 1 hour (effectively no timeout).
  timeout: (CLIENT_TIMEOUT ? CLIENT_TIMEOUT*1000 : undefined), // Use the CLIENT_TIMEOUT env variable if set, default: 1 hour (effectively no timeout).
  preserveHeaderKeyCase: true,
  xfwd: true,
  //logger: console,
  pathFilter: [
    '!/.well-known/appspecific/com.chrome.devtools.json', // Exclude Chrome DevTools path
  ],
  selfHandleResponse: true, // We handle the response ourselves in the proxyRes event.

  on: {
    proxyReq: (proxyReq, req) => {
      req.startTime = Date.now();
      // Disable upstream compression to ensure accurate content-length
      proxyReq.setHeader('Accept-Encoding', 'identity');

      // If we have consumed the request stream, we need to set the content-length header and send the body ourselves.
      // This is also useful and required when we have modified the request body in onRequest.
      if(req.rawBody) {
        req.log.debug(`Sending request body of ${req.rawBody.length} bytes to upstream`);
        proxyReq.setHeader('Content-Length', req.rawBody.length);
        proxyReq.end(req.rawBody);
      }
      req.log.debug(`Proxying request to upstream: ${proxyReq.method} ${proxyReq.url}`);
    },

    proxyRes: (proxyRes, req, res) => {
      res.duration = Date.now() - req.startTime; // ttfb for the proxy request's response.

      // Helper for streaming the response to the client
      const pipe = (proxyRes, res, proxyMode) => {
        res.log.debug(`Piping response to client (${proxyMode})`);
        pipeline(proxyRes, res, (err) => {
          const fullDuration = Date.now() - req.startTime;
          if(err) {
            res.log.error({ err }, `Error piping response (${proxyMode})`);
            if(!res.headersSent) {
              res.status(502).send('Bad Gateway');
            }
          } else {
            res.log.debug(`Piped response for ${req.method} ${req.url} (${proxyRes.statusCode}) in ${fullDuration}ms`);
          }
        });
      };

      // If we don't have an onResponse handler, we can just pass through the response
      if(!onResponse) {
        copyHeaders(proxyRes, res);
        res.setHeader('X-Http-Proxy-Mode', 'passthrough');
        pipe(proxyRes, res, 'passthrough');
        return;
      }

      // If we have an onResponse handler, we need to check if we should buffer the response
      const contentType = (proxyRes.headers['content-type'] || 'text/html').split(';')[0].trim();
      const contentLength = parseInt(proxyRes.headers['content-length'], 10) || 0;
      const shouldBuffer = BUFFERABLE_CONTENT_TYPES.includes(contentType) && (!isNaN(contentLength) && contentLength <= MAX_BUFFER_SIZE);

      // If we should NOT buffer the response, we can stream it directly
      if(!shouldBuffer) {
        // If we are not buffering, we can stream the response directly
        req.log.debug('Should not buffer, streaming response for', req.method, req.url, `(${contentType}, ${contentLength} bytes)`);
        res.setHeader('X-Http-Proxy-Mode', 'stream');
        copyHeaders(proxyRes, res);
        pipe(proxyRes, res, 'stream');
        return;
      }

      // We should buffer the response
      req.log.debug(`Buffering response for ${req.method} ${req.url} (${contentType}, ${contentLength} bytes)`);
      res.setHeader('X-Http-Proxy-Mode', 'buffer');
      let buffer = Buffer.from([]);
      let switchedToStreaming = false;

      const onData = (chunk) => {
        if(switchedToStreaming) return;
        buffer = Buffer.concat([buffer, chunk]);

        // Do we get problems with chunked transfer here? can we skip if the content-length is set? or chunked?
        // buffer full at that time anyway? memory leak issue?
        req.log.debug(`Received ${chunk.length} bytes, total buffer size: ${buffer.length} bytes`);
        if(buffer.length > MAX_BUFFER_SIZE) {
          switchedToStreaming = true;
          req.log.warn(`Response exceeded ${MAX_BUFFER_SIZE} bytes, switching to streaming. onResponse() won't be called.`);
          copyHeaders(proxyRes, res, true);
          res.write(buffer); // Write the buffered data so far to the response before switching to streaming
          // Remove current listeners to avoid double-handling
          proxyRes.removeListener('data', onData);
          proxyRes.removeListener('end', onEnd);
          // Pipe the rest of the response directly to the client
          pipe(proxyRes, res, 'buffer-stream'); // Stream the rest of the response
        }
      };

      const onEnd = async () => {
        if(switchedToStreaming) return;
        try {
          const payload = buffer.toString();
          const modifiedBody = await onResponse(req, res, payload, proxyRes);
          copyHeaders(proxyRes, res, true);
          res.send(modifiedBody || buffer);
        } catch(err) {
          req.log.error({ err }, 'Error in onResponse handler:');
          res.status(500).send('Internal Server Error');
        }
      };

      // Attach listeners to the proxy response
      proxyRes.on('data', onData);
      proxyRes.on('end', onEnd);
    },

    error: (err, req, res) => {
      logger.error({ err }, 'Proxy error');
      if(res.headersSent) {
        res.end('Internal Server Error. Reason: ' + (err.message || 'Unknown error'));
      } else {
        res.status(500).send('Internal Server Error. Reason: ' + (err.message || 'Unknown error'));
      }
    },
  },
}));

// Global Express error handler
app.use((err, req, res, next) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).send('Internal Server Error');
});

// Start server
const port = process.env.PORT || 8080;
const server = app.listen(port, () => {
  logger.info(`http-proxy listening on port ${port}. Proxy upstream: '${UPSTREAM}'`);
});

server.on('error', (err) => {
  logger.error({ err }, 'HTTP Server error');
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}. Shutting down server gracefully...`);
  server.close(() => {
    logger.info(`Server closed gracefully, due to ${signal}.`);
    process.exit(signal.startsWith('SIG') ? 0 : 1);
  });
  // Force shutdown after 10 seconds if not closed
  const GRACEFUL_SHUTDOWN_TIMEOUT = env('GRACEFUL_SHUTDOWN_TIMEOUT', 10);
  setTimeout(() => {
    logger.error(`Forcing shutdown after ${GRACEFUL_SHUTDOWN_TIMEOUT}s...`);
    process.exit(1);
  }, GRACEFUL_SHUTDOWN_TIMEOUT*1000);
};

// Node process error handlers
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught Exception');
  gracefulShutdown('uncaughtException'); // Shutdown (exit) to prevent an unstable state
});

// Handle unhandled promise rejections (async errors outside Express)
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection'); // Shutdown (exit) to prevent an unstable state
});

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
