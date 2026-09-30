/**
 * Taking only some files out of a stash.
 *
 * Git has no command for this, so Gitkeen rebuilds the stash itself. The cases
 * worth having are the ones where a wrong step would lose work: the files left
 * behind must stay in the stash, a file with changes of its own must not be
 * overwritten, and Undo must be able to put the whole stash back.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { methods } from '../api.mjs';
import { withRepo } from './harness.mjs';

/** A repository with one stash holding three tracked edits and one new file. */
async function stashed(repo) {
  await repo.commit('base', { 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' });
  repo.write('a.txt', 'a edited\n');
  repo.write('b.txt', 'b edited\n');
  repo.write('c.txt', 'c edited\n');
  repo.write('new.txt', 'new\n');
  await methods['stash.create']({
    path: repo.path, message: 'an experiment', paths: ['a.txt', 'b.txt', 'c.txt', 'new.txt'], includeUntracked: true
  });
  return (await methods['stash.list']({ path: repo.path })).stashes[0];
}

const read = (repo, name) => readFileSync(join(repo.path, name), 'utf8');
const filesIn = async (repo, ref) => (await methods['stash.files']({ path: repo.path, ref })).files.map((f) => f.path).sort();

describe('unstashing chosen files', () => {
  test('brings back only the chosen files, and keeps the rest in the stash', async () => {
    await withRepo(async (repo) => {
      const stash = await stashed(repo);
      const result = await methods['stash.applyFiles']({
        path: repo.path, ref: stash.ref, sha: stash.sha, paths: ['a.txt', 'new.txt'], drop: true
      });
      assert.equal(result.dropped, true);
      assert.equal(result.stashGone, false);

      assert.equal(read(repo, 'a.txt'), 'a edited\n');
      assert.equal(read(repo, 'new.txt'), 'new\n');
      assert.equal(read(repo, 'b.txt'), 'b\n', 'a file that was not chosen stays as it was');

      const { stdout: staged } = await repo.git(['diff', '--cached', '--name-only']);
      assert.equal(staged.trim(), '', 'the change comes back unstaged, as git stash apply leaves it');

      const [left] = (await methods['stash.list']({ path: repo.path })).stashes;
      assert.deepEqual(await filesIn(repo, left.ref), ['b.txt', 'c.txt']);
      assert.equal(left.message, 'an experiment', 'the stash keeps its name');
      assert.equal(left.date, stash.date, 'and its date');
      assert.equal(left.hasUntracked, false, 'its only untracked file came out, so the third parent goes');
    });
  });

  test('drops the stash when every file came out of it', async () => {
    await withRepo(async (repo) => {
      const stash = await stashed(repo);
      const result = await methods['stash.applyFiles']({
        path: repo.path, ref: stash.ref, sha: stash.sha, paths: ['a.txt', 'b.txt', 'c.txt', 'new.txt'], drop: true
      });
      assert.equal(result.stashGone, true);
      assert.equal((await methods['stash.list']({ path: repo.path })).stashes.length, 0);
    });
  });

  test('applying chosen files leaves the stash exactly as it was', async () => {
    await withRepo(async (repo) => {
      const stash = await stashed(repo);
      await methods['stash.applyFiles']({ path: repo.path, ref: stash.ref, sha: stash.sha, paths: ['c.txt'], drop: false });
      assert.equal(read(repo, 'c.txt'), 'c edited\n');
      const [same] = (await methods['stash.list']({ path: repo.path })).stashes;
      assert.equal(same.sha, stash.sha);
    });
  });

  test('refuses to overwrite a file that has changes of its own', async () => {
    await withRepo(async (repo) => {
      const stash = await stashed(repo);
      repo.write('a.txt', 'something else\n');
      repo.write('new.txt', 'made again\n');
      await assert.rejects(
        () => methods['stash.applyFiles']({ path: repo.path, ref: stash.ref, sha: stash.sha, paths: ['a.txt', 'new.txt'], drop: true }),
        /a\.txt, new\.txt have changes of their own/
      );
      assert.equal(read(repo, 'a.txt'), 'something else\n', 'nothing was overwritten');
      assert.equal(read(repo, 'new.txt'), 'made again\n');
      const [same] = (await methods['stash.list']({ path: repo.path })).stashes;
      assert.equal(same.sha, stash.sha, 'and the stash was not touched');
    });
  });

  test('applies on top of commits made after the stash', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'long.txt': 'one\ntwo\nthree\nfour\nfive\n' });
      repo.write('long.txt', 'one\ntwo\nthree\nfour\nFIVE\n');
      await methods['stash.create']({ path: repo.path, message: 'end', paths: ['long.txt'], includeUntracked: false });
      await repo.commit('start changed', { 'long.txt': 'ONE\ntwo\nthree\nfour\nfive\n' });
      const [stash] = (await methods['stash.list']({ path: repo.path })).stashes;
      await methods['stash.applyFiles']({ path: repo.path, ref: stash.ref, sha: stash.sha, paths: ['long.txt'], drop: true });
      assert.equal(read(repo, 'long.txt'), 'ONE\ntwo\nthree\nfour\nFIVE\n', 'both changes are kept');
    });
  });

  test('Undo puts the whole stash back', async () => {
    await withRepo(async (repo) => {
      const stash = await stashed(repo);
      await methods['stash.applyFiles']({ path: repo.path, ref: stash.ref, sha: stash.sha, paths: ['a.txt'], drop: true });
      const { entries } = await methods['recovery.list']({ path: repo.path });
      const entry = entries.find((e) => e.operation === 'stash.applyFiles');
      assert.ok(entry, 'the operation is in the log');
      await methods['recovery.restore']({ path: repo.path, id: entry.id });
      const all = (await methods['stash.list']({ path: repo.path })).stashes;
      assert.ok(all.some((s) => s.sha === stash.sha), 'the original stash is on the list again');
      assert.ok(existsSync(join(repo.path, 'a.txt')));
    });
  });
});
