
/**
 * Middleware to filter requests based on file extensions.
 *
 * Options:
 * - mode: 'block' or 'allow'
 *   • 'block' → reject requests if extension is in the list
 *   • 'allow' → reject requests unless extension is in the list
 * - extensions: array of extensions (e.g., ['jpg','png','webp'])
 * - statusCode: HTTP status to return (default 400; use 404 for stealth mode)
 * - caseInsensitive: whether to normalize extensions to lowercase (default true)
 * - allowNoExtension: allow requests without extensions (default true)
 *
 * Examples:
 *   // Block risky extensions
 *   app.use(filterExtensions({ mode: 'block', extensions: ['map','log'], statusCode: 404 }));
 *
 *   // Allow only images
 *   app.use(filterExtensions({ mode: 'allow', extensions: ['jpg','png'], allowNoExtension: false }));
 */

export default function filterExtensions(options = {}) {
  const {
    mode = 'block',               // 'block' or 'allow'
    extensions = [],              // e.g. ['map','log'] or ['jpg','png']
    statusCode = 404,             // 400 loud, 404 stealth
    caseInsensitive = true,
    allowNoExtension = true       // e.g. /images/123 (no .ext)
  } = options;

  const normalize = caseInsensitive
    ? (s) => String(s).toLowerCase()
    : (s) => String(s);

  const extSet = new Set(extensions.map(normalize));

  function getExtension(pathname) {
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length === 0) return '';
    const last = segments[segments.length - 1];
    const dot = last.lastIndexOf('.');
    if (dot <= 0) return ''; // no ext or dotfile like ".env"
    return last.slice(dot + 1);
  }

  return (req, res, next) => {
    const ext = getExtension(req.path);
    const key = normalize(ext);

    if (!ext) {
      if (mode === 'allow' && !allowNoExtension) {
        req.log.debug(`Blocked no-extension path: ${req.method} ${req.originalUrl}`);
        return res.sendStatus(statusCode);
      }
      return next();
    }

    if (mode === 'block') {
      if (extSet.has(key)) {
        req.log.debug(`Blocked extension .${ext}: ${req.method} ${req.originalUrl}`);
        return res.sendStatus(statusCode);
      }
      return next();
    }

    // mode === 'allow'
    if (!extSet.has(key)) {
      req.log.debug(`Blocked non-allowed extension .${ext}: ${req.method} ${req.originalUrl}`);
      return res.sendStatus(statusCode);
    }
    next();
  };
}
