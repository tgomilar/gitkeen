/**
 * Moving, dropping and rebasing commits.
 *
 * These rewrite history, so a bug here costs the user real work. The cases
 * that matter most are the ones where Gitalia must refuse: a wrong refusal
 * is an annoyance, a wrong rewrite is lost commits.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { methods } from '../api.mjs';
import { withRepo } from './harness.mjs';

describe('moving a commit', () => {
  test('moves one place towards HEAD', async () => {
    await withRepo(async (repo) => {
      await repo.commits(4);
      const [, , c2] = await repo.hashes(); // newest first: c4 c3 c2 c1
      await methods['commits.move']({ path: repo.path, hash: c2, direction: 'up' });
      assert.deepEqual(await repo.log(), ['c4', 'c2', 'c3', 'c1']);
      assert.deepEqual((await repo.files()).sort(), ['c1.txt', 'c2.txt', 'c3.txt', 'c4.txt']);
    });
  });

  test('moves one place away from HEAD', async () => {
    await withRepo(async (repo) => {
      await repo.commits(4);
      const [c4] = await repo.hashes();
      await methods['commits.move']({ path: repo.path, hash: c4, direction: 'down' });
      assert.deepEqual(await repo.log(), ['c3', 'c4', 'c2', 'c1']);
    });
  });

  test('refuses to move the newest commit further up', async () => {
    await withRepo(async (repo) => {
      await repo.commits(3);
      const [newest] = await repo.hashes();
      await assert.rejects(
        () => methods['commits.move']({ path: repo.path, hash: newest, direction: 'up' }),
        /already the newest/
      );
      assert.deepEqual(await repo.log(), ['c3', 'c2', 'c1'], 'history untouched');
    });
  });

  test('refuses to move the oldest commit further down', async () => {
    await withRepo(async (repo) => {
      await repo.commits(3);
      const hashes = await repo.hashes();
      await assert.rejects(
        () => methods['commits.move']({ path: repo.path, hash: hashes.at(-1), direction: 'down' }),
        /already the oldest|first commit/
      );
      assert.deepEqual(await repo.log(), ['c3', 'c2', 'c1'], 'history untouched');
    });
  });

  // Four commits, so the pair being swapped never reaches the root: the
  // first commit of a repository has no parent to rebase onto.
  test('a move back and forth returns the original order', async () => {
    await withRepo(async (repo) => {
      await repo.commits(4);
      const before = await repo.log();
      const [, c3] = await repo.hashes(); // c4 c3 c2 c1
      await methods['commits.move']({ path: repo.path, hash: c3, direction: 'up' });
      assert.deepEqual(await repo.log(), ['c3', 'c4', 'c2', 'c1'], 'it moved');
      // The hash changed when it was rewritten, so find it again by position.
      const moved = (await repo.hashes())[0];
      await methods['commits.move']({ path: repo.path, hash: moved, direction: 'down' });
      assert.deepEqual(await repo.log(), before, 'and came back');
    });
  });
});

describe('a merge in the way', () => {
  /** A branch whose tip is a merge, with commits below the merge point. */
  async function merged(repo) {
    await repo.commits(2);                       // c1 c2 on main
    await repo.git(['checkout', '-q', '-b', 'side']);
    await repo.commit('side work', { 'side.txt': 'side\n' });
    await repo.git(['checkout', '-q', 'main']);
    await repo.commit('main work', { 'main.txt': 'main\n' });
    await repo.git(['merge', '-q', '--no-ff', 'side', '-m', 'merge: side']);
  }

  // The bug that reached the user: `base..HEAD` counted both sides of the
  // merge, so the plan named more commits than the todo list Git offered.
  test('refuses to move a commit from under a merge', async () => {
    await withRepo(async (repo) => {
      await merged(repo);
      const before = await repo.head();
      const hashes = await repo.hashes();
      await assert.rejects(
        () => methods['commits.move']({ path: repo.path, hash: hashes[2], direction: 'up' }),
        /merge/i
      );
      assert.equal(await repo.head(), before, 'nothing moved');
      assert.equal(repo.midOperation(), false, 'no rebase left behind');
    });
  });

  test('refuses to drop a commit from under a merge', async () => {
    await withRepo(async (repo) => {
      await merged(repo);
      const before = await repo.head();
      const hashes = await repo.hashes();
      await assert.rejects(
        () => methods['commits.drop']({ path: repo.path, hashes: [hashes[2]] }),
        /merge/i
      );
      assert.equal(await repo.head(), before);
      assert.equal(repo.midOperation(), false);
    });
  });

  test('refuses to open the rebase editor across a merge', async () => {
    await withRepo(async (repo) => {
      await merged(repo);
      const hashes = await repo.hashes();
      const span = await methods['commits.rebaseSpan']({ path: repo.path, from: hashes[2] });
      assert.equal(span.ok, false);
      assert.match(span.problems.join(' '), /merge/i);
    });
  });

  test('refuses to drop the merge commit itself', async () => {
    await withRepo(async (repo) => {
      await merged(repo);
      const [tip] = await repo.hashes();
      await assert.rejects(
        () => methods['commits.drop']({ path: repo.path, hashes: [tip] }),
        /merge/i
      );
    });
  });
});

describe('dropping commits', () => {
  test('removes one commit and replays the rest', async () => {
    await withRepo(async (repo) => {
      await repo.commits(4);
      const [, , c2] = await repo.hashes();
      const result = await methods['commits.drop']({ path: repo.path, hashes: [c2] });
      assert.equal(result.dropped, 1);
      assert.equal(result.replayed, 2);
      assert.deepEqual(await repo.log(), ['c4', 'c3', 'c1']);
      assert.ok(!(await repo.files()).includes('c2.txt'), 'its file goes with it');
    });
  });

  test('removes several at once', async () => {
    await withRepo(async (repo) => {
      await repo.commits(5);
      const h = await repo.hashes(); // c5 c4 c3 c2 c1
      await methods['commits.drop']({ path: repo.path, hashes: [h[1], h[3]] });
      assert.deepEqual(await repo.log(), ['c5', 'c3', 'c1']);
    });
  });

  test('removes the newest, which needs no replay', async () => {
    await withRepo(async (repo) => {
      await repo.commits(3);
      const [newest] = await repo.hashes();
      const result = await methods['commits.drop']({ path: repo.path, hashes: [newest] });
      assert.equal(result.replayed, 0);
      assert.deepEqual(await repo.log(), ['c2', 'c1']);
    });
  });

  test('leaves the branch alone when a replay conflicts', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'one\n' });
      await repo.commit('adds a line', { 'f.txt': 'one\ntwo\n' });
      await repo.commit('builds on it', { 'f.txt': 'one\ntwo\nthree\n' });
      const before = await repo.head();
      const hashes = await repo.hashes();
      await assert.rejects(
        () => methods['commits.drop']({ path: repo.path, hashes: [hashes[1]] }),
        /could not be replayed|depends on/i
      );
      assert.equal(await repo.head(), before, 'branch put back');
      assert.equal(await repo.status(), '', 'working tree clean');
      assert.equal(repo.midOperation(), false, 'no rebase left behind');
    });
  });
});

describe('what a rewrite refuses to start', () => {
  test('uncommitted changes', async () => {
    await withRepo(async (repo) => {
      await repo.commits(2);
      repo.write('c1.txt', 'edited\n');
      const [, c1] = await repo.hashes();
      const i = await methods['commits.inspectRewrite']({ path: repo.path, hashes: [c1], mode: 'drop' });
      assert.equal(i.ok, false);
      assert.match(i.problems.join(' '), /uncommitted/i);
    });
  });

  test('but not an untracked file, which Git can work around', async () => {
    await withRepo(async (repo) => {
      await repo.commits(2);
      repo.write('untracked.txt', 'new\n');
      const [c2] = await repo.hashes();
      const i = await methods['commits.inspectRewrite']({ path: repo.path, hashes: [c2], mode: 'drop' });
      assert.equal(i.ok, true, i.problems.join(' '));
    });
  });

  test('the first commit of the repository', async () => {
    await withRepo(async (repo) => {
      await repo.commits(2);
      const root = (await repo.hashes()).at(-1);
      const i = await methods['commits.inspectRewrite']({ path: repo.path, hashes: [root], mode: 'drop' });
      assert.equal(i.ok, false);
      assert.match(i.problems.join(' '), /first commit/i);
    });
  });
});
