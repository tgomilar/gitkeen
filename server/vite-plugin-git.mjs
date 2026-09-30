/**
 * Exposes the RPC surface at POST /api/git during development.
 *
 * The desktop app runs the same handler (http.mjs) behind its own backend,
 * standalone.mjs, instead.
 */
import { handleRpc } from './http.mjs';

/**
 * The app and the API are served from the same origin during development, so
 * any browser POST here must come from the page that origin hosts. Browsers
 * put an `Origin` header on cross-origin requests: one that does not match
 * the host the request reached is some other page trying to drive this
 * backend (it can even smuggle a JSON body in as text/plain, which is why the
 * content type alone cannot be trusted). Clients that send no header, like
 * curl, use the API directly and are unaffected.
 */
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (origin === 'null') return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function gitApiPlugin() {
  return {
    name: 'gitkeen-git-api',
    configureServer(server) {
      server.middlewares.use('/api/git', async (req, res) => {
        if (!isSameOrigin(req)) {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 403;
          res.end(JSON.stringify({ error: { message: 'Cross-origin request rejected.' } }));
          return;
        }
        await handleRpc(req, res);
      });
    }
  };
}
