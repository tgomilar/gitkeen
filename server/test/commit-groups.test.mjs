/**
 * Accepting a suggested split: the staged change committed as several
 * commits, each holding only its own files, with everything else still staged
 * exactly as it was, a file staged hunk by hunk included.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withRepo } from './harness.mjs';

/**
 * A stand-in for LM Studio that answers with whatever `replies` holds next,
 * so a test decides what the model says without calling one.
 */
const replies = [];
/** What each chat request told the model, newest last. */
const prompts = [];
const lmstudio = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'stand-in' }] }));
    if (req.method === 'GET') return res.writeHead(404).end('{}');
    prompts.push(JSON.parse(body).messages.map((m) => m.content).join('\n'));
    const content = replies.shift() ?? 'chore: nothing more to say';
    res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
  });
});

let methods;
let dir;
before(async () => {
  await new Promise((ok) => lmstudio.listen(0, '127.0.0.1', ok));
  dir = await mkdtemp(join(tmpdir(), 'gitkeen-split-'));
  process.env.GITKEEN_CONFIG = join(dir, 'config.json');
  process.env.LMSTUDIO_HOST = `http://127.0.0.1:${lmstudio.address().port}`;
  process.env.OLLAMA_HOST = 'http://127.0.0.1:9';
  ({ methods } = await import('../api.mjs'));
});
after(async () => {
  lmstudio.close();
  await rm(dir, { recursive: true, force: true });
});

const stage = (repo, paths) => methods['changes.stage']({ path: repo.path, paths, on: true });
const split = (repo, groups) => methods['changes.commitGroups']({ path: repo.path, groups });

describe('committing a suggested split', () => {
  test('each commit holds only its own files, in the order given', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'a.txt': 'a\n', 'b.txt': 'b\n' });
      repo.write('a.txt', 'a2\n');
      repo.write('b.txt', 'b2\n');
      repo.write('c.txt', 'c\n');
      await stage(repo, ['a.txt', 'b.txt', 'c.txt']);

      const result = await split(repo, [
        { message: 'fix: change a', files: ['a.txt'] },
        { message: 'feat: change b and add c', files: ['b.txt', 'c.txt'] }
      ]);
      assert.equal(result.commits.length, 2);
      assert.deepEqual(await repo.log(), ['feat: change b and add c', 'fix: change a', 'base']);

      const first = (await repo.git(['show', '--name-only', '--format=', 'HEAD~1'])).stdout.trim();
      assert.equal(first, 'a.txt');
      const second = (await repo.git(['show', '--name-only', '--format=', 'HEAD'])).stdout.trim().split('\n');
      assert.deepEqual(second.sort(), ['b.txt', 'c.txt']);
      assert.equal(await repo.status(), '', 'nothing is left over');
    });
  });

  test('files left out of every chosen commit stay staged', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'a.txt': 'a\n', 'b.txt': 'b\n' });
      repo.write('a.txt', 'a2\n');
      repo.write('b.txt', 'b2\n');
      await stage(repo, ['a.txt', 'b.txt']);

      await split(repo, [{ message: 'fix: change a', files: ['a.txt'] }]);
      assert.equal(await repo.status(), 'M  b.txt', 'b.txt is still staged, for a commit of its own');
    });
  });

  test('a file staged hunk by hunk goes in as staged, not as it is on disk', async () => {
    await withRepo(async (repo) => {
      const lines = Array.from({ length: 10 }, (_, i) => `l${i + 1}`);
      await repo.commit('base', { 'f.txt': lines.join('\n') + '\n', 'g.txt': 'g\n' });
      const changed = ['L1', ...lines.slice(1, 9), 'L10'];
      repo.write('f.txt', changed.join('\n') + '\n');
      repo.write('g.txt', 'g2\n');
      const { hunks } = await methods['diff.file']({ path: repo.path, file: 'f.txt', side: 'unstaged' });
      await methods['changes.stageHunks']({ path: repo.path, file: 'f.txt', side: 'unstaged', hunks: [hunks[0]] });
      await stage(repo, ['g.txt']);

      await split(repo, [
        { message: 'fix: first line', files: ['f.txt'] },
        { message: 'fix: g', files: ['g.txt'] }
      ]);
      const committed = (await repo.git(['show', 'HEAD~1:f.txt'])).stdout;
      assert.equal(committed, ['L1', ...lines.slice(1, 9), 'l10'].join('\n') + '\n', 'only the staged hunk');
      assert.equal(await repo.status(), 'M f.txt', 'the other hunk is still on disk, unstaged');
    });
  });

  test('a deleted file and a renamed one are committed whole', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'old.txt': 'same content here\n', 'gone.txt': 'x\n' });
      await repo.git(['mv', 'old.txt', 'new.txt']);
      await repo.git(['rm', '-q', 'gone.txt']);

      await split(repo, [
        { message: 'refactor: rename old to new', files: ['new.txt'] },
        { message: 'chore: remove gone', files: ['gone.txt'] }
      ]);
      assert.deepEqual(await repo.files(), ['new.txt']);
      const renamed = (await repo.git(['show', '--name-status', '--format=', 'HEAD~1'])).stdout.trim();
      assert.match(renamed, /^R\d*\told\.txt\tnew\.txt$/, 'the old path leaves in the same commit');
      assert.equal(await repo.status(), '');
    });
  });

  test('the first commit on a new branch works', async () => {
    await withRepo(async (repo) => {
      repo.write('a.txt', 'a\n');
      repo.write('b.txt', 'b\n');
      await stage(repo, ['a.txt', 'b.txt']);
      await split(repo, [
        { message: 'feat: add a', files: ['a.txt'] },
        { message: 'feat: add b', files: ['b.txt'] }
      ]);
      assert.deepEqual(await repo.log(), ['feat: add b', 'feat: add a']);
    });
  });

  test('a file that is not staged is refused before anything is committed', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'a.txt': 'a\n', 'b.txt': 'b\n' });
      repo.write('a.txt', 'a2\n');
      repo.write('b.txt', 'b2\n');
      await stage(repo, ['a.txt']);
      await assert.rejects(
        () => split(repo, [
          { message: 'fix: a', files: ['a.txt'] },
          { message: 'fix: b', files: ['b.txt'] }
        ]),
        /b\.txt is not staged/
      );
      assert.deepEqual(await repo.log(), ['base']);
    });
  });
});

describe('suggesting a split', () => {
  test('each suggested commit comes with its own subject, held to the rules', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', {
        'commitlint.config.js': "export default { rules: { 'header-max-length': [2, 'always', 30] } };\n",
        'a.txt': 'a\n'
      });
      repo.write('a.txt', 'a2\n');
      repo.write('b.txt', 'b\n');
      await stage(repo, ['a.txt', 'b.txt']);

      replies.push(JSON.stringify({
        subject: 'fix: a, add b',
        groups: [
          { reason: 'Fix a', subject: 'fix: correct the first letter in a', files: ['a.txt'] },
          { reason: 'Add b', subject: 'feat: add b', files: ['b.txt'] }
        ]
      }));
      // The answer to the one retry, for the subject that is too long.
      replies.push('fix: correct a');

      const result = await methods['commit.suggest']({ path: repo.path, paths: ['a.txt', 'b.txt'], provider: 'lmstudio' });
      assert.equal(result.groups.length, 2);
      assert.deepEqual(result.groups.map((g) => g.subject), ['fix: correct a', 'feat: add b']);
      assert.ok(result.groups.every((g) => g.ok), 'both now follow the rules');

      // Accepting it: the subjects become the commits.
      await split(repo, result.groups.map((g) => ({ message: g.subject, files: g.files })));
      assert.deepEqual((await repo.log()).slice(0, 2), ['feat: add b', 'fix: correct a']);
    });
  });

  test('files the model left out are gathered into a group of their own', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'a.txt': 'a\n' });
      repo.write('a.txt', 'a2\n');
      repo.write('b.txt', 'b\n');
      repo.write('c.txt', 'c\n');
      await stage(repo, ['a.txt', 'b.txt', 'c.txt']);
      replies.push(JSON.stringify({
        subject: 'chore: several things',
        groups: [
          { reason: 'A', subject: 'fix: a', files: ['a.txt'] },
          { reason: 'B', subject: 'feat: b', files: ['b.txt'] }
        ]
      }));
      const result = await methods['commit.suggest']({ path: repo.path, paths: ['a.txt', 'b.txt', 'c.txt'], provider: 'lmstudio' });
      assert.equal(result.groups.length, 3);
      const last = result.groups.at(-1);
      assert.equal(last.leftover, true);
      assert.deepEqual(last.files, ['c.txt'], 'c.txt is shown, not quietly left out');
      assert.equal(last.subject, '');
    });
  });

  test('a change too large to send whole still shows the model every file, and can be split', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'a.txt': 'a\n' });
      // Far over a local model's budget, in the first file the diff lists.
      repo.write('a.txt', Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n') + '\n');
      repo.write('z.txt', 'the last file\n');
      await stage(repo, ['a.txt', 'z.txt']);
      replies.push(JSON.stringify({
        subject: 'chore: two things',
        groups: [
          { reason: 'A', subject: 'feat: fill a', files: ['a.txt'] },
          { reason: 'Z', subject: 'docs: add z', files: ['z.txt'] }
        ]
      }));

      const result = await methods['commit.suggest']({ path: repo.path, paths: ['a.txt', 'z.txt'], provider: 'lmstudio' });
      assert.equal(result.clipped, true);
      const prompt = prompts.at(-1);
      assert.match(prompt, /z\.txt \(\+1 -0\)\n\+the last file/, 'the file after the big one is still there');
      assert.ok(prompt.length < 9000, 'and the whole request stays within a local budget');
      assert.equal(result.groups.length, 2);
    });
  });

  test('files the first answer forgot are placed by a second, which can start a new commit', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'a.txt': 'a\n', 'b.txt': 'b\n' });
      for (const f of ['a.txt', 'b.txt', 'a-test.txt', 'readme.md', 'c.txt']) repo.write(f, `${f} changed\n`);
      const paths = ['a-test.txt', 'a.txt', 'b.txt', 'c.txt', 'readme.md'];
      await stage(repo, paths);
      replies.push(JSON.stringify({
        subject: 'chore: several things',
        groups: [
          { reason: 'A', subject: 'feat: change a', files: ['a.txt'] },
          { reason: 'B', subject: 'fix: change b', files: ['b.txt'] }
        ]
      }));
      replies.push(JSON.stringify({
        placements: [
          { file: 'a-test.txt', commit: 1 },
          { file: 'readme.md', commit: 3 },
          { file: 'nope.txt', commit: 1 }
        ],
        new: [{ commit: 3, reason: 'Docs', subject: 'docs: describe the change' }]
      }));

      const result = await methods['commit.suggest']({ path: repo.path, paths, provider: 'lmstudio' });
      const second = prompts.at(-1);
      assert.match(second, /<files>\na-test\.txt\nc\.txt\nreadme\.md\n<\/files>/, 'only the forgotten files are asked about');
      assert.deepEqual(result.groups.map((g) => [g.subject, g.files]), [
        ['feat: change a', ['a.txt', 'a-test.txt']],
        ['fix: change b', ['b.txt']],
        ['docs: describe the change', ['readme.md']],
        ['', ['c.txt']]
      ], 'a file not in the change is ignored, and one still unplaced is shown last');
      assert.equal(result.groups.at(-1).leftover, true);
    });
  });
});
