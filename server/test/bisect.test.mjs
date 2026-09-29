/**
 * Bisect: halving the range between a good and a bad commit.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { methods } from '../api.mjs';
import { withRepo } from './harness.mjs';

/** Eight commits; the fifth one introduces the "bug". */
async function history(repo) {
  const hashes = [];
  for (let i = 1; i <= 8; i++) {
    hashes.push(await repo.commit(`c${i}`, { 'bug.txt': i >= 5 ? 'broken\n' : 'fine\n', [`f${i}.txt`]: `${i}\n` }));
  }
  return hashes;
}

const broken = async (repo) => (await repo.git(['show', 'HEAD:bug.txt'])).stdout === 'broken\n';

describe('bisect', () => {
  test('finds the first bad commit by testing and marking', async () => {
    await withRepo(async (repo) => {
      const hashes = await history(repo);
      let state = await methods['bisect.start']({ path: repo.path, good: hashes[0] });
      assert.equal(state.running, true);
      assert.ok(state.left > 1);
      assert.equal((await methods['repo.status']({ path: repo.path })).operation, 'bisect');

      let marks = 0;
      for (; !state.found && marks < 10; marks++) {
        state = await methods['bisect.mark']({ path: repo.path, verdict: (await broken(repo)) ? 'bad' : 'good' });
      }
      assert.equal(state.found, hashes[4], 'c5 is where it broke');
      assert.ok(marks <= 3, `eight commits take at most three answers, took ${marks}`);

      await methods['bisect.reset']({ path: repo.path });
      assert.equal((await methods['repo.status']({ path: repo.path })).operation, null);
      assert.equal(await repo.head(), hashes[7], 'back on the branch it started from');
      assert.equal((await repo.git(['branch', '--show-current'])).stdout.trim(), 'main');
    });
  });

  test('the answer is found however the good and bad marks fall', async () => {
    for (let at = 2; at <= 8; at++) {
      await withRepo(async (repo) => {
        const hashes = [];
        for (let i = 1; i <= 8; i++) {
          hashes.push(await repo.commit(`c${i}`, { 'bug.txt': i >= at ? 'broken\n' : 'fine\n', [`f${i}.txt`]: `${i}\n` }));
        }
        let state = await methods['bisect.start']({ path: repo.path, good: hashes[0] });
        for (let n = 0; !state.found && n < 10; n++) {
          state = await methods['bisect.mark']({ path: repo.path, verdict: (await broken(repo)) ? 'bad' : 'good' });
        }
        assert.equal(state.found, hashes[at - 1], `broken from c${at}`);
        await methods['bisect.reset']({ path: repo.path });
      });
    }
  });

  test('a skipped commit is stepped over', async () => {
    await withRepo(async (repo) => {
      const hashes = await history(repo);
      let state = await methods['bisect.start']({ path: repo.path, good: hashes[0], bad: hashes[7] });
      const first = state.current;
      state = await methods['bisect.mark']({ path: repo.path, verdict: 'skip' });
      assert.notEqual(state.current, first, 'another commit is offered');
      assert.deepEqual(state.skipped, [first]);
      await methods['bisect.reset']({ path: repo.path });
    });
  });

  test('refuses to start while another operation is open, or with an option for a commit', async () => {
    await withRepo(async (repo) => {
      const hashes = await history(repo);
      await assert.rejects(() => methods['bisect.start']({ path: repo.path, good: '--help' }), /not a commit/);
      await methods['bisect.start']({ path: repo.path, good: hashes[0] });
      await assert.rejects(() => methods['bisect.start']({ path: repo.path, good: hashes[1] }), /bisect is in progress/);
      await assert.rejects(() => methods['bisect.mark']({ path: repo.path, verdict: 'maybe' }), /good, bad or skip/);
      await methods['bisect.reset']({ path: repo.path });
    });
  });

  test('the graph shows bisect marks as marks, not as branches', async () => {
    await withRepo(async (repo) => {
      const hashes = await history(repo);
      await methods['bisect.start']({ path: repo.path, good: hashes[0] });
      const { commits } = await methods['log.list']({ path: repo.path });
      const refs = commits.flatMap((c) => c.refs);
      assert.ok(refs.some((r) => r.kind === 'bisect' && r.name === 'bad'));
      assert.ok(refs.some((r) => r.kind === 'bisect' && r.name === 'good'));
      assert.ok(!refs.some((r) => r.name.startsWith('refs/')), 'no raw ref names');
      await methods['bisect.reset']({ path: repo.path });
    });
  });
});
