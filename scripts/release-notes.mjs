// Write the release notes for a version, from the commit subjects since the
// previous tag.
//
//   node scripts/release-notes.mjs [tag]
//
// The commits follow Conventional Commits, so features and fixes can be told
// apart by their type. Only those two, and performance work, go into the
// notes: docs, chores and refactors change nothing a user of the app sees.
import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const tag = process.argv[2] ?? null;
const tags = git('tag', '--list', 'v*', '--sort=-v:refname').split('\n').filter(Boolean);
const previous = tags.find((t) => t !== tag) ?? null;
const range = previous ? `${previous}..${tag && tags.includes(tag) ? tag : 'HEAD'}` : 'HEAD';

const GROUPS = [
  ['feat', 'New'],
  ['fix', 'Fixed'],
  ['perf', 'Faster']
];

// The first release has no earlier version to compare with, so it says what
// Gitkeen is instead of listing every commit since the project began.
const subjects = previous ? git('log', '--no-merges', '--format=%s', range).split('\n').filter(Boolean) : [];
const lines = [];
for (const [type, title] of GROUPS) {
  const items = subjects
    .map((s) => s.match(new RegExp(`^${type}(?:\\([^)]*\\))?!?: (.+)$`))?.[1])
    .filter(Boolean)
    .map((s) => `- ${s[0].toUpperCase()}${s.slice(1)}`);
  if (items.length) lines.push(`### ${title}`, '', ...items, '');
}

if (lines.length) lines.unshift('## What is new', '');
if (!previous) {
  lines.push('## About this release', '',
    'The first release of Gitkeen, a visual Git client that works next to any editor.',
    '',
    'See the [README](https://github.com/tgomilar/gitkeen#readme) for what it can do.'
  );
}
// The download table goes first: it is what most people open a release for.
// The file names come from assetNamePattern in .github/workflows/release.yml.
const file = (name) => `https://github.com/tgomilar/gitkeen/releases/download/${tag ?? 'latest'}/${name}`;
const download = [
  '## Download',
  '',
  '| Your system | Download |',
  '|---|---|',
  `| macOS on Apple silicon (M1 and newer) | [Gitkeen-macOS-Apple-silicon.dmg](${file('Gitkeen-macOS-Apple-silicon.dmg')}) |`,
  `| macOS on Intel | [Gitkeen-macOS-Intel.dmg](${file('Gitkeen-macOS-Intel.dmg')}) |`,
  `| Windows 10 and 11 | [Gitkeen-Windows-Installer.exe](${file('Gitkeen-Windows-Installer.exe')}) |`,
  `| Linux | [Gitkeen-Linux.AppImage](${file('Gitkeen-Linux.AppImage')}) |`,
  `| Debian and Ubuntu | [Gitkeen-Linux.deb](${file('Gitkeen-Linux.deb')}) |`,
  '',
  'Not sure which Mac you have? Open the Apple menu and choose **About This Mac**. A chip named "Apple M" is Apple silicon.',
  '',
  'The app is not signed yet, so macOS and Windows ask once before they open it.',
  '[Installing Gitkeen](https://github.com/tgomilar/gitkeen/blob/main/docs/install.md) shows the steps.',
  'A full release updates itself: Gitkeen checks for a new version when it starts. A pre-release does not, so install a newer one from the Releases page.',
  '',
  'The `.app.tar.gz` files and `latest.json` below are for automatic updates. You do not need to download them.',
  ''
];
console.log([...download, ...lines].join('\n').trim());
