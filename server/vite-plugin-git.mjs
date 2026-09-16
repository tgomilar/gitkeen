/**
 * Exposes the RPC surface at POST /api/git during development.
 *
 * This file is the whole of the "web" transport. A Tauri build drops it and
 * registers the same method names as Rust commands instead.
 */
import { invokeMethod } from './api.mjs';

function readBody(req) {
  return new Promise((res, rej) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => res(data));
    req.on('error', rej);
  });
}

export function gitApiPlugin() {
  return {
    name: 'gitalia-git-api',
    configureServer(server) {
      server.middlewares.use('/api/git', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: { message: 'Use POST' } }));
          return;
        }
        let method = '(none)';
        try {
          const { method: m, args } = JSON.parse(await readBody(req));
          method = m;
          const result = await invokeMethod(m, args ?? {});
          res.end(JSON.stringify({ result }));
        } catch (err) {
          res.statusCode = 200; // the error travels in the envelope, not the status
          res.end(JSON.stringify({
            error: {
              message: err?.message ?? String(err),
              command: err?.command ?? null,
              method
            }
          }));
        }
      });
    }
  };
}
