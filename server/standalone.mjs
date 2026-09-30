/**
 * The Git backend as its own program, for the desktop app.
 *
 * The app starts this, reads the port it prints, and sends every call here
 * with a secret it chose for this run. The server listens on 127.0.0.1
 * only, and answers nothing without that secret, so neither another program
 * on the computer nor a web page can drive Git through it.
 *
 * It exits when its standard input closes, which is what happens when the
 * app that started it goes away, so no backend is ever left running alone.
 */
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { handleRpc } from './http.mjs';

const secret = process.env.GITALIA_SECRET ?? '';
if (secret.length < 32) {
  process.stderr.write('GITALIA_SECRET must be set to at least 32 characters.\n');
  process.exit(2);
}
const expected = Buffer.from(secret);

function authorised(req) {
  const given = Buffer.from(String(req.headers['x-gitalia-secret'] ?? ''));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const server = createServer(async (req, res) => {
  if (req.url !== '/api/git' || !authorised(req)) {
    res.statusCode = 404;
    res.end();
    return;
  }
  await handleRpc(req, res);
});

server.listen(0, '127.0.0.1', () => {
  // The app waits for this one line to learn where to send calls.
  process.stdout.write(`GITALIA_BACKEND_PORT=${server.address().port}\n`);
});

process.stdin.resume();
process.stdin.on('end', () => process.exit(0));
process.stdin.on('close', () => process.exit(0));
