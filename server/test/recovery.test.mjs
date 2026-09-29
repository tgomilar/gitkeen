/**
 * The operation log and its recovery points.
 *
 * Every operation that rewrites or deletes history leaves a recovery point,
 * and restoring one must put things back exactly, without touching work the
 * user has not committed. The graph must never show the recovery points.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { methods } from '../api.mjs';
import { withRepo } from './harness.mjs';

const entries = async (repo) => (await methods['recovery.list']({ path: repo.path })).entries;

describe('the operation log', () => {
  test('a reset is logged, and restoring it brings the commits back', async () => {
    await withRepo(async (repo) => {
      await repo.commits(3);
      const tip = await repo.head();
      const [, , c1] = await repo.hashes();
      await methods['branch.reset']({ path: repo.path, target: c1, mode: 'hard' });
      assert.deepEqual(await repo.log(), ['c1']);

      const [entry] = await entries(repo);
      assert.equal(entry.label, 'Reset main (hard)');
      assert.equal(entry.before, tip);
      assert.equal(entry.restorable, true);

      await methods['recovery.restore']({ path: repo.path, id: entry.id });
      assert.equal(await repo.head(), tip);
      assert.deepEqual(await repo.log(), ['c3', 'c2', 'c1']);
    });
  });

  test('a restore is logged too, so it can be undone', async () => {
    await withRepo(async (repo) => {
      await repo.commits(2);
      const [c2, c1] = await repo.hashes();
      await methods['branch.reset']({ path: repo.path, target: c1, mode: 'hard' });
      const [reset] = await entries(repo);
      await methods['recovery.restore']({ path: repo.path, id: reset.id });

      const [undo] = await entries(repo);
      assert.match(undo.label, /^Restore: Reset main/);
      await methods['recovery.restore']({ path: repo.path, id: undo.id });
      assert.equal(await repo.head(), c1, 'back where the reset left it');
      assert.ok(c2);
    });
  });

  test('restoring the current branch keeps uncommitted work in other files', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'keep.txt': 'k\n' });
      await repo.commits(2);
      const tip = await repo.head();
      await methods['commits.drop']({ path: repo.path, hashes: [tip] });
      repo.write('keep.txt', 'my unsaved edit\n');

      const [entry] = await entries(repo);
      assert.equal(entry.label, 'Dropped commits from main');
      await methods['recovery.restore']({ path: repo.path, id: entry.id });
      assert.equal(await repo.head(), tip);
      assert.match(await repo.status(), /^ ?M keep\.txt$/m, 'the edit is still there, unstaged');
    });
  });

  test('a deleted branch comes back', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      await repo.git(['checkout', '-q', '-b', 'topic']);
      const tip = await repo.commit('topic work', { 't.txt': 't\n' });
      await repo.git(['checkout', '-q', 'main']);
      await methods['branch.delete']({ path: repo.path, name: 'topic', force: true });

      const [entry] = await entries(repo);
      assert.equal(entry.label, 'Deleted branch topic');
      const result = await methods['recovery.restore']({ path: repo.path, id: entry.id });
      assert.equal(result.recreated, true);
      assert.equal((await repo.git(['rev-parse', 'topic'])).stdout.trim(), tip);
    });
  });

  test('an amend is logged, an ordinary commit is not', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      const before = await repo.head();
      repo.write('n.txt', 'n\n');
      await repo.git(['add', 'n.txt']);
      await methods['changes.commit']({ path: repo.path, paths: ['n.txt'], message: 'new', amend: false });
      assert.equal((await entries(repo)).length, 0);

      await methods['changes.commit']({ path: repo.path, paths: [], message: 'new, reworded', amend: true });
      const [entry] = await entries(repo);
      assert.equal(entry.label, 'Amended the last commit on main');
      assert.notEqual(entry.before, before);
    });
  });

  test('a dropped stash goes back on the stash list', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      repo.write('c1.txt', 'stashed edit\n');
      await repo.git(['stash', 'push', '-q', '-m', 'wip']);
      const { stdout: sha } = await repo.git(['rev-parse', 'stash@{0}']);
      await methods['stash.drop']({ path: repo.path, ref: 'stash@{0}', sha: sha.trim() });
      assert.equal((await repo.git(['stash', 'list'])).stdout, '');

      const [entry] = await entries(repo);
      await methods['recovery.restore']({ path: repo.path, id: entry.id });
      assert.equal((await repo.git(['rev-parse', 'stash@{0}'])).stdout.trim(), sha.trim());
    });
  });

  test('a deleted tag comes back under its own name', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      await methods['tag.create']({ path: repo.path, name: 'v1', at: null, message: 'first' });
      const { stdout: tag } = await repo.git(['rev-parse', 'refs/tags/v1']);
      await methods['tag.delete']({ path: repo.path, name: 'v1' });
      const [entry] = await entries(repo);
      await methods['recovery.restore']({ path: repo.path, id: entry.id });
      assert.equal((await repo.git(['rev-parse', 'refs/tags/v1'])).stdout.trim(), tag.trim(), 'the annotated tag itself');
    });
  });

  test('nothing is restored while another operation is open', async () => {
    await withRepo(async (repo) => {
      await repo.commits(2);
      const [, c1] = await repo.hashes();
      await methods['branch.reset']({ path: repo.path, target: c1, mode: 'hard' });
      const [entry] = await entries(repo);
      await repo.git(['checkout', '-q', '-b', 'x']);
      await repo.commit('x', { 'c1.txt': 'x\n' });
      await repo.git(['checkout', '-q', 'main']);
      await repo.commit('main', { 'c1.txt': 'm\n' });
      await methods['repo.merge']({ path: repo.path, source: 'x' });
      await assert.rejects(() => methods['recovery.restore']({ path: repo.path, id: entry.id }), /in progress/);
    });
  });

  test('a force push keeps the old remote tip, and restores it as a local branch', async () => {
    await withRepo(async (repo) => {
      await repo.withRemote();
      await repo.commits(2);
      await methods['repo.push']({ path: repo.path, remote: 'origin', setUpstream: true });
      const pushed = await repo.head();
      await repo.git(['commit', '-q', '--amend', '-m', 'c2 rewritten']);
      await methods['repo.push']({ path: repo.path, force: true });

      const [entry] = await entries(repo);
      assert.equal(entry.label, 'Force pushed main');
      assert.equal(entry.before, pushed);
      const result = await methods['recovery.restore']({ path: repo.path, id: entry.id });
      assert.equal(result.name, 'recovered/main');
      assert.equal((await repo.git(['rev-parse', 'recovered/main'])).stdout.trim(), pushed);
    });
  });

  test('recovery points never appear in the graph', async () => {
    await withRepo(async (repo) => {
      await repo.commits(3);
      const [, , c1] = await repo.hashes();
      await methods['branch.reset']({ path: repo.path, target: c1, mode: 'hard' });
      const { commits } = await methods['log.list']({ path: repo.path });
      assert.deepEqual(commits.map((c) => c.subject), ['c1'], 'the dropped commits are not drawn');
      assert.ok(commits.every((c) => c.refs.every((r) => !r.name.includes('gitalia'))));
    });
  });
});
