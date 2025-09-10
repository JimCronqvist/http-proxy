
/**
 * Blocks any request where ANY path segment starts with a dot (.)
 * This includes hidden files (e.g., /.env, /.gitignore)
 * and hidden folders (e.g., /.git, /config/.secret)
 * Matches at ANY depth in the path, case-insensitive.
 *
 * Use statusCode:
 * - 404 for stealth mode (default, pretend it doesn't exist)
 * - 400 for explicit rejection
 */

export default function blockHiddenPaths(options = {}) {
  const {
    statusCode = 404,
  } = options;

  const hiddenPathRegex = /(^|\/)\.[^\/]+/i;

  return (req, res, next) => {
    if (hiddenPathRegex.test(req.path)) {
      req.log.debug(`Blocked hidden path request: ${req.method} ${req.originalUrl}`);
      return res.sendStatus(statusCode);
    }
    next();
  };
}
