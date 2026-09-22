/**
 * Squash and the interactive rebase editor.
 *
 * Both drive `git rebase -i` through the same helper, which writes the todo
 * list from a plan. The plan and the list Git offers must describe the same
 * commits, so the cases here are mostly about that agreement holding.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { methods } from '../api.mjs';
import { withRepo } from './harness.mjs';

describe('squash', () => {
  test('combines a run at the tip', async () => {
    await withRepo(async (repo) => {
      await repo.commits(4);
      const [c4, c3] = await repo.hashes();
      const result = await methods['commits.squash']({
        path: repo.path, hashes: [c4, c3], message: 'feat: combined'
      });
      assert.equal(result.ok, true);
      assert.deepEqual(await repo.log(), ['feat: combined', 'c2', 'c1']);
      assert.deepEqual((await repo.files()).sort(), ['c1.txt', 'c2.txt', 'c3.txt', 'c4.txt']);
    });
  });

  // The path that goes through the rebase helper rather than a soft reset.
  test('combines commits below the tip and replays what follows', async () => {
    await withRepo(async (repo) => {
      await repo.commits(5);
      const h = await repo.hashes(); // c5 c4 c3 c2 c1
      const result = await methods['commits.squash']({
        path: repo.path, hashes: [h[2], h[3]], message: 'feat: middle'
      });
      assert.equal(result.replayed, 2);
      assert.deepEqual(await repo.log(), ['c5', 'c4', 'feat: middle', 'c1']);
      assert.equal((await repo.files()).length, 5, 'no file lost');
    });
  });

  test('refuses a selection that is not contiguous', async () => {
    await withRepo(async (repo) => {
      await repo.commits(4);
      const h = await repo.hashes();
      const i = await methods['commits.inspectSquash']({ path: repo.path, hashes: [h[0], h[2]] });
      assert.equal(i.ok, false);
      assert.match(i.problems.join(' '), /next to each other/i);
    });
  });

  test('refuses without a message', async () => {
    await withRepo(async (repo) => {
      await repo.commits(3);
      const [a, b] = await repo.hashes();
      await assert.rejects(
        () => methods['commits.squash']({ path: repo.path, hashes: [a, b], message: '  ' }),
        /message is required/i
      );
    });
  });
});

describe('the rebase editor', () => {
  test('lists the span oldest first, with full messages', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'base.txt': 'b\n' });
      await repo.commits(3);
      const hashes = await repo.hashes();
      const span = await methods['commits.rebaseSpan']({ path: repo.path, from: hashes[2] });
      assert.equal(span.ok, true, span.problems?.join(' '));
      assert.deepEqual(span.commits.map((c) => c.subject), ['c1', 'c2', 'c3']);
      assert.equal(span.commits[0].message, 'c1', 'the full message comes too');
    });
  });

  test('applies pick, squash, reword and drop in one pass', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'base.txt': 'b\n' });
      await repo.commits(4);
      const from = (await repo.hashes())[3];
      const { commits } = await methods['commits.rebaseSpan']({ path: repo.path, from });
      const [c1, c2, c3, c4] = commits;

      const result = await methods['commits.rebase']({
        path: repo.path,
        from,
        plan: [
          { hash: c1.hash, command: 'pick' },
          { hash: c2.hash, command: 'squash' },
          { hash: c3.hash, command: 'reword', message: 'c3 renamed' },
          { hash: c4.hash, command: 'drop' }
        ]
      });

      assert.equal(result.dropped, 1);
      assert.equal(result.combined, 1);
      assert.equal(result.reworded, 1);
      assert.deepEqual(await repo.log(), ['c3 renamed', 'c1', 'base']);
      assert.ok(!(await repo.files()).includes('c4.txt'), 'the dropped file goes');
      assert.ok((await repo.files()).includes('c2.txt'), 'the squashed file stays');
    });
  });

  test('reorders rows and folds with fixup', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'base.txt': 'b\n' });
      await repo.commits(3);
      const from = (await repo.hashes())[2];
      const { commits } = await methods['commits.rebaseSpan']({ path: repo.path, from });
      const [c1, c2, c3] = commits;

      await methods['commits.rebase']({
        path: repo.path,
        from,
        plan: [
          { hash: c3.hash, command: 'pick' },
          { hash: c1.hash, command: 'pick' },
          { hash: c2.hash, command: 'fixup' }
        ]
      });

      assert.deepEqual(await repo.log(), ['c1', 'c3', 'base']);
      const { stdout } = await repo.git(['log', '--format=%B']);
      assert.ok(!stdout.includes('c2'), 'fixup throws the folded message away');
      assert.equal((await repo.files()).length, 4, 'every file survives');
    });
  });

  test('refuses a plan that drops everything', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'base.txt': 'b\n' });
      await repo.commits(2);
      const from = (await repo.hashes())[1];
      const { commits } = await methods['commits.rebaseSpan']({ path: repo.path, from });
      await assert.rejects(
        () => methods['commits.rebase']({
          path: repo.path, from,
          plan: commits.map((c) => ({ hash: c.hash, command: 'drop' }))
        }),
        /every commit/i
      );
    });
  });

  test('refuses a plan whose oldest kept commit folds upwards', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'base.txt': 'b\n' });
      await repo.commits(2);
      const from = (await repo.hashes())[1];
      const { commits } = await methods['commits.rebaseSpan']({ path: repo.path, from });
      await assert.rejects(
        () => methods['commits.rebase']({
          path: repo.path, from,
          plan: [
            { hash: commits[0].hash, command: 'squash' },
            { hash: commits[1].hash, command: 'pick' }
          ]
        }),
        /oldest commit/i
      );
      assert.equal(repo.midOperation(), false);
    });
  });

  test('refuses an empty plan', async () => {
    await withRepo(async (repo) => {
      await repo.commits(2);
      const from = (await repo.hashes())[0];
      await assert.rejects(
        () => methods['commits.rebase']({ path: repo.path, from, plan: [] }),
        /empty/i
      );
    });
  });
});
