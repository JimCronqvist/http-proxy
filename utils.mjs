
export function copyHeaders(originalResponse, response, bufferedResponseBody = false) {
  // Set the status code
  response.status(originalResponse.statusCode);

  // Get all the headers
  let headerKeys = Object.keys(originalResponse.headers);

  // If we buffer - ignore chunked and compression headers
  if(bufferedResponseBody) {
    headerKeys = headerKeys.filter((key) => !['content-encoding', 'transfer-encoding', 'content-length'].includes(key));
  }

  // Set the headers on the response, and some minor modifications
  headerKeys.forEach((key) => {
    let value = originalResponse.headers[key];
    if(key === 'set-cookie') {
      // Optionally remove cookie Domain attribute to avoid cross-domain issues
      const stripCookieDomain = env('STRIP_COOKIE_DOMAIN', true);
      if (stripCookieDomain) {
        value = Array.isArray(value) ? value : [value];
        value = value.map((x) =>
          x
            // remove '; Domain=...'
            .replace(/;\s*Domain=[^;]+/i, '')
            // remove leading 'Domain=...;'
            .replace(/^Domain=[^;]+;?\s*/i, '')
        );
      }
    }
    response.setHeader(key, value);
  });
}

export const timestamp = () => new Date().toISOString().split('.')[0] + 'Z';

export const realClientIP = (req) => {
  const raw =
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    req.ip ||
    '';
  if(raw === '::1') return '127.0.0.1';
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
};

export function env(key, defaultValue = null) {
  let value = process.env[key];

  if(value === undefined) {
    return defaultValue;
  }

  // Handle special string cases
  switch(value.toLowerCase().trim()) {
    case 'true':
    case '(true)':
      return true;
    case 'false':
    case '(false)':
      return false;
    case 'null':
    case '(null)':
      return null;
    case 'empty':
    case '(empty)':
      return '';
  }

  // Remove quotes if wrapped
  if((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // Parse numeric values
  if(!isNaN(value) && value.trim() !== '') {
    return Number(value);
  }

  return value;
}
