/**
 * Staging and committing: the tick is now a stage, so these tests pin down
 * what a tick does to the index and what the index does to a commit.
 *
 * The rule being tested: a commit carries exactly the index. A whole ticked
 * file goes in by `git add`, a ticked hunk by `git apply --cached`, and
 * whatever the index does not hold stays out of the commit, on purpose.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { methods } from '../api.mjs';
import { withRepo } from './harness.mjs';

/** A ten-line file with `nth` and `nth2` rewritten, so the change is two hunks. */
async function tenLines(repo) {
  const lines = Array.from({ length: 10 }, (_, i) => `l${i + 1}`);
  await repo.commit('base', { 'f.txt': lines.join('\n') + '\n' });
  const changed = [...lines];
  changed[0] = 'L1';
  changed[9] = 'L10';
  repo.write('f.txt', changed.join('\n') + '\n');
  return { lines, changed };
}

describe('staging a whole file', () => {
  test('ticking an unversioned file puts it in the index, unticking brings it back', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'a.txt': 'one\n' });
      repo.write('new.txt', 'hello\n');
      assert.match(await repo.status(), /^\?\? new.txt$/m);

      await methods['changes.stage']({ path: repo.path, paths: ['new.txt'], on: true });
      assert.match(await repo.status(), /^A  new.txt$/m, 'ticked means staged');

      await methods['changes.stage']({ path: repo.path, paths: ['new.txt'], on: false });
      assert.match(await repo.status(), /^\?\? new.txt$/m, 'unticked means unversioned again');
    });
  });

  test('ticking a modified file stages its working-tree content', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'one\n' });
      repo.write('f.txt', 'one\nchanged\n');

      await methods['changes.stage']({ path: repo.path, paths: ['f.txt'], on: true });
      assert.equal((await repo.git(['show', ':f.txt'])).stdout, 'one\nchanged\n');

      await methods['changes.stage']({ path: repo.path, paths: ['f.txt'], on: false });
      assert.equal((await repo.git(['show', ':f.txt'])).stdout, 'one\n', 'index back to HEAD');
    });
  });
});

describe('commit takes the index', () => {
  test('a commit carries what was staged, not what the working tree grew later', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'one\n' });
      repo.write('f.txt', 'one\nstaged-line\n');
      await methods['changes.stage']({ path: repo.path, paths: ['f.txt'], on: true });
      repo.write('f.txt', 'one\nstaged-line\nabsent-from-index\n');

      const result = await methods['changes.commit']({ path: repo.path, paths: ['f.txt'], message: 'half', amend: false });
      assert.equal(result.ok, true);
      assert.equal(
        (await repo.git(['show', `${result.commit}:f.txt`])).stdout,
        'one\nstaged-line\n',
        'the commit is the index'
      );
      assert.equal((await repo.status()), 'M f.txt', 'the later edit is still there, unstaged');
    });
  });

  test('one staged hunk of two goes in, the other stays behind', async () => {
    await withRepo(async (repo) => {
      const { lines, changed } = await tenLines(repo);
      const { hunks } = await methods['diff.file']({ path: repo.path, file: 'f.txt', side: 'unstaged' });
      assert.equal(hunks.length, 2, 'the file edits are far enough apart to be two hunks');

      await methods['changes.stageHunks']({ path: repo.path, file: 'f.txt', side: 'unstaged', hunks: [hunks[0]] });

      const index = ['L1', ...lines.slice(1, 9), 'l10'].join('\n') + '\n';
      assert.equal((await repo.git(['show', ':f.txt'])).stdout, index, 'only the first hunk is staged');

      const result = await methods['changes.commit']({ path: repo.path, paths: ['f.txt'], message: 'first hunk', amend: false });
      assert.equal(result.ok, true);
      assert.equal((await repo.git(['show', `${result.commit}:f.txt`])).stdout, index);
      assert.equal((await repo.status()), 'M f.txt', 'the second hunk is still on the worktree side');
      assert.equal((await repo.git(['show', ':f.txt'])).stdout, index);
    });
  });

  test('staging both hunks at once stages everything', async () => {
    await withRepo(async (repo) => {
      const { changed } = await tenLines(repo);
      const { hunks } = await methods['diff.file']({ path: repo.path, file: 'f.txt', side: 'unstaged' });
      await methods['changes.stageHunks']({ path: repo.path, file: 'f.txt', side: 'unstaged', hunks });

      assert.equal(
        (await repo.git(['show', ':f.txt'])).stdout,
        changed.join('\n') + '\n',
        'index now matches the working tree'
      );
      assert.equal((await repo.status()).trim(), 'M  f.txt', 'nothing unstaged left');
    });
  });

  test('an unstage takes a hunk back out of the index', async () => {
    await withRepo(async (repo) => {
      const { lines } = await tenLines(repo);
      repo.write('f.txt', ['L1', ...lines.slice(1)].join('\n') + '\n');
      await methods['changes.stage']({ path: repo.path, paths: ['f.txt'], on: true });

      const { hunks } = await methods['diff.file']({ path: repo.path, file: 'f.txt', side: 'staged' });
      assert.equal(hunks.length, 1, 'one whole-file hunk is staged');
      await methods['changes.stageHunks']({ path: repo.path, file: 'f.txt', side: 'staged', hunks: [hunks[0]] });

      assert.equal(
        (await repo.git(['show', ':f.txt'])).stdout,
        lines.join('\n') + '\n',
        'the index gave that hunk back'
      );
      assert.equal((await repo.status()), 'M f.txt', 'the edit itself is untouched, now unstaged');
    });
  });

  test('a hunk whose file has no trailing newline survives the round trip', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'l1\nl2' });
      repo.write('f.txt', 'L1\nl2');
      const { hunks } = await methods['diff.file']({ path: repo.path, file: 'f.txt', side: 'unstaged' });
      await methods['changes.stageHunks']({ path: repo.path, file: 'f.txt', side: 'unstaged', hunks });

      assert.equal((await repo.git(['show', ':f.txt'])).stdout, 'L1\nl2');
      assert.equal((await repo.status()).trim(), 'M  f.txt');
    });
  });

  test('amend with nothing staged rewrites the message only', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'a.txt': 'a\n' });
      const before = await repo.head();
      const result = await methods['changes.commit']({ path: repo.path, paths: [], message: 'renamed', amend: true });
      assert.equal(result.ok, true);
      assert.equal((await repo.git(['show', '-s', '--format=%s', result.commit])).stdout.trim(), 'renamed');
      assert.equal(
        (await repo.git(['show', '-s', '--format=%T', result.commit])).stdout,
        (await repo.git(['show', '-s', '--format=%T', before])).stdout,
        'the tree is untouched'
      );
    });
  });

  test('refuses a commit when nothing is staged', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'a.txt': 'a\n' });
      repo.write('a.txt', 'b\n');
      await assert.rejects(
        () => methods['changes.commit']({ path: repo.path, paths: ['a.txt'], message: 'nope', amend: false }),
        /Nothing is staged/
      );
    });
  });
});

describe('what hunk staging refuses', () => {
  test('a path that escapes the repository', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'a\n' });
      await assert.rejects(
        () => methods['changes.stageHunks']({
          path: repo.path, file: '../escape.txt', side: 'unstaged',
          hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, heading: '', lines: [] }]
        }),
        /relative file path/
      );
    });
  });

  test('no hunks selected', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'a\n' });
      await assert.rejects(
        () => methods['changes.stageHunks']({ path: repo.path, file: 'f.txt', side: 'unstaged', hunks: [] }),
        /at least one hunk/
      );
    });
  });
});