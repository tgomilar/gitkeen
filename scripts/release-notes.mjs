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

if (!previous) {
  lines.push(
    'The first release of Gitkeen, a visual Git client that works next to any editor.',
    '',
    'See the [README](https://github.com/tgomilar/gitkeen#readme) for what it can do.',
    ''
  );
}
lines.push(
  '### Installing',
  '',
  'Download the file for your system below. The app is not signed yet, so your system asks once before it opens it.',
  'See [Installing Gitkeen](https://github.com/tgomilar/gitkeen/blob/main/docs/install.md) for the steps.',
  '',
  'Gitkeen checks for new versions when it starts, and offers to update itself.'
);
console.log(lines.join('\n'));
