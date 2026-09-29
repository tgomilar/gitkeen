/**
 * Squash and the interactive rebase editor.
 *
 * Both drive `git rebase -i` through the same helper, which writes the todo
 * list from a plan. The plan and the list Git offers must describe the same
 * commits, so the cases here are mostly about that agreement holding.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
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

describe('the rebase editor: edit (stop to amend)', () => {
  test('an edit in the plan stops the rebase at that commit', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'base.txt': 'b\n' });
      await repo.commits(4);
      const from = (await repo.hashes())[3];
      const { commits } = await methods['commits.rebaseSpan']({ path: repo.path, from });
      const [c1, c2] = commits;

      const result = await methods['commits.rebase']({
        path: repo.path,
        from,
        plan: [
          { hash: c1.hash, command: 'pick' },
          { hash: c2.hash, command: 'edit' },
          { hash: commits[2].hash, command: 'pick' },
          { hash: commits[3].hash, command: 'pick' }
        ]
      });

      assert.equal(result.stopped, true, 'an edit is a pause, not a finish');
      assert.equal(result.stoppedAt, c2.hash);
      assert.equal(repo.midOperation(), true, 'the rebase is still running');
      assert.equal((await repo.log())[0], 'c2', 'the branch pauses at the edited commit');
    });
  });

  test('continue folds working-tree changes in, and rewrites what follows', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'base.txt': 'b\n' });
      await repo.commits(4);
      const from = (await repo.hashes())[3];
      const { commits } = await methods['commits.rebaseSpan']({ path: repo.path, from });
      const [c1, c2, c3, c4] = commits;
      const plan = [
        { hash: c1.hash, command: 'pick' },
        { hash: c2.hash, command: 'edit' },
        { hash: c3.hash, command: 'reword', message: 'c3 renamed' },
        { hash: c4.hash, command: 'pick' }
      ];

      const stopped = await methods['commits.rebase']({ path: repo.path, from, plan });
      assert.equal(stopped.stopped, true);

      // The user edits a file while the rebase is paused; nothing is staged.
      repo.write('c2.txt', 'changed by hand\n');

      const continued = await methods['repo.continueOperation']({ path: repo.path, plan });
      assert.equal(continued.ok, true);
      assert.equal(continued.finished, true);
      assert.deepEqual(await repo.log(), ['c4', 'c3 renamed', 'c2', 'c1', 'base']);
      const { stdout } = await repo.git(['show', 'HEAD:c2.txt']);
      assert.equal(stdout, 'changed by hand\n', 'the change joined the stopped commit');
    });
  });

  test('a message written for the edit retitles the stopped commit on continue', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'base.txt': 'b\n' });
      await repo.commits(3);
      const from = (await repo.hashes())[2];
      const { commits } = await methods['commits.rebaseSpan']({ path: repo.path, from });
      const [c1, c2] = commits;
      const plan = [
        { hash: c1.hash, command: 'pick' },
        { hash: c2.hash, command: 'edit', message: 'c2 retitled' },
        { hash: commits[2].hash, command: 'pick' }
      ];

      await methods['commits.rebase']({ path: repo.path, from, plan });
      const continued = await methods['repo.continueOperation']({ path: repo.path, plan });
      assert.equal(continued.finished, true);
      assert.deepEqual(await repo.log(), ['c3', 'c2 retitled', 'c1', 'base']);
    });
  });

  test('an edit that is the last line finishes on continue', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'base.txt': 'b\n' });
      await repo.commits(3);
      const from = (await repo.hashes())[2];
      const { commits } = await methods['commits.rebaseSpan']({ path: repo.path, from });
      const plan = commits.map((c, i) => ({ hash: c.hash, command: (i === 2 ? 'edit' : 'pick') }));

      const stopped = await methods['commits.rebase']({ path: repo.path, from, plan });
      assert.equal(stopped.stopped, true);

      const continued = await methods['repo.continueOperation']({ path: repo.path, plan });
      assert.equal(continued.finished, true);
      assert.deepEqual(await repo.log(), ['c3', 'c2', 'c1', 'base']);
      assert.equal(repo.midOperation(), false);
    });
  });

  test('two edits in one plan stop twice, then finish', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'base.txt': 'b\n' });
      await repo.commits(4);
      const from = (await repo.hashes())[3];
      const { commits } = await methods['commits.rebaseSpan']({ path: repo.path, from });
      const plan = commits.map((c, i) => ({ hash: c.hash, command: (i === 1 || i === 3 ? 'edit' : 'pick') }));

      const first = await methods['commits.rebase']({ path: repo.path, from, plan });
      assert.equal(first.stoppedAt, commits[1].hash);

      const second = await methods['repo.continueOperation']({ path: repo.path, plan });
      assert.equal(second.ok, true);
      assert.equal(second.finished, false, 'the second edit stops it again');
      assert.equal(second.stoppedAt, commits[3].hash);

      const third = await methods['repo.continueOperation']({ path: repo.path, plan });
      assert.equal(third.finished, true);
      assert.deepEqual(await repo.log(), ['c4', 'c3', 'c2', 'c1', 'base']);
    });
  });

  test('aborting during an edit stop leaves the branch alone', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'base.txt': 'b\n' });
      await repo.commits(3);
      const from = (await repo.hashes())[2];
      const { commits } = await methods['commits.rebaseSpan']({ path: repo.path, from });
      const plan = [
        { hash: commits[0].hash, command: 'pick' },
        { hash: commits[1].hash, command: 'edit' },
        { hash: commits[2].hash, command: 'pick' }
      ];

      const stopped = await methods['commits.rebase']({ path: repo.path, from, plan });
      assert.equal(stopped.stopped, true);

      const aborted = await methods['repo.abortOperation']({ path: repo.path });
      assert.equal(aborted.operation, 'rebase');
      assert.equal(repo.midOperation(), false);
      assert.deepEqual(await repo.log(), ['c3', 'c2', 'c1', 'base']);
    });
  });
});

describe('continuing an edit stop', () => {
  /** base, c1…c4, then a plan that stops at c2 with `edit` (and `extra` on it). */
  async function stopAtC2(repo, extra = {}, later = {}) {
    await repo.commit('base', { 'base.txt': 'b\n' });
    await repo.commits(4);
    const from = (await repo.hashes())[3];
    const { commits } = await methods['commits.rebaseSpan']({ path: repo.path, from });
    const [c1, c2, c3, c4] = commits;
    const plan = [
      { hash: c1.hash, command: 'pick' },
      { hash: c2.hash, command: 'edit', ...extra },
      { hash: c3.hash, command: 'pick', ...later },
      { hash: c4.hash, command: 'pick' }
    ];
    const stopped = await methods['commits.rebase']({ path: repo.path, from, plan });
    assert.equal(stopped.stopped, true);
    return plan;
  }

  test('a new message and file changes are both folded in', async () => {
    await withRepo(async (repo) => {
      const plan = await stopAtC2(repo, { message: 'c2 retitled' });
      repo.write('c2.txt', 'changed by hand\n');

      const continued = await methods['repo.continueOperation']({ path: repo.path, plan });
      assert.equal(continued.finished, true);
      assert.deepEqual(await repo.log(), ['c4', 'c3', 'c2 retitled', 'c1', 'base']);
      assert.equal((await repo.git(['show', 'HEAD~2:c2.txt'])).stdout, 'changed by hand\n');
      assert.equal(repo.midOperation(), false);
    });
  });

  test('an untracked file nobody staged stays out of the commit', async () => {
    await withRepo(async (repo) => {
      const plan = await stopAtC2(repo);
      repo.write('c2.txt', 'changed by hand\n');
      repo.write('junk.log', 'noise\n');

      const continued = await methods['repo.continueOperation']({ path: repo.path, plan });
      assert.equal(continued.finished, true);
      assert.equal((await repo.git(['show', 'HEAD~2:c2.txt'])).stdout, 'changed by hand\n');
      assert.equal((await repo.files()).includes('junk.log'), false, 'not committed');
      assert.match(await repo.status(), /^\?\? junk\.log$/m, 'still there, untracked');
    });
  });

  test('commits made at the stop are kept as they are', async () => {
    await withRepo(async (repo) => {
      const plan = await stopAtC2(repo, { message: 'c2 retitled' });
      // Split the stopped commit in two by hand.
      await repo.git(['reset', '-q', 'HEAD^']);
      await repo.commit('split part A', { 'c2.txt': '2\n' });
      await repo.commit('split part B', { 'extra.txt': 'x\n' });

      const continued = await methods['repo.continueOperation']({ path: repo.path, plan });
      assert.equal(continued.finished, true);
      assert.deepEqual(await repo.log(), ['c4', 'c3', 'split part B', 'split part A', 'c1', 'base']);
    });
  });

  test('without the plan, the one saved when the rebase started is used', async () => {
    await withRepo(async (repo) => {
      await stopAtC2(repo, {}, { command: 'reword', message: 'c3 renamed' });
      // The app was reloaded: nothing on the client remembers the plan.
      const continued = await methods['repo.continueOperation']({ path: repo.path });
      assert.equal(continued.finished, true);
      assert.deepEqual(await repo.log(), ['c4', 'c3 renamed', 'c2', 'c1', 'base']);
    });
  });

  test('a stop in a linked worktree is reported as a stop', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'base.txt': 'b\n' });
      await repo.commits(3);
      const tree = join(repo.path, '..', `wt-${Date.now()}`);
      await repo.git(['worktree', 'add', '-q', '-b', 'side', tree]);
      try {
        const from = (await repo.hashes())[2];
        const { commits } = await methods['commits.rebaseSpan']({ path: tree, from });
        const plan = commits.map((c, i) => ({ hash: c.hash, command: i === 1 ? 'edit' : 'pick' }));

        const stopped = await methods['commits.rebase']({ path: tree, from, plan });
        assert.equal(stopped.stopped, true);
        assert.equal(stopped.stoppedAt, commits[1].hash);
        assert.equal((await methods['repo.status']({ path: tree })).operation, 'rebase');

        const continued = await methods['repo.continueOperation']({ path: tree, plan });
        assert.equal(continued.finished, true);
        assert.equal((await methods['repo.status']({ path: tree })).operation, null);
      } finally {
        await repo.git(['worktree', 'remove', '--force', tree]);
        rmSync(tree, { recursive: true, force: true });
      }
    });
  });
});

describe('a rebase that meets a conflict', () => {
  /** base, then two commits that edit the same line, then a third unrelated one. */
  async function clashing(repo) {
    await repo.commit('base', { 'f.txt': 'one\n' });
    await repo.commit('first edit', { 'f.txt': 'two\n' });
    await repo.commit('second edit', { 'f.txt': 'three\n' });
    await repo.commit('other', { 'o.txt': 'o\n' });
    const from = (await repo.hashes())[2];
    const { commits } = await methods['commits.rebaseSpan']({ path: repo.path, from });
    return { from, commits };
  }

  test('stops with the conflict open instead of abandoning the plan', async () => {
    await withRepo(async (repo) => {
      const { from, commits } = await clashing(repo);
      const [first, second, other] = commits;
      // Swapping the two edits makes the second one conflict.
      const plan = [
        { hash: second.hash, command: 'pick' },
        { hash: first.hash, command: 'pick' },
        { hash: other.hash, command: 'reword', message: 'other, renamed' }
      ];
      const result = await methods['commits.rebase']({ path: repo.path, from, plan });
      assert.equal(result.stopped, true);
      assert.equal(result.conflicted, true);
      assert.equal(repo.midOperation(), true, 'the rebase waits for the conflict');
      assert.match(await repo.status(), /^(UU|AA) f\.txt$/m);

      // Resolve each stop the way the merge editor does, then continue. Both
      // swapped edits touch the same line, so both of them stop.
      let continued, stops = 0;
      do {
        stops++;
        await methods['conflicts.resolve']({ path: repo.path, file: 'f.txt', content: `resolved ${stops}\n` });
        continued = await methods['repo.continueOperation']({ path: repo.path });
      } while (continued.conflicted && stops < 3);
      assert.equal(stops, 2);
      assert.equal(continued.finished, true);
      assert.equal(repo.midOperation(), false);
      assert.deepEqual(await repo.log(), ['other, renamed', 'first edit', 'second edit', 'base'],
        'the rest of the plan, the reword included, was applied from the saved plan');
      assert.equal((await repo.git(['show', 'HEAD:f.txt'])).stdout, 'resolved 2\n');
    });
  });

  test('a conflict met while continuing is a stop too', async () => {
    await withRepo(async (repo) => {
      const { from, commits } = await clashing(repo);
      const [first, second, other] = commits;
      const plan = [
        { hash: first.hash, command: 'edit' },
        { hash: other.hash, command: 'pick' },
        { hash: second.hash, command: 'pick' }
      ];
      const stopped = await methods['commits.rebase']({ path: repo.path, from, plan });
      assert.equal(stopped.conflicted, false, 'the edit stop is not a conflict');
      // Change the line at the stop so that "second edit" no longer applies.
      repo.write('f.txt', 'changed at the stop\n');
      const continued = await methods['repo.continueOperation']({ path: repo.path, plan });
      assert.equal(continued.ok, true);
      assert.equal(continued.finished, false);
      assert.equal(continued.conflicted, true);
      assert.equal(repo.midOperation(), true);
    });
  });

  test('Abandon puts the branch back after a conflict stop', async () => {
    await withRepo(async (repo) => {
      const { from, commits } = await clashing(repo);
      const before = await repo.head();
      const [first, second, other] = commits;
      await methods['commits.rebase']({
        path: repo.path, from,
        plan: [{ hash: second.hash, command: 'pick' }, { hash: first.hash, command: 'pick' }, { hash: other.hash, command: 'pick' }]
      });
      await methods['repo.abortOperation']({ path: repo.path });
      assert.equal(await repo.head(), before);
      assert.equal(repo.midOperation(), false);
      assert.equal(await repo.status(), '');
    });
  });
});

describe('why a rebase is paused', () => {
  test('the status says edit for an edit stop, and conflict for a conflict stop', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'one\n' });
      await repo.commit('first edit', { 'f.txt': 'two\n' });
      await repo.commit('second edit', { 'f.txt': 'three\n' });
      const from = (await repo.hashes())[1];
      const { commits } = await methods['commits.rebaseSpan']({ path: repo.path, from });
      const [first, second] = commits;

      await methods['commits.rebase']({ path: repo.path, from, plan: [{ hash: first.hash, command: 'edit' }, { hash: second.hash, command: 'pick' }] });
      assert.equal((await methods['repo.status']({ path: repo.path })).rebaseStop, 'edit');
      await methods['repo.abortOperation']({ path: repo.path });

      await methods['commits.rebase']({ path: repo.path, from, plan: [{ hash: second.hash, command: 'pick' }, { hash: first.hash, command: 'pick' }] });
      assert.equal((await methods['repo.status']({ path: repo.path })).rebaseStop, 'conflict');
      await methods['repo.abortOperation']({ path: repo.path });
      assert.equal((await methods['repo.status']({ path: repo.path })).rebaseStop, null);
    });
  });
});
