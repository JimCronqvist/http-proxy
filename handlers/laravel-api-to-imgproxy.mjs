import { env, realClientIP } from '../utils.mjs';

// Rewrites laravel-api image on-the-fly resizing query params to imgproxy path options and prefixes
// Example:
//   /file.jpg?id=123&width=300&height=400&type=crop&quality=80&format=webp
// → /insecure/resize:fill:300:400/format:webp/quality:80/plain/file.jpg?id=123

export const onRequest = async (req, res) => {
  // Only handle GET-like fetches to images
  if(req.method !== 'GET' && req.method !== 'HEAD') return;

  // Parse URL
  const parsed = new URL(req.url, 'http://localhost');
  const pathname = parsed.pathname || '/';
  const params = parsed.searchParams;

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

  // Map params to imgproxy options
  const options = [];
  const resizeType = typeParam === 'crop' ? 'fill' : 'fit';
  if(widthParam && heightParam) options.push(`resizing_type:${resizeType}`);
  if(widthParam)   options.push(`width:${Number(widthParam)}`);
  if(heightParam)  options.push(`height:${Number(heightParam)}`);
  if(qualityParam) options.push(`quality:${Number(qualityParam)}`);
  if(formatParam)  options.push(`format:${formatParam}`);

  // Remove consumed params
  ['width', 'height', 'type', 'quality', 'format'].forEach((k) => params.delete(k));

  // Construct the new path
  const optionPath = options.length ? `/${options.join('/')}` : '';
  const newPath = `/insecure${optionPath}/plain${pathname}`;
  const remainingQuery = params.toString();
  const finalUrl = remainingQuery ? `${newPath}?${remainingQuery}` : newPath;

  // Log the rewrite
  req.log.info(`Rewriting ${req.url} -> ${finalUrl} [${realClientIP(req)}]`);

  // Apply rewrite
  req.url = finalUrl;
};
