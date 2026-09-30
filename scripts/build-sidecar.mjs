/**
 * Build the desktop app's backend as one executable, for Tauri to ship as a
 * sidecar next to the app.
 *
 *   1. esbuild bundles server/sidecar.mjs and everything it imports into one
 *      CommonJS file.
 *   2. Node turns that file into a single-executable-application blob.
 *   3. The blob is injected into a copy of this machine's Node binary, which
 *      is then signed again (ad hoc) so macOS will run it.
 *
 * The result lands in src-tauri/binaries/, named with the target triple as
 * Tauri expects: gitkeen-backend-aarch64-apple-darwin on an Apple silicon Mac.
 *
 * `TARGET=x86_64-apple-darwin` builds for another system. The blob is the same
 * everywhere, but the Node binary is not, so the official one for that system
 * is downloaded from nodejs.org, at the same version as the Node running this.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not .pathname, which gives /D:/… on Windows.
const root = fileURLToPath(new URL('..', import.meta.url));
const work = join(root, 'dist-sidecar');
const host = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)[1];
const triple = process.env.TARGET || host;
const windows = triple.includes('windows');
const darwin = triple.includes('apple-darwin');
const outDir = join(root, 'src-tauri', 'binaries');
const binary = join(outDir, `gitkeen-backend-${triple}${windows ? '.exe' : ''}`);
// npx is a .cmd script on Windows, which only a shell can start.
const npx = (args, opts) => execFileSync('npx', args, { ...opts, shell: process.platform === 'win32' });

/** Node's name for a system, from a Rust target triple. */
function nodePlatform(t) {
  const arch = t.startsWith('aarch64') ? 'arm64' : 'x64';
  if (t.includes('apple-darwin')) return `darwin-${arch}`;
  if (t.includes('windows')) return `win-${arch}`;
  if (t.includes('linux')) return `linux-${arch}`;
  throw new Error(`No Node build for ${t}`);
}

/** The Node binary to put the backend into: this one, or a download for the target. */
function nodeBinary() {
  if (triple === host) return process.execPath;
  const name = `node-${process.version}-${nodePlatform(triple)}`;
  const dir = join(work, 'node');
  mkdirSync(dir, { recursive: true });
  const archive = join(dir, windows ? `${name}.zip` : `${name}.tar.gz`);
  execFileSync('curl', ['-fsSL', '-o', archive, `https://nodejs.org/dist/${process.version}/${archive.split(/[\\/]/).pop()}`], { stdio: 'inherit' });
  execFileSync('tar', ['-xf', archive, '-C', dir], { stdio: 'inherit' });
  const path = windows ? join(dir, name, 'node.exe') : join(dir, name, 'bin', 'node');
  if (!existsSync(path)) throw new Error(`The download has no ${path}`);
  return path;
}

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(outDir, { recursive: true });

// 1. One file. `import.meta.url` has no CommonJS meaning, so it is given the
// file's own URL; the backend only uses it to find the rebase helper, which
// the executable replaces with itself.
await build({
  entryPoints: [join(root, 'server', 'sidecar.mjs')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: join(work, 'sidecar.cjs'),
  define: { 'import.meta.url': '__gitkeen_url' },
  banner: { js: "const __gitkeen_url = require('node:url').pathToFileURL(__filename).href;" },
  logLevel: 'warning'
});

// 2. The blob.
const config = join(work, 'sea-config.json');
writeFileSync(config, JSON.stringify({
  main: join(work, 'sidecar.cjs'),
  output: join(work, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  useCodeCache: false
}));
execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });

// 3. Into a copy of Node, then signed again.
copyFileSync(nodeBinary(), binary);
chmodSync(binary, 0o755);
const codesign = darwin && process.platform === 'darwin';
if (codesign) execFileSync('codesign', ['--remove-signature', binary]);
npx(['--yes', 'postject@1.0.0-alpha.6', binary, 'NODE_SEA_BLOB', join(work, 'sea-prep.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(darwin ? ['--macho-segment-name', 'NODE_SEA'] : [])], { stdio: 'inherit' });
if (codesign) execFileSync('codesign', ['--sign', '-', binary]);

console.log(`Built ${binary}`);
