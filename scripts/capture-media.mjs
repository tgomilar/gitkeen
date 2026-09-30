// Make the screenshots and GIFs in docs/media from the demo repository.
//
//   node scripts/capture-media.mjs [scene ...]
//
// Needs Node 22 or newer (for WebSocket), Google Chrome and ffmpeg. It starts
// the dev server and a headless Chrome, rebuilds the demo repository before
// each scene with scripts/demo-repo.sh, and drives the real app. Headless
// Chrome draws no mouse pointer, so the page gets one that moves to each click.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'docs/media');
const WORK = mkdtempSync(join(tmpdir(), 'gitkeen-media-'));
const REPO = join(WORK, 'lumen');
const PORT = 5391;
const CDP_PORT = 9334;
const MODEL_PORT = 9335;
const WIDTH = 1280;
const HEIGHT = 760;
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check, what, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await check()) return; } catch { /* not yet */ }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

// ---- Chrome DevTools Protocol ---------------------------------------------

let ws;
let nextId = 0;
const pending = new Map();
const listeners = new Map();

async function connect() {
  const pages = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
  ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { ok, fail } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? fail(new Error(m.error.message)) : ok(m.result);
    } else if (m.method) listeners.get(m.method)?.(m.params);
  });
}

function send(method, params = {}) {
  return new Promise((ok, fail) => {
    const id = ++nextId;
    pending.set(id, { ok, fail });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function js(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'page error');
  return r.result.value;
}

// ---- The pointer drawn into the page ----------------------------------------

const CURSOR = `
  (() => {
    if (document.getElementById('demo-cursor')) return;
    const style = document.createElement('style');
    style.textContent = \`
      #demo-cursor { position: fixed; left: 0; top: 0; width: 22px; height: 22px; z-index: 2147483647;
        pointer-events: none; transition: transform 420ms cubic-bezier(.4,0,.2,1); }
      #demo-cursor svg { filter: drop-shadow(0 1px 2px rgba(0,0,0,.45)); }
      .demo-ripple { position: fixed; width: 28px; height: 28px; margin: -14px 0 0 -14px; border-radius: 50%;
        border: 2px solid #2f6fd0; z-index: 2147483646; pointer-events: none; animation: demo-ripple 450ms ease-out forwards; }
      @keyframes demo-ripple { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
    \`;
    document.head.append(style);
    const c = document.createElement('div');
    c.id = 'demo-cursor';
    c.innerHTML = '<svg viewBox="0 0 22 22" width="22" height="22"><path d="M3 2 L3 18 L7.5 14 L10.5 20.5 L13 19.4 L10 13 L16 13 Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
    c.style.transform = 'translate(${WIDTH / 2}px, ${HEIGHT / 2}px)';
    document.body.append(c);
  })()`;

let pointer = { x: WIDTH / 2, y: HEIGHT / 2 };

async function moveTo(x, y) {
  await js(`${CURSOR}; document.getElementById('demo-cursor').style.transform = 'translate(${x}px, ${y}px)'`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  pointer = { x, y };
  await sleep(480);
}

async function ripple(x, y) {
  await js(`(() => { const r = document.createElement('div'); r.className = 'demo-ripple';
    r.style.left = '${x}px'; r.style.top = '${y}px'; document.body.append(r); setTimeout(() => r.remove(), 500); })()`);
}

// ---- Finding and using elements ---------------------------------------------

/** The centre of the first visible element matching the selector (and text). */
async function find(selector, text, { exact = false, index = 0, child = null } = {}) {
  const box = await js(`(() => {
    const want = ${JSON.stringify(text ?? null)};
    const all = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      if (want === null) return true;
      const t = el.textContent.replace(/\\s+/g, ' ').trim();
      return ${exact} ? t === want : t.includes(want);
    });
    const found = all[${index}];
    const el = ${JSON.stringify(child)} ? found?.querySelector(${JSON.stringify(child)}) : found;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), left: r.left, top: r.top, width: r.width, height: r.height };
  })()`);
  if (!box) throw new Error(`No element ${selector} ${text ?? ''}`);
  return box;
}

/** Wait until an element with this text is on screen. */
async function waitText(selector, text, ms = 30000) {
  await waitFor(() => find(selector, text).then(() => true), `"${text}"`, ms);
}

async function click(selector, text, opts = {}) {
  const box = await find(selector, text, opts);
  const x = opts.dx !== undefined ? Math.round(box.left + opts.dx) : box.x;
  const y = box.y;
  await moveTo(x, y);
  await ripple(x, y);
  const button = opts.right ? 'right' : 'left';
  const clicks = opts.double ? 2 : 1;
  const modifiers = opts.shift ? 8 : opts.meta ? 4 : 0;
  for (let n = 1; n <= clicks; n++) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: n, modifiers });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: n, modifiers });
  }
  await sleep(opts.wait ?? 500);
}

async function type(text, delay = 75) {
  for (const ch of text) {
    await send('Input.insertText', { text: ch });
    await sleep(delay);
  }
}

async function key(name, code, keyCode) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: keyCode });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: keyCode });
  await sleep(300);
}

// ---- Output -----------------------------------------------------------------

async function screenshot(name) {
  await js(`document.getElementById('demo-cursor')?.remove()`);
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: false });
  await sleep(500);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`  wrote docs/media/${name}.png`);
}

/** Record the page while `steps` run, then write a GIF. */
async function record(name, steps, { width = 1000 } = {}) {
  const dir = join(WORK, `frames-${name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  const frames = [];
  listeners.set('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = join(dir, `${String(frames.length).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp });
    send('Page.screencastFrameAck', { sessionId });
  });
  await send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
  await sleep(700);
  await steps();
  await sleep(1400);
  await send('Page.stopScreencast');
  listeners.delete('Page.screencastFrame');

  // Screencast frames come only when the page changes, so each one is held
  // until the next arrives. The last one is held for a moment at the end.
  const list = frames.map((f, i) => {
    const next = frames[i + 1]?.t ?? f.t + 1.2;
    return `file '${f.file}'\nduration ${Math.max(0.04, next - f.t).toFixed(3)}`;
  });
  list.push(`file '${frames.at(-1).file}'`);
  writeFileSync(join(dir, 'list.txt'), list.join('\n'));
  const gif = join(OUT, `${name}.gif`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'),
    '-vf', `fps=12,scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    '-loop', '0', gif]);
  console.log(`  wrote docs/media/${name}.gif (${frames.length} frames)`);
}

// ---- Scenes -----------------------------------------------------------------

function freshRepo(setup = '') {
  execFileSync(join(ROOT, 'scripts/demo-repo.sh'), [REPO]);
  if (setup) execFileSync('bash', ['-c', setup], { cwd: REPO });
}

async function openApp({ theme = 'dark', setup = '' } = {}) {
  freshRepo(setup);
  // Forget the panels and sizes the last scene left open.
  await send('Page.navigate', { url: `http://localhost:${PORT}/` });
  await waitFor(() => js(`document.readyState === 'complete'`), 'the page');
  await js(`localStorage.clear()`);
  await send('Page.navigate', { url: `http://localhost:${PORT}/?theme=${theme}&repo=${encodeURIComponent(REPO)}` });
  await waitFor(() => js(`document.querySelectorAll('.graph .row').length > 10`), 'the graph');
  await sleep(800);
  await js(CURSOR);
  pointer = { x: WIDTH / 2, y: HEIGHT / 2 };
}

const scenes = {
  async overview() {
    for (const theme of ['dark', 'light']) {
      await openApp({ theme });
      await click('.graph .row', 'feat: filter notes by tag');
      await screenshot(`overview-${theme}`);
    }
  },

  async commit() {
    await openApp({ setup: `
      sed -i.bak 's/return { id: crypto.randomUUID(), title, body, created: Date.now() };/return { id: crypto.randomUUID(), title: title.trim(), body, created: Date.now(), pinned: false };/' src/notes.js
      printf '\nexport function unpinNote(note) {\n  return { ...note, pinned: false };\n}\nconsole.log("debug: notes loaded");\n' >> src/notes.js
      rm src/notes.js.bak
      printf 'Ideas: export to PDF, share a note by link.\n' > ideas.txt` });
    await record('commit-lines', async () => {
      await click('.rail .item', 'Commit');
      await click('.row .name', 'notes.js', { double: true, wait: 1200 });
      // Leave the debug line out, and stage the rest.
      await click('.diff .row', 'debug: notes loaded', { child: '.num.pick', wait: 900 });
      await click('button', 'Stage selected', { wait: 1400 });
      await key('Escape', 'Escape', 27);
      await sleep(900);
    });
  },

  async suggest() {
    model.on = true;
    model.subject = 'feat: let a note be unpinned';
    try {
      await openApp({ setup: `
        cat > commitlint.config.js <<'CONFIG'
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 72]
  }
};
CONFIG
        git add commitlint.config.js
        GIT_AUTHOR_DATE=2026-08-26T10:00:00 GIT_COMMITTER_DATE=2026-08-26T10:00:00 git commit -q -m "chore: add the commit message rules"
        printf '\nexport function unpinNote(note) {\n  return { ...note, pinned: false };\n}\n' >> src/notes.js` });
      await record('suggest', async () => {
        await click('.rail .item', 'Commit', { wait: 800 });
        await click('.row', 'notes.js', { child: '.box', wait: 900 });
        await click('textarea');
        // A message that breaks the rules: no type, and far too long.
        await type('Added a way to unpin notes again so that pinned notes can go back to the normal list', 32);
        await sleep(1800);
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, commands: ['selectAll'] });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4 });
        await key('Backspace', 'Backspace', 8);
        await sleep(500);
        await click('button.suggest', 'Suggest', { wait: 300 });
        await waitFor(() => js(`document.querySelector('textarea')?.value.startsWith('feat:')`), 'the suggestion');
        await sleep(1600);
        await click('button', 'Commit', { exact: true, wait: 300 });
        await waitText('.graph .row', 'feat: let a note be unpinned');
        await sleep(1400);
      });
    } finally {
      model.on = false;
    }
  },

  async squash() {
    await openApp();
    await record('squash', async () => {
      await click('.graph .row', 'feat: add an export button');
      await click('.graph .row', 'wip: name the exported file', { shift: true });
      await click('.graph .row', 'fix: rename the export function', { right: true });
      await click('.menu .item', 'Squash commits', { wait: 900 });
      await click('.dialog textarea');
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, commands: ['selectAll'] });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4 });
      await type('feat: export a note as Markdown', 45);
      await sleep(500);
      await click('.dialog .btn.primary', null, { wait: 300 });
      await waitText('.graph .row', 'feat: export a note as Markdown');
      await sleep(600);
      await click('.graph .row', 'feat: export a note as Markdown', { wait: 1200 });
    });
  },

  async rebase() {
    await openApp();
    await record('rebase', async () => {
      await click('.graph .row', 'feat: add an export button', { right: true });
      await click('.menu .item', 'Rebase from here', { wait: 1000 });
      // Drag "lay out the toolbar" to the top of the list.
      const grip = await find('.rows .row .grip', null, { index: 3 });
      const first = await find('.rows .row', null, { index: 0 });
      await moveTo(grip.x, grip.y);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: grip.x, y: grip.y, button: 'left', clickCount: 1 });
      await sleep(100);
      await js(`window.__dt = new DataTransfer(); document.querySelectorAll('.rows .row')[3]
        .dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dt }))`);
      const steps = 6;
      for (let s = 1; s <= steps; s++) {
        const y = Math.round(grip.y + ((first.top + 4) - grip.y) * (s / steps));
        await js(`document.getElementById('demo-cursor').style.transform = 'translate(${grip.x}px, ${y}px)'`);
        await js(`(() => { const el = document.elementFromPoint(${first.x}, ${y})?.closest('.rows .row');
          el?.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientY: ${y}, dataTransfer: window.__dt })); })()`);
        await sleep(110);
      }
      await sleep(300);
      await js(`(() => { const el = document.querySelectorAll('.rows .row')[0];
        el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientY: ${first.top + 4}, dataTransfer: window.__dt }));
        el.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: window.__dt })); })()`);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: grip.x, y: first.top + 4, button: 'left', clickCount: 1 });
      await sleep(900);
      // Fold the rename into the commit before it.
      const select = await find('.rows .row .command', null, { index: 2 });
      await moveTo(select.x, select.y);
      await ripple(select.x, select.y);
      await js(`(() => { const s = document.querySelectorAll('.rows .row .command')[2]; s.value = 'fixup';
        s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await sleep(1000);
      await click('button', 'Start rebase', { wait: 300 });
      await waitFor(() => js(`!document.querySelector('.rows')`), 'the rebase to finish', 30000);
      await sleep(1500);
    });
  },

  async undo() {
    await openApp();
    await record('undo', async () => {
      await click('.graph .row', 'style: soften the page colours', { right: true });
      await click('.menu .item', 'Drop commit', { wait: 900 });
      await click('.dialog .btn.primary', null, { wait: 300 });
      await waitFor(() => js(`![...document.querySelectorAll('.graph .row')].some((r) => r.textContent.includes('soften the page colours'))`), 'the drop', 30000);
      await sleep(800);
      await click('.rail .item', 'Undo', { wait: 900 });
      await click('button', 'Restore', { wait: 1100 });
      await click('.dialog .btn.primary', null, { wait: 300 });
      await waitText('.graph .row', 'style: soften the page colours');
      await sleep(700);
      await click('.graph .row', 'style: soften the page colours', { wait: 1000 });
    });
  },

  async console() {
    await openApp();
    await record('console', async () => {
      await click('.rail .item', 'Console', { wait: 800 });
      await click('.console input');
      await type('sw');
      await sleep(700);
      await key('Tab', 'Tab', 9);
      await type(' feature/s');
      await sleep(800);
      await key('Tab', 'Tab', 9);
      await sleep(500);
      await key('Enter', 'Enter', 13);
      await sleep(1500);
      await type('log --oneline -5');
      await sleep(400);
      await key('Enter', 'Enter', 13);
      await sleep(1800);
    });
  },

  async conflict() {
    await openApp({ setup: 'git merge -q feature/dark-mode -m "Merge dark mode" || true' });
    await click('.rail .item', 'Commit', { wait: 800 });
    await click('button', 'Resolve', { wait: 1500 });
    await screenshot('merge-editor');
  },

  async help() {
    await openApp();
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '?', code: 'Slash', modifiers: 8, text: '?', windowsVirtualKeyCode: 191 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '?', code: 'Slash', modifiers: 8, windowsVirtualKeyCode: 191 });
    await waitText('.panel .title', 'Help');
    await sleep(600);
    await screenshot('help');
  },

  async stats() {
    await openApp();
    await click('.rail .item', 'Stats');
    await waitFor(() => js(`!!document.querySelector('.report, .stats-report, main table')`), 'the report');
    await sleep(1500);
    await screenshot('stats');
  },
};

// ---- Run ----------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
// No AI keys, no GitHub token and no saved settings, so the pictures show what
// a new user sees, whatever this computer has set up.
const env = { ...process.env, GITKEEN_CONFIG: join(WORK, 'config.json'), ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '',
  GITHUB_TOKEN: '', GH_TOKEN: '', OLLAMA_HOST: 'http://127.0.0.1:9', LMSTUDIO_HOST: `http://127.0.0.1:${MODEL_PORT}` };

// A stand-in for LM Studio, so the Suggest scene has a model that always gives
// the same answer. It stays silent until a scene turns it on, so every other
// scene shows a Gitkeen with no AI provider.
const model = { on: false, subject: '' };
const modelServer = createServer((req, res) => {
  if (!model.on) { res.writeHead(503).end(); return; }
  res.setHeader('content-type', 'application/json');
  if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'demo-model' }] })); return; }
  req.resume();
  req.on('end', () => setTimeout(() => res.end(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: model.subject } }]
  })), 1200));
}).listen(MODEL_PORT, '127.0.0.1');
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', env });
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${CDP_PORT}`,
  '--remote-allow-origins=*', `--user-data-dir=${join(WORK, 'chrome')}`, `--window-size=${WIDTH},${HEIGHT}`, 'about:blank'], { stdio: 'ignore' });

try {
  await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok, 'the dev server');
  await waitFor(async () => (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok, 'Chrome');
  await connect();
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  const wanted = process.argv.slice(2);
  for (const [name, scene] of Object.entries(scenes)) {
    if (wanted.length && !wanted.includes(name)) continue;
    console.log(name);
    await scene();
  }
} catch (err) {
  console.error(err);
  // A picture of the page as it was when the scene failed.
  try {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(tmpdir(), 'gitkeen-media-failed.png'), Buffer.from(data, 'base64'));
    console.error(`The page at the failure: ${join(tmpdir(), 'gitkeen-media-failed.png')}`);
  } catch { /* no page to show */ }
  process.exitCode = 1;
} finally {
  ws?.close();
  modelServer.close();
  chrome.kill();
  vite.kill();
  await new Promise((r) => (chrome.exitCode !== null ? r() : chrome.once('exit', r)));
  rmSync(WORK, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
