/**
 * The one HTTP handler for the RPC surface, `POST /api/git`, shared by the
 * dev server (vite-plugin-git.mjs) and the desktop app's backend
 * (standalone.mjs). Each decides who may call it before handing over.
 */
import { invokeMethod } from './api.mjs';

/** Bodies are small JSON: a bundle import is the largest, and is capped. */
const MAX_BODY = 200 * 1024 * 1024;

function readBody(req) {
  return new Promise((res, rej) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { req.destroy(); rej(new Error('The request is too large.')); return; }
      chunks.push(c);
    });
    req.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rej);
  });
}

/** Answer one RPC request. The caller has already decided it may be served. */
export async function handleRpc(req, res) {
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
      error: { message: err?.message ?? String(err), command: err?.command ?? null, method }
    }));
  }
}
