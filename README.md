# http-proxy 🔀

Is a simple HTTP proxy server written in NodeJS. It can be used to proxy requests to another server, allowing you to 
intercept and modify requests and responses.

This uses the 'http-proxy-middleware' and is designed to be lightweight and easy to use.

## Usage

```docker-compose
services:
  http-proxy:
    image: ghcr.io/jimcronqvist/http-proxy:latest
    container_name: http-proxy
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - UPSTREAM=http://service.svc.cluster.local:3000
```

## Environment Variables
| Variable                    | Description                                                     | Default                               | Required |
|----------------------------|-----------------------------------------------------------------|---------------------------------------|----------|
| `UPSTREAM`                 | The upstream server URL to proxy requests to                    | `http://host.docker.internal:3000`    | -        |
| `PORT`                     | The port the proxy server listens on                            | `8080`                                | -        |
| `ENABLE_TRACING`           | Enables OpenTelemetry tracing                                   | `false`                               | -        |
| `OTLP_GRPC_ENDPOINT`       | OTLP gRPC endpoint for trace export                             | `grpc://localhost:4317`               | -        |
| `HANDLER_FILE`             | The file to use as a request/response handler                   | `log.mjs`                             | -        |
| `GRACEFUL_SHUTDOWN_TIMEOUT`| Timeout for graceful shutdown in seconds                         | `10`                                   | -        |
| `ENABLE_PINO_AUTO_LOGGING` | Enables automatic logging of requests and responses             | `false`                               | -        |
| `PARSE_REQUEST_BODY`       | Parse incoming request bodies and expose them on `req.body`     | `false`                               | -        |
| `BUFFER_SIZE_MB`           | Max response buffer size before switching to streaming           | `1`                                    | -        |
| `PROXY_TIMEOUT`            | Upstream timeout in seconds (0/undefined means no timeout)      | `3600`                                | -        |
| `TIMEOUT`                  | Client timeout for full lifecycle in seconds (0=disabled)       | `3600`                                | -        |
| `LOG_HEALTH_CHECK`         | Log health check requests                                       | `false`                               | -        |
| `LOG_LEVEL`                | Pino log level                                                  | `info`                                | -        |
| `STRIP_COOKIE_DOMAIN`      | Strip `Domain` from `Set-Cookie` in responses (cookie bound to proxy host) | `true`                       | -        |

The handlers can also have their own environment variables, please refer to the specific handler file for more information (e.g. `handlers/log.mjs` has `LOG_REQUEST`, `LOG_RESPONSE`, `LOG_REQUEST_BODY`, `LOG_RESPONSE_BODY`, `LOG_IP`).

## Handlers

You can create custom request handlers to modify requests and responses. 
The default handler is `log.mjs`, which does some basic logging.

You can create your own handler by creating a file in the `handlers` directory and setting the `HANDLER_FILE` 
environment variable to the name of your file.

See for example [log.mjs](./handlers/log.mjs).

A handler file should export one or two functions.
- onRequest(req, res): This function is called when a request is received. You can modify the request here.
- onResponse(req, res): This function is called when a response is received. You can modify the response here.

Example:
```javascript
export function onRequest(req, res) {
    // Modify request here
    console.log(`Request to ${req.url}`);
}

export function onResponse(req, res, payload, proxyRes) {
    // Modify response here
    console.log(`Response from ${req.url}`);
}
```

## OpenTelemetry

If you want to use tracing, you can change the command like this:

```docker-compose
    command: node --import ./tracing.mjs app.mjs
```

or use the `ENABLE_TRACING` environment variable:
```docker-compose
    environment:
      - ENABLE_TRACING=true
```

## Response buffering vs streaming

- **Passthrough (no handler)**: If no `onResponse` is provided, responses are streamed directly to the client. Header `X-Http-Proxy-Mode: passthrough`.

- **With `onResponse`**:
  - The proxy decides to buffer or stream based on content type and size.
  - Buffering is attempted only for these content types: `application/json`, `application/xml`, `application/x-www-form-urlencoded`, `text/html`, `text/plain`, `text/xml`.
  - If the response has a known `content-length` less than or equal to `BUFFER_SIZE_MB` (in bytes), it is buffered; otherwise it streams.
  - If `content-length` is unknown, the proxy will start buffering and will automatically switch to streaming if the in-memory buffer exceeds `BUFFER_SIZE_MB`.
  - When streaming, `onResponse` is not called. When buffering completes, `onResponse(req, res, payload, proxyRes)` receives the buffered text payload.
  - Header `X-Http-Proxy-Mode` is set to `buffer` or `stream` accordingly.

- **Error handling**:
  - While streaming, any pipe errors return `502 Bad Gateway` if the response hasn’t been sent yet.
  - While buffering, errors inside `onResponse` return `500 Internal Server Error`.
  - Proxy transport errors are surfaced as `500 Internal Server Error` with a log entry.

## Cookie rewriting

By default (`STRIP_COOKIE_DOMAIN=true`), the proxy removes the `Domain` attribute from `Set-Cookie` headers in upstream responses. This causes the browser to scope cookies to the proxy’s host, which avoids cross-domain cookie issues when proxying.

- Set `STRIP_COOKIE_DOMAIN=false` to preserve the upstream `Domain` exactly as sent (useful when you intentionally need cross-domain/subdomain scoping).
