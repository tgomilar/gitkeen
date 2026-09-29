/**
 * Blame: which commit last changed each line of a file.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { methods } from '../api.mjs';
import { withRepo } from './harness.mjs';

const ZERO = '0'.repeat(40);

describe('blame', () => {
  test('names the commit that last changed each line', async () => {
    await withRepo(async (repo) => {
      const first = await repo.commit('first', { 'f.txt': 'a\nb\nc\n' });
      const second = await repo.commit('second', { 'f.txt': 'a\nB\nc\n' });
      const { lines, commits } = await methods['blame.file']({ path: repo.path, file: 'f.txt' });
      assert.deepEqual(lines.map((l) => [l.text, l.hash]), [['a', first], ['B', second], ['c', first]]);
      assert.equal(commits[second].summary, 'second');
      assert.equal(commits[second].author, 'Test');
      assert.deepEqual(commits[second].previous, { hash: first, file: 'f.txt' }, 'where the line was before');
    });
  });

  test('the working tree shows lines not committed yet', async () => {
    await withRepo(async (repo) => {
      await repo.commit('first', { 'f.txt': 'a\n' });
      repo.write('f.txt', 'a\nnew\n');
      const { lines } = await methods['blame.file']({ path: repo.path, file: 'f.txt' });
      assert.equal(lines[1].hash, ZERO);
      assert.equal(lines[1].text, 'new');
    });
  });

  test('at a commit, the file as it was then', async () => {
    await withRepo(async (repo) => {
      const first = await repo.commit('first', { 'f.txt': 'a\n' });
      await repo.commit('second', { 'f.txt': 'a\nb\n' });
      const { lines } = await methods['blame.file']({ path: repo.path, file: 'f.txt', rev: first });
      assert.deepEqual(lines.map((l) => l.text), ['a']);
    });
  });

  test('follows a line across a rename', async () => {
    await withRepo(async (repo) => {
      const first = await repo.commit('first', { 'old.txt': 'kept line\n' });
      await repo.git(['mv', 'old.txt', 'new.txt']);
      await repo.git(['commit', '-qm', 'rename']);
      const { lines } = await methods['blame.file']({ path: repo.path, file: 'new.txt' });
      assert.equal(lines[0].hash, first);
    });
  });

  test('refuses a revision or file that looks like an option', async () => {
    await withRepo(async (repo) => {
      await repo.commit('first', { 'f.txt': 'a\n' });
      await assert.rejects(() => methods['blame.file']({ path: repo.path, file: 'f.txt', rev: '--output=x' }), /not a commit/);
      await assert.rejects(() => methods['blame.file']({ path: repo.path, file: '--help' }), /inside the repository/);
      await assert.rejects(() => methods['blame.file']({ path: repo.path, file: '../outside' }), /Unsafe/);
    });
  });
});
