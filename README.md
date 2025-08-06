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
| Variable                    | Description                                                    | Default | Required |
|-----------------------------|----------------------------------------------------------------|---------|----------|
| `UPSTREAM`                  | The upstream server url to proxy requests to                   | `3000`  | -        |
| `PORT`                      | The port the proxy server is listening on                      | `8080`  | Yes      |
| `ENABLE_TRACING`            | Enables OpenTelemetry tracing                                  | `false` | -        |
| `HANDLER_FILE`              | The file to use as a request handler                           | log.mjs | -        |
| `GRACEFUL_SHUTDOWN_TIMEOUT` | The timeout for graceful shutdown in seconds                   | `10`    | -        |
| `ENABLE_PINO`               | Adds Pino logging to Express                                   | `false` | -        |
| `ENABLE_PINO_AUTO_LOGGING`  | Enables automatic logging of requests and responses            | `true`  | -        |
| `PARSE_RESPONSE_BODY`       | Enables parsing of response bodies for the onResponse handler  | `false` | -        |

The handlers can also have their own environment variables, please refer to the specific handler file for more information.

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

### OpenTelemetry

If you want to use tracing, you can change the command like this:

```docker-compose
    command: node --import ./tracing.mjs app.mjs
```

or use the `ENABLE_TRACING` environment variable:
```docker-compose
    environment:
      - ENABLE_TRACING=true
```
