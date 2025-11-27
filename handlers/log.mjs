import { env, realClientIP } from '../utils.mjs';
//import getRawBody from 'raw-body'; // Something to test later, if we want to use it for raw body parsing. Need to handle stream errors then.

// Environment variables
const LOG_RESPONSE = env('LOG_RESPONSE', true);
const LOG_REQUEST  = env('LOG_REQUEST', false);
const LOG_RESPONSE_BODY = env('LOG_RESPONSE_BODY', false);
const LOG_REQUEST_BODY  = env('LOG_REQUEST_BODY', false);
const LOG_IP = env('LOG_IP', true);
const LOG_SINGLE_ROW = env('LOG_SINGLE_ROW', true);

export const onRequest = !LOG_REQUEST ? undefined : async (req, res) => {
  if(LOG_SINGLE_ROW) return;

  const ip = LOG_IP ? ` [${realClientIP(req)}]` : '';
  req.log.info(`Request:  ${req.method} ${req.url}${ip}`);

  if(!LOG_REQUEST_BODY) return;

  if(req.is('application/json') || req.is('application/x-www-form-urlencoded')) {
    req.log.info(`Request body:\n`+JSON.stringify(req.body, null, 2));
  } else if(req.is('text/plain')) {
    req.log.info(`Request body:\n`+req.body);
  }
};

export const onResponse = !LOG_RESPONSE ? undefined : async (req, res, payload, proxyRes) => {
  const ip = LOG_IP ? ` [${realClientIP(req)}]` : '';
  let msg = `Response: ${req.method} ${req.url} (${proxyRes.statusCode}) [${res.getHeader('X-Http-Proxy-Mode') || 'unknown'}] ${res.duration}ms${ip}`;
  if(!LOG_SINGLE_ROW) {
    req.log.info({ res }, msg);
  }

  let responsePayload = null;
  if(LOG_RESPONSE_BODY) {
    const contentType = (proxyRes.headers['content-type'] || '').split(';')[0].trim();
    if(contentType === 'application/json') {
      try {
        responsePayload = JSON.parse(payload);
      } catch(err) {
        req.log.warn({ res, err }, 'Failed to parse JSON response payload.');
        req.log.info({ res }, "Response body:\n"+payload);
        return;
      }
      if(!LOG_SINGLE_ROW) {
        req.log.info({ res }, "Response body:\n"+JSON.stringify(responsePayload, null, 2));
      }
    }
  }

  if(LOG_SINGLE_ROW) {
    const requestPayload = req.is('application/json') || req.is('application/x-www-form-urlencoded') || req.is('text/plain') ? req.body : null;

    if(msg.startsWith('Response: ')) {
      msg = msg.slice('Response: '.length);
    }
    if(LOG_REQUEST_BODY && requestPayload) {
      msg += `\nRequest body:\n${JSON.stringify(requestPayload, null, 2)}`;
    }
    if(LOG_RESPONSE_BODY && responsePayload) {
      msg += `\nResponse body:\n${JSON.stringify(responsePayload, null, 2)}`;
    }
    req.log.info({ res }, msg);
  }
};
