/**
 * Push, pull and merge.
 *
 * The case that matters most is the lease on a force push: it is the only
 * thing standing between "replace the remote branch" and "throw away work a
 * colleague pushed while you were not looking".
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { methods } from '../api.mjs';
import { Repo, withRepo } from './harness.mjs';

/** A repository with a remote, one commit pushed, and main tracking it. */
async function published() {
  const repo = await Repo.create();
  await repo.withRemote();
  await repo.commit('base', { 'base.txt': 'b\n' });
  await repo.git(['push', '-q', '-u', 'origin', 'main']);
  return repo;
}

/** A second clone of the same remote, standing in for a colleague. */
async function colleague(repo) {
  const other = new Repo(await (async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    return mkdtemp(join(tmpdir(), 'gitalia-other-'));
  })());
  await repo.git(['clone', '-q', repo.remote, other.path], { cwd: undefined });
  await other.git(['config', 'user.name', 'Other']);
  await other.git(['config', 'user.email', 'other@example.com']);
  return other;
}

describe('push', () => {
  test('sends a branch that is ahead', async () => {
    const repo = await published();
    try {
      await repo.commit('new work', { 'w.txt': 'w\n' });
      const result = await methods['repo.push']({ path: repo.path });
      assert.equal(result.ok, true);
      const { stdout } = await repo.git(['rev-parse', 'origin/main']);
      assert.equal(stdout.trim(), await repo.head());
    } finally {
      await repo.destroy();
    }
  });

  test('is refused when the branch is behind', async () => {
    const repo = await published();
    const other = await colleague(repo);
    try {
      await other.commit('theirs', { 't.txt': 't\n' });
      await other.git(['push', '-q', 'origin', 'main']);
      await repo.commit('mine', { 'm.txt': 'm\n' });
      await assert.rejects(
        () => methods['repo.push']({ path: repo.path }),
        /remote has commits/i
      );
    } finally {
      await repo.destroy();
      await other.destroy();
    }
  });

  test('pushes a branch that is not checked out, and only that branch', async () => {
    const repo = await published();
    try {
      await repo.git(['checkout', '-q', '-b', 'side']);
      await repo.commit('side work', { 's.txt': 's\n' });
      await repo.git(['push', '-q', '-u', 'origin', 'side']);
      await repo.commit('more side work', { 's2.txt': 's\n' });
      await repo.git(['checkout', '-q', 'main']);
      const mainBefore = (await repo.git(['rev-parse', 'origin/main'])).stdout.trim();

      const result = await methods['repo.push']({ path: repo.path, branch: 'side' });
      assert.equal(result.branch, 'side');
      const { stdout: sideNow } = await repo.git(['rev-parse', 'origin/side']);
      const { stdout: sideLocal } = await repo.git(['rev-parse', 'side']);
      assert.equal(sideNow.trim(), sideLocal.trim(), 'side went up');
      const { stdout: mainNow } = await repo.git(['rev-parse', 'origin/main']);
      assert.equal(mainNow.trim(), mainBefore, 'main untouched');
    } finally {
      await repo.destroy();
    }
  });
});

describe('force push', () => {
  test('replaces the remote branch after a rewrite', async () => {
    const repo = await published();
    try {
      await repo.commit('to be rewritten', { 'r.txt': 'r\n' });
      await repo.git(['push', '-q', 'origin', 'main']);
      await repo.git(['commit', '-q', '--amend', '-m', 'rewritten']);
      const result = await methods['repo.push']({ path: repo.path, force: true });
      assert.equal(result.forced, true);
      const { stdout } = await repo.git(['rev-parse', 'origin/main']);
      assert.equal(stdout.trim(), await repo.head());
    } finally {
      await repo.destroy();
    }
  });

  // Without the lease naming the ref, this is how a colleague's work is lost.
  test('the lease refuses when the remote moved unseen', async () => {
    const repo = await published();
    const other = await colleague(repo);
    try {
      await other.commit('work of a colleague', { 'c.txt': 'c\n' });
      await other.git(['push', '-q', 'origin', 'main']);
      const theirs = await other.head();

      // Never fetched, so our view of origin/main is out of date.
      await repo.commit('mine', { 'm.txt': 'm\n' });
      await assert.rejects(
        () => methods['repo.push']({ path: repo.path, force: true }),
        /remote moved/i
      );

      const { stdout } = await repo.git(['ls-remote', 'origin', 'refs/heads/main']);
      assert.ok(stdout.includes(theirs), 'their commit survived');
    } finally {
      await repo.destroy();
      await other.destroy();
    }
  });

  test('the lease protects a branch that is not checked out', async () => {
    const repo = await published();
    const other = await colleague(repo);
    try {
      await repo.git(['checkout', '-q', '-b', 'side']);
      await repo.commit('side', { 's.txt': 's\n' });
      await repo.git(['push', '-q', '-u', 'origin', 'side']);
      await repo.git(['checkout', '-q', 'main']);

      await other.git(['fetch', '-q']);
      await other.git(['checkout', '-q', '-B', 'side', 'origin/side']);
      await other.commit('their side work', { 'ts.txt': 't\n' });
      await other.git(['push', '-q', 'origin', 'side']);
      const theirs = await other.head();

      await repo.git(['branch', '-f', 'side', 'main']); // rewrite without fetching
      await assert.rejects(
        () => methods['repo.push']({ path: repo.path, branch: 'side', force: true }),
        /remote moved/i
      );
      const { stdout } = await repo.git(['ls-remote', 'origin', 'refs/heads/side']);
      assert.ok(stdout.includes(theirs), 'their side work survived');
    } finally {
      await repo.destroy();
      await other.destroy();
    }
  });
});

describe('pull', () => {
  test('fast-forwards when nothing local is in the way', async () => {
    const repo = await published();
    const other = await colleague(repo);
    try {
      await other.commit('theirs one', { 't1.txt': 't\n' });
      await other.commit('theirs two', { 't2.txt': 't\n' });
      await other.git(['push', '-q', 'origin', 'main']);

      const i = await methods['repo.inspectPull']({ path: repo.path });
      assert.equal(i.fastForward, true);
      assert.equal(i.behind, 2);

      const result = await methods['repo.pull']({ path: repo.path });
      assert.equal(result.conflicted, false);
      const { stdout } = await repo.git(['rev-list', '--count', '--merges', `${result.previousHead}..HEAD`]);
      assert.equal(stdout.trim(), '0', 'a fast-forward makes no merge commit');
    } finally {
      await repo.destroy();
      await other.destroy();
    }
  });

  test('merges when both sides moved, keeping the local commit', async () => {
    const repo = await published();
    const other = await colleague(repo);
    try {
      await other.commit('theirs', { 't.txt': 't\n' });
      await other.git(['push', '-q', 'origin', 'main']);
      await repo.commit('mine', { 'm.txt': 'm\n' });

      const i = await methods['repo.inspectPull']({ path: repo.path });
      assert.equal(i.fastForward, false);

      const result = await methods['repo.pull']({ path: repo.path });
      assert.equal(result.conflicted, false);
      const { stdout } = await repo.git(['rev-list', '--count', '--merges', `${result.previousHead}..HEAD`]);
      assert.equal(stdout.trim(), '1', 'a merge commit records the join');
      assert.ok((await repo.log()).includes('mine'), 'the local commit is kept');
    } finally {
      await repo.destroy();
      await other.destroy();
    }
  });

  test('leaves the merge open on a conflict, for the status bar to finish', async () => {
    const repo = await published();
    const other = await colleague(repo);
    try {
      await other.commit('theirs', { 'base.txt': 'theirs\n' });
      await other.git(['push', '-q', 'origin', 'main']);
      await repo.commit('mine', { 'base.txt': 'mine\n' });

      const result = await methods['repo.pull']({ path: repo.path });
      assert.equal(result.conflicted, true);
      const status = await methods['repo.status']({ path: repo.path });
      assert.equal(status.operation, 'merge');

      await methods['repo.abortOperation']({ path: repo.path });
      assert.equal((await methods['repo.status']({ path: repo.path })).operation, null);
      assert.equal(repo.midOperation(), false);
    } finally {
      await repo.destroy();
      await other.destroy();
    }
  });

  test('refuses with uncommitted changes', async () => {
    const repo = await published();
    try {
      repo.write('base.txt', 'edited\n');
      const i = await methods['repo.inspectPull']({ path: repo.path });
      assert.equal(i.ok, false);
      assert.match(i.problems.join(' '), /uncommitted/i);
    } finally {
      await repo.destroy();
    }
  });
});

describe('merge', () => {
  test('names the files that would conflict, without touching anything', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'one\n', 'g.txt': 'one\n' });
      await repo.git(['checkout', '-q', '-b', 'topic']);
      await repo.commit('topic', { 'f.txt': 'topic\n', 'g.txt': 'topic\n' });
      await repo.git(['checkout', '-q', 'main']);
      await repo.commit('main', { 'f.txt': 'main\n', 'g.txt': 'main\n' });

      const i = await methods['repo.inspectMerge']({ path: repo.path, source: 'topic' });
      assert.deepEqual(i.conflicts.sort(), ['f.txt', 'g.txt']);
      assert.equal(await repo.status(), '', 'nothing touched to find out');
      assert.equal(repo.midOperation(), false);
    });
  });

  test('fast-forwards when the branch has nothing of its own', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'b.txt': 'b\n' });
      await repo.git(['checkout', '-q', '-b', 'topic']);
      await repo.commit('topic', { 't.txt': 't\n' });
      await repo.git(['checkout', '-q', 'main']);

      const i = await methods['repo.inspectMerge']({ path: repo.path, source: 'topic' });
      assert.equal(i.fastForward, true);
      const result = await methods['repo.merge']({ path: repo.path, source: 'topic' });
      assert.equal(result.mergeCommit, false, 'no merge commit when none is needed');
    });
  });

  test('refuses to merge a branch into itself', async () => {
    await withRepo(async (repo) => {
      await repo.commits(2);
      const i = await methods['repo.inspectMerge']({ path: repo.path, source: 'main' });
      assert.equal(i.ok, false);
      assert.match(i.problems.join(' '), /branch you are on/i);
    });
  });
});
