/**
 * Comparing two branches or commits.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { methods } from '../api.mjs';
import { withRepo } from './harness.mjs';

/** main and topic split after "base"; each then makes commits of its own. */
async function diverged(repo) {
  await repo.commit('base', { 'shared.txt': 'one\n', 'keep.txt': 'k\n' });
  await repo.git(['checkout', '-q', '-b', 'topic']);
  await repo.commit('topic 1', { 'topic.txt': 't\n' });
  await repo.commit('topic 2', { 'shared.txt': 'one\ntopic\n' });
  await repo.git(['checkout', '-q', 'main']);
  await repo.commit('main 1', { 'main.txt': 'm\n' });
}

const subjects = (side) => side.commits.map((c) => c.subject);
const paths = (files) => files.map((f) => f.path).sort();

describe('comparing two branches', () => {
  test('lists the commits only on each side', async () => {
    await withRepo(async (repo) => {
      await diverged(repo);
      const r = await methods['compare.refs']({ path: repo.path, base: 'main', target: 'topic' });
      assert.deepEqual(subjects(r.onlyInTarget), ['topic 2', 'topic 1']);
      assert.deepEqual(subjects(r.onlyInBase), ['main 1']);
      assert.ok(r.mergeBase);
    });
  });

  test('since the split, the files are what a merge would bring in', async () => {
    await withRepo(async (repo) => {
      await diverged(repo);
      const r = await methods['compare.refs']({ path: repo.path, base: 'main', target: 'topic' });
      assert.equal(r.mode, 'split');
      assert.deepEqual(paths(r.files), ['shared.txt', 'topic.txt'], 'main.txt is main\'s own change, not topic\'s');
      assert.equal(r.from, r.mergeBase);
    });
  });

  test('tip to tip, every difference between the two ends counts', async () => {
    await withRepo(async (repo) => {
      await diverged(repo);
      const r = await methods['compare.refs']({ path: repo.path, base: 'main', target: 'topic', mode: 'tips' });
      assert.deepEqual(paths(r.files), ['main.txt', 'shared.txt', 'topic.txt']);
      assert.equal(r.from, r.baseHash);
      const shared = r.files.find((f) => f.path === 'shared.txt');
      assert.deepEqual([shared.added, shared.removed], [1, 0]);
    });
  });

  test('a branch that is only ahead has nothing on the other side', async () => {
    await withRepo(async (repo) => {
      await repo.commits(2);
      await repo.git(['checkout', '-q', '-b', 'ahead']);
      await repo.commit('more', { 'more.txt': 'x\n' });
      const r = await methods['compare.refs']({ path: repo.path, base: 'main', target: 'ahead' });
      assert.deepEqual(subjects(r.onlyInTarget), ['more']);
      assert.deepEqual(subjects(r.onlyInBase), []);
    });
  });

  test('unrelated histories fall back to tip to tip', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      await repo.git(['checkout', '-q', '--orphan', 'other']);
      await repo.git(['rm', '-rq', '.']);
      await repo.commit('unrelated', { 'u.txt': 'u\n' });
      const r = await methods['compare.refs']({ path: repo.path, base: 'main', target: 'other' });
      assert.equal(r.mergeBase, null);
      assert.equal(r.mode, 'tips');
    });
  });

  test('refuses a name that is not a commit, or looks like an option', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      await assert.rejects(() => methods['compare.refs']({ path: repo.path, base: 'main', target: 'nope' }), /not a commit or branch/);
      await assert.rejects(() => methods['compare.refs']({ path: repo.path, base: '--output=x', target: 'main' }), /not a commit Gitalia/);
    });
  });
});
