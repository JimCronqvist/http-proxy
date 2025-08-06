
export function copyHeaders(originalResponse, response, bufferedResponseBody = false) {
  // Set the status code
  response.status(originalResponse.statusCode);

  // Get all the headers
  let headerKeys = Object.keys(originalResponse.headers);

  // If we buffer - ignore chunked and compression headers
  if(bufferedResponseBody) {
    headerKeys = headerKeys.filter((key) => !['content-encoding', 'transfer-encoding'].includes(key));
  }

  // Set the headers on the response, and some minor modifications
  headerKeys.forEach((key) => {
    let value = originalResponse.headers[key];
    if(key === 'set-cookie') {
      // Remove cookie domain
      value = Array.isArray(value) ? value : [value];
      value = value.map((x) => x.replace(/Domain=[^;]+?/i, ''));
    }
    response.setHeader(key, value);
  });
}

export const timestamp = () => new Date().toISOString().split('.')[0] + 'Z';

export const realClientIP = (req) => {
  const rawIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.connection.remoteAddress;
  return rawIp.startsWith('::ffff:') ? rawIp.replace('::ffff:', '') : rawIp;
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
