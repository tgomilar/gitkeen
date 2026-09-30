// Prepare a release: set the version everywhere it is written, commit, and tag.
//
//   npm run release -- 0.2.0          prepare it, and say how to publish
//   npm run release -- 0.2.0 --push   prepare it and push, which starts the build
//
// The version lives in package.json, package-lock.json, src-tauri/Cargo.toml
// and src-tauri/tauri.conf.json (Cargo.lock follows Cargo.toml). Pushing the
// tag starts .github/workflows/release.yml, which builds the app for every
// system and attaches it to a draft release.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const fail = (message) => { console.error(message); process.exit(1); };

const version = process.argv[2];
const push = process.argv.includes('--push');
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) fail('Give the new version, such as: npm run release -- 0.2.0');

const tag = `v${version}`;
if (git('status', '--porcelain')) fail('Commit or stash your changes first. A release is made from a clean working tree.');
if (git('branch', '--show-current') !== 'main') fail('Releases are made from main. Switch to main first.');
if (git('tag', '--list', tag)) fail(`The tag ${tag} exists already.`);

const current = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const newer = (a, b) => a.split('.').map(Number).reduce((r, n, i) => r || n - b.split('.').map(Number)[i], 0) > 0;
if (!newer(version, current)) fail(`${version} is not newer than the current version, ${current}.`);

function json(path, change) {
  const file = join(root, path);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  change(data);
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

json('package.json', (d) => { d.version = version; });
json('package-lock.json', (d) => { d.version = version; d.packages[''].version = version; });
json('src-tauri/tauri.conf.json', (d) => { d.version = version; });

const cargo = join(root, 'src-tauri/Cargo.toml');
writeFileSync(cargo, readFileSync(cargo, 'utf8').replace(/^version = ".*"$/m, `version = "${version}"`));
const lock = join(root, 'src-tauri/Cargo.lock');
writeFileSync(lock, readFileSync(lock, 'utf8').replace(/(name = "gitkeen"\nversion = )".*"/, `$1"${version}"`));

git('add', 'package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json');
git('commit', '-q', '-m', `chore: release ${tag}`);
git('tag', '-a', tag, '-m', `Gitkeen ${version}`);
console.log(`Made the commit and the tag ${tag}.`);

if (push) {
  execFileSync('git', ['push', 'origin', 'main', tag], { cwd: root, stdio: 'inherit' });
  console.log('Pushed. The build runs in the Actions tab, and the draft release appears when it is done.');
} else {
  console.log(`Push to build it: git push origin main ${tag}`);
}
