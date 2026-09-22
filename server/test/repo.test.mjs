/**
 * Branches, tags, stashes and the listings the UI is drawn from.
 *
 * Less destructive than the rewrites, but a listing that is quietly wrong
 * misleads every decision made from it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { methods } from '../api.mjs';
import { Repo, withRepo } from './harness.mjs';

describe('listing branches', () => {
  test('separates local branches, remote branches and tags', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'b.txt': 'b\n' });
      await repo.git(['branch', 'feature/one']);
      await repo.git(['tag', 'v1']);
      const { local, tags } = await methods['branches.list']({ path: repo.path });
      assert.deepEqual(local.map((b) => b.name).sort(), ['feature/one', 'main']);
      assert.deepEqual(tags.map((t) => t.name), ['v1']);
      assert.equal(local.find((b) => b.name === 'main').isHead, true);
    });
  });

  // origin/HEAD shortens to plain "origin", which once showed up as a branch
  // named after the remote itself.
  test('leaves out origin/HEAD, which is a pointer and not a branch', async () => {
    const repo = await Repo.create();
    try {
      await repo.withRemote();
      await repo.commit('base', { 'b.txt': 'b\n' });
      await repo.git(['push', '-q', '-u', 'origin', 'main']);
      await repo.git(['remote', 'set-head', 'origin', 'main']);

      const { remote } = await methods['branches.list']({ path: repo.path });
      assert.deepEqual(remote.map((b) => b.name), ['origin/main']);
      assert.ok(!remote.some((b) => b.name === 'origin'), 'no phantom branch');
    } finally {
      await repo.destroy();
    }
  });

  test('reports how far ahead and behind a branch is', async () => {
    const repo = await Repo.create();
    try {
      await repo.withRemote();
      await repo.commit('base', { 'b.txt': 'b\n' });
      await repo.git(['push', '-q', '-u', 'origin', 'main']);
      await repo.commit('ahead', { 'a.txt': 'a\n' });
      const { local } = await methods['branches.list']({ path: repo.path });
      const main = local.find((b) => b.name === 'main');
      assert.equal(main.ahead, 1);
      assert.equal(main.behind, 0);
      assert.equal(main.upstream, 'origin/main');
    } finally {
      await repo.destroy();
    }
  });
});

describe('tags', () => {
  test('a message makes the tag annotated', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'b.txt': 'b\n' });
      const made = await methods['tag.create']({
        path: repo.path, name: 'v1.0.0', at: null, message: 'the first release'
      });
      assert.equal(made.annotated, true);
      const { stdout } = await repo.git(['cat-file', '-t', 'v1.0.0']);
      assert.equal(stdout.trim(), 'tag');
    });
  });

  test('no message makes it lightweight', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'b.txt': 'b\n' });
      const made = await methods['tag.create']({ path: repo.path, name: 'light', at: null, message: '' });
      assert.equal(made.annotated, false);
      const { stdout } = await repo.git(['cat-file', '-t', 'light']);
      assert.equal(stdout.trim(), 'commit');
    });
  });

  test('whitespace alone is not a message', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'b.txt': 'b\n' });
      const made = await methods['tag.create']({ path: repo.path, name: 'blank', at: null, message: '   ' });
      assert.equal(made.annotated, false);
    });
  });

  test('says which remotes also hold a tag, and deleting leaves them alone', async () => {
    const repo = await Repo.create();
    try {
      await repo.withRemote();
      await repo.commit('base', { 'b.txt': 'b\n' });
      await repo.git(['push', '-q', '-u', 'origin', 'main']);
      await methods['tag.create']({ path: repo.path, name: 'v1', at: null, message: 'one' });
      await repo.git(['push', '-q', 'origin', 'v1']);

      const i = await methods['tag.inspect']({ path: repo.path, name: 'v1' });
      assert.deepEqual(i.onRemote, ['origin']);
      assert.equal(i.annotated, true);

      await methods['tag.delete']({ path: repo.path, name: 'v1' });
      const { stdout: local } = await repo.git(['tag', '-l', 'v1']);
      assert.equal(local.trim(), '', 'gone locally');
      const { stdout: remote } = await repo.git(['ls-remote', '--tags', 'origin', 'refs/tags/v1']);
      assert.ok(remote.trim(), 'still on the remote, as the dialog warns');
    } finally {
      await repo.destroy();
    }
  });
});

describe('stashes', () => {
  test('sets work aside, including untracked files, and brings it back', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'tracked.txt': 'one\n' });
      repo.write('tracked.txt', 'edited\n');
      repo.write('new.txt', 'untracked\n');

      const made = await methods['stash.create']({
        path: repo.path, message: 'wip', paths: ['tracked.txt', 'new.txt'], includeUntracked: true
      });
      assert.equal(made.ok, true);
      assert.equal(await repo.status(), '', 'the working tree is clean afterwards');

      const { stashes } = await methods['stash.list']({ path: repo.path });
      assert.equal(stashes.length, 1);
      assert.equal(stashes[0].hasUntracked, true);

      const { files } = await methods['stash.files']({ path: repo.path, ref: stashes[0].ref });
      assert.deepEqual(files.map((f) => f.path).sort(), ['new.txt', 'tracked.txt']);
      assert.equal(files.find((f) => f.path === 'new.txt').untracked, true);

      await methods['stash.apply']({
        path: repo.path, ref: stashes[0].ref, sha: stashes[0].sha, drop: true
      });
      assert.notEqual(await repo.status(), '', 'the changes came back');
      assert.equal((await methods['stash.list']({ path: repo.path })).stashes.length, 0);
    });
  });

  test('refuses to act on a stash that has shifted underneath', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'one\n' });
      repo.write('f.txt', 'first\n');
      await methods['stash.create']({ path: repo.path, message: 'first', paths: ['f.txt'], includeUntracked: false });
      repo.write('f.txt', 'second\n');
      await methods['stash.create']({ path: repo.path, message: 'second', paths: ['f.txt'], includeUntracked: false });

      const { stashes } = await methods['stash.list']({ path: repo.path });
      const older = stashes[1];
      // Drop the newer one, so stash@{1} now names something else entirely.
      await methods['stash.drop']({ path: repo.path, ref: stashes[0].ref, sha: stashes[0].sha });

      await assert.rejects(
        () => methods['stash.drop']({ path: repo.path, ref: older.ref, sha: older.sha }),
        /changed since/i
      );
    });
  });
});

describe('branch operations', () => {
  test('creates, renames and deletes', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'b.txt': 'b\n' });
      await methods['branch.create']({ path: repo.path, name: 'work', from: null, checkout: false });
      await methods['branch.rename']({ path: repo.path, from: 'work', to: 'renamed' });
      let { local } = await methods['branches.list']({ path: repo.path });
      assert.ok(local.some((b) => b.name === 'renamed'));
      await methods['branch.delete']({ path: repo.path, name: 'renamed', force: true });
      ({ local } = await methods['branches.list']({ path: repo.path }));
      assert.ok(!local.some((b) => b.name === 'renamed'));
    });
  });

  test('says whether a branch is merged and where it is published', async () => {
    const repo = await Repo.create();
    try {
      await repo.withRemote();
      await repo.commit('base', { 'b.txt': 'b\n' });
      await repo.git(['push', '-q', '-u', 'origin', 'main']);
      await repo.git(['checkout', '-q', '-b', 'unmerged']);
      await repo.commit('only here', { 'u.txt': 'u\n' });
      await repo.git(['checkout', '-q', 'main']);

      const i = await methods['branch.inspect']({ path: repo.path, name: 'unmerged' });
      assert.equal(i.isMerged, false);
      assert.equal(i.unmergedCommits, 1);
    } finally {
      await repo.destroy();
    }
  });
});
