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
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const work = join(root, 'dist-sidecar');
const triple = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)[1];
const outDir = join(root, 'src-tauri', 'binaries');
const binary = join(outDir, `gitkeen-backend-${triple}${process.platform === 'win32' ? '.exe' : ''}`);

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
copyFileSync(process.execPath, binary);
chmodSync(binary, 0o755);
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', binary]);
execFileSync('npx', ['--yes', 'postject@1.0.0-alpha.6', binary, 'NODE_SEA_BLOB', join(work, 'sea-prep.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : [])], { stdio: 'inherit' });
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', binary]);

console.log(`Built ${binary}`);
