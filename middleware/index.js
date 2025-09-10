// middleware/index.js
import blockHiddenPaths from './blockHiddenPaths.js';
import filterExtensions from './filterExtensions.js';

/**
 * Run an Express-style middleware and resolve `true` if it
 * handled the response (sent headers) or passed an error,
 * otherwise resolve `false` so you can continue.
 *
 * Usage:
 *   if (await runMiddleware(req, res, blockHidden)) return;
 *   if (await runMiddleware(req, res, allowImages)) return;
 */
export async function runMiddleware(req, res, mw) {
  return new Promise((resolve) => {
    mw(req, res, (err) => {
      if (err) return resolve(true);
      return resolve(res.headersSent === true);
    });
  });
}

export {
  blockHiddenPaths,
  filterExtensions
};
