/**
 * Worktrees: extra working folders of one repository, each with its own
 * branch checked out.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { methods } from '../api.mjs';
import { withRepo } from './harness.mjs';

/** A folder beside the test repository, removed afterwards whatever happens. */
async function beside(repo, body) {
  const dir = join(dirname(repo.path), `${basename(repo.path)}-wt`);
  try {
    return await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('worktrees', () => {
  test('a new branch in a new worktree', async () => {
    await withRepo(async (repo) => beside(repo, async (dir) => {
      await repo.commits(2);
      const result = await methods['worktree.add']({ path: repo.path, dir, branch: 'feature', create: true });
      assert.equal(result.path, dir);
      assert.ok(existsSync(join(dir, 'c1.txt')), 'the files are checked out there');
      const [main, extra] = result.worktrees;
      assert.equal(main.main, true);
      assert.equal(main.current, true);
      assert.equal(extra.branch, 'feature');
      assert.equal(extra.current, false);
      assert.equal((await repo.git(['rev-parse', 'feature'])).stdout.trim(), await repo.head());
    }));
  });

  test('an existing branch, and not one that is already checked out', async () => {
    await withRepo(async (repo) => beside(repo, async (dir) => {
      await repo.commits(1);
      await repo.git(['branch', 'topic']);
      await assert.rejects(
        () => methods['worktree.add']({ path: repo.path, dir, branch: 'main' }),
        /already (checked out|used)/i
      );
      const result = await methods['worktree.add']({ path: repo.path, dir, branch: 'topic' });
      assert.equal(result.worktrees[1].branch, 'topic');
    }));
  });

  test('removing a worktree keeps its branch, and refuses uncommitted work unless forced', async () => {
    await withRepo(async (repo) => beside(repo, async (dir) => {
      await repo.commits(1);
      await methods['worktree.add']({ path: repo.path, dir, branch: 'feature', create: true });
      writeFileSync(join(dir, 'c1.txt'), 'changed there\n');
      await assert.rejects(() => methods['worktree.remove']({ path: repo.path, dir }), /not committed/);
      const result = await methods['worktree.remove']({ path: repo.path, dir, force: true });
      assert.equal(result.worktrees.length, 1);
      assert.equal(existsSync(dir), false);
      assert.equal((await repo.git(['rev-parse', '--verify', 'feature'])).code, 0, 'the branch stays');
    }));
  });

  test('never removes the main worktree or the one that is open', async () => {
    await withRepo(async (repo) => beside(repo, async (dir) => {
      await repo.commits(1);
      await methods['worktree.add']({ path: repo.path, dir, branch: 'feature', create: true });
      const [main] = (await methods['worktree.list']({ path: repo.path })).worktrees;
      await assert.rejects(() => methods['worktree.remove']({ path: dir, dir: main.path }), /main worktree/);
      await assert.rejects(() => methods['worktree.remove']({ path: dir, dir }), /has this worktree open/);
    }));
  });

  test('refuses a folder that exists, a bad branch name, or an option for a branch', async () => {
    await withRepo(async (repo) => beside(repo, async (dir) => {
      await repo.commits(1);
      await assert.rejects(() => methods['worktree.add']({ path: repo.path, dir: repo.path, branch: 'x', create: true }), /already exists/);
      await assert.rejects(() => methods['worktree.add']({ path: repo.path, dir, branch: 'bad..name', create: true }), /not a valid branch/);
      await assert.rejects(() => methods['worktree.add']({ path: repo.path, dir, branch: '--force' }), /not a commit/);
    }));
  });

  test('a worktree whose folder was deleted by hand can be pruned', async () => {
    await withRepo(async (repo) => beside(repo, async (dir) => {
      await repo.commits(1);
      await methods['worktree.add']({ path: repo.path, dir, branch: 'feature', create: true });
      rmSync(dir, { recursive: true, force: true });
      assert.equal((await methods['worktree.list']({ path: repo.path })).worktrees[1].prunable, true);
      const result = await methods['worktree.prune']({ path: repo.path });
      assert.equal(result.worktrees.length, 1);
    }));
  });
});
