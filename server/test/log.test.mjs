/**
 * Paged reading of the log.
 *
 * The graph window on the client walks deeper by `skip`; each page must be,
 * and stay, the exact continuation of the previous one. Bisecting a history
 * of equal-dated, merge-heavy commits is the case most likely to wander,
 * because ordering then leans entirely on Git's tie-break, so that is what
 * these tests build.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { methods } from '../api.mjs';
import { Repo, withRepo } from './harness.mjs';

/** Same instant for every commit, so ordering leans on the tie-break. */
const AT = { GIT_AUTHOR_DATE: '@1500000000', GIT_COMMITTER_DATE: '@1500000000' };

/** Hash list from one `log.list` call. */
async function hashes(repo, options) {
  const { commits } = await methods['log.list']({ path: repo.path, ...options });
  return commits.map((c) => c.hash);
}

/** A repository whose history is a thicket: merges, a side branch, a tag and a stash. */
async function buildThicket(repo) {
  // main: m0 m1 m2 m3
  await repo.commit('m0', { f: '0' });
  await repo.commit('m1', { f: '1' });
  await repo.commit('m2', { f: '2' });
  await repo.commit('m3', { f: '3' });

  // topic from m1: t0 t1 t2, all stamped at the same instant.
  await repo.git(['checkout', '-q', '-b', 'topic', 'HEAD~2']);
  await repo.commit('t0', { t: '0' }, { env: AT });
  await repo.commit('t1', { t: '1' }, { env: AT });
  await repo.commit('t2', { t: '2' }, { env: AT });

  // A second feature from m0 that is never merged.
  await repo.git(['checkout', '-q', '-b', 'side', 'HEAD~3']);
  await repo.commit('s0', { s: '0' }, { env: AT });
  await repo.commit('s1', { s: '1' }, { env: AT });
  await repo.commit('s2', { s: '2' }, { env: AT });

  // main swallows topic in a merge, then keeps going.
  await repo.git(['checkout', '-q', 'main']);
  await repo.git(['merge', '-q', '--no-ff', '-m', 'merge topic', 'topic'], { env: AT });
  await repo.commit('m4', { f: '4' }, { env: AT });

  // A tag, and a stash that must never appear in the pages.
  await methods['tag.create']({ path: repo.path, name: 'v1', at: null, message: 'one' });
  await repo.write('wip.txt', 'wip');
  await repo.git(['add', 'wip.txt']);
  await repo.git(['stash', 'push', '-q', '-m', 'wip']);
}

/** Walk the whole history in pages, returning the concatenated hashes. */
async function pageThrough(repo, { step = 4, limit = step, rest = {} }) {
  const collected = [];
  for (let skip = 0, truncated = true; truncated; skip += step) {
    const page = await methods['log.list']({ path: repo.path, limit, skip, ...rest });
    if (page.commits.length === 0) break;
    collected.push(...page.commits.map((c) => c.hash));
    truncated = page.truncated;
    if (collected.length > 500) break; // a runaway loop is a bug
  }
  return collected;
}

describe('paged log reading', () => {
  test('pages of an equal-dated thicket concatenate to the full history', async () => {
    await withRepo(async (repo) => {
      await buildThicket(repo);
      const full = await hashes(repo, { limit: 10000, all: true });
      const paged = await pageThrough(repo, { rest: { all: true } });
      assert.equal(paged.length, full.length);
      assert.deepEqual(paged, full, 'the same commits, in the same order');
    });
  });

  test('re-running the walk twice gives the same pages', async () => {
    await withRepo(async (repo) => {
      await buildThicket(repo);
      assert.deepEqual(
        await pageThrough(repo, { rest: { all: true } }),
        await pageThrough(repo, { rest: { all: true } }),
        'a later process continues where the earlier one left off'
      );
    });
  });

  test('a scoped page continues the same way', async () => {
    await withRepo(async (repo) => {
      await buildThicket(repo);
      const scoped = { refs: ['main'], all: false };
      const full = await hashes(repo, { limit: 10000, ...scoped });
      const paged = await pageThrough(repo, { step: 3, rest: scoped });
      assert.deepEqual(paged, full, 'the branch view paginates identically');
    });
  });

  test('a full page is marked truncated and the last short page is not', async () => {
    await withRepo(async (repo) => {
      await repo.commits(10);
      const first = await methods['log.list']({ path: repo.path, limit: 4, all: true });
      assert.equal(first.commits.length, 4);
      assert.equal(first.truncated, true, 'a full page promises more');
      const middle = await methods['log.list']({ path: repo.path, limit: 4, all: true, skip: 4 });
      assert.equal(middle.commits.length, 4, 'the middle page is exactly its limit');
      assert.equal(middle.truncated, true);
      const last = await methods['log.list']({ path: repo.path, limit: 4, all: true, skip: 8 });
      assert.equal(last.commits.length, 2, 'the last page holds the remainder');
      assert.equal(last.truncated, false, 'a short page is the end');
    });
  });

  test('skipping past the end returns an empty page', async () => {
    await withRepo(async (repo) => {
      await repo.commits(3);
      const page = await methods['log.list']({ path: repo.path, limit: 4, all: true, skip: 10 });
      assert.equal(page.commits.length, 0);
      assert.equal(page.truncated, false);
    });
  });

  test('an empty repository offers nothing, truncated or not', async () => {
    await withRepo(async (repo) => {
      const page = await methods['log.list']({ path: repo.path, limit: 4, all: true, skip: 0 });
      assert.equal(page.commits.length, 0);
      assert.equal(page.truncated, false);
    });
  });
});