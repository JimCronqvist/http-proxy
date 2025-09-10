import { env, realClientIP } from '../utils.mjs';
import { runMiddleware, blockHiddenPaths, filterExtensions } from '../middleware/index.js';

// Rewrites laravel-api image on-the-fly resizing query params to imgproxy path options and prefixes
// Example:
//   /file.jpg?id=123&width=300&height=400&type=crop&quality=80&format=webp
// → /insecure/resize:fill:300:400/format:webp/quality:80/plain/file.jpg?id=123

// Environment variables
const ENABLE_VIRTUAL_HOST_SOURCE_PREFIX = env('ENABLE_VIRTUAL_HOST_SOURCE_PREFIX', true);
const UPSTREAM = env('UPSTREAM');

const blockHiddenPathsMiddleware = blockHiddenPaths();
const filterExtensionsMiddleware = filterExtensions({
  mode: 'allow',
  extensions: ['jpg','jpeg','png','webp','avif','gif','tiff','bmp','svg','ico']
});

export const onRequest = async (req, res) => {
  // Only handle GET-like fetches to images
  if(req.method !== 'GET' && req.method !== 'HEAD') return;

  // Run a few express middlewares for filtering
  if(await runMiddleware(req, res, blockHiddenPathsMiddleware)) return;
  if(await runMiddleware(req, res, filterExtensionsMiddleware)) return;

  // Parse URL
  const parsed = new URL(req.url, req.scheme + '://' + req.headers.host);
  const pathname = parsed.pathname || '/';
  const params = parsed.searchParams;
  const host = parsed.hostname;

  // We don't care about the root path as that means no file is specified
  if(pathname === '/') {
    res.status(200).send('OK');
    return;
  }

  // Map laravel-api image on-the-fly resizing query params to imgproxy options
  const widthParam = params.get('width');
  const heightParam = params.get('height');
  const typeParam = params.get('type'); // 'crop'
  const qualityParam = params.get('quality');
  const formatParam = params.get('format');
  const presetParam = params.get('preset');

  // Map params to imgproxy options
  const options = [];
  const resizeType = typeParam === 'crop' ? 'fill' : 'fit';
  if(widthParam && heightParam) options.push(`resizing_type:${resizeType}`);
  if(widthParam)   options.push(`width:${Number(widthParam)}`);
  if(heightParam)  options.push(`height:${Number(heightParam)}`);
  if(qualityParam) options.push(`quality:${Number(qualityParam)}`);
  if(formatParam)  options.push(`format:${formatParam}`);
  if(presetParam)  options.push(`preset:${presetParam}`);
  
  // Remove consumed params
  ['width', 'height', 'type', 'quality', 'format', 'preset'].forEach((k) => params.delete(k));

  // Build source path mapping (virtual host as bucket name derived from hostname)
  let virtualHost = '';
  if(ENABLE_VIRTUAL_HOST_SOURCE_PREFIX) {
    const bucket = host && host.includes('.') ? host.split('.')[0] : host;
    virtualHost = bucket ? '/'+bucket : '';
  }

  // Construct the new path
  const optionPath = options.length ? `/${options.join('/')}` : '';
  const newPath = `/insecure${optionPath}/plain${virtualHost}${pathname}`;
  const remainingQuery = params.toString();
  const finalUrl = remainingQuery ? `${newPath}?${remainingQuery}` : newPath;

  // Log the rewrite
  req.log.info(`Rewriting http(s)://${host}${req.url} -> ${UPSTREAM}${finalUrl} [${realClientIP(req)}]`);

  // Apply rewrite
  req.url = finalUrl;
};
