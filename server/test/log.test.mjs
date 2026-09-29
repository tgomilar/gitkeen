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
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

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
describe('whether there is another page', () => {
  test('a history exactly one page long has no next page', async () => {
    await withRepo(async (repo) => {
      await repo.commits(5);
      const page = await methods['log.list']({ path: repo.path, limit: 5 });
      assert.equal(page.commits.length, 5);
      assert.equal(page.truncated, false);
    });
  });

  test('one commit more makes a next page, and the page stays at the limit', async () => {
    await withRepo(async (repo) => {
      await repo.commits(6);
      const page = await methods['log.list']({ path: repo.path, limit: 5 });
      assert.equal(page.commits.length, 5);
      assert.equal(page.truncated, true);
    });
  });
});

describe('a graph narrowed to one branch', () => {
  test('lists the branch history, with recovery points still hidden', async () => {
    await withRepo(async (repo) => {
      await repo.commits(3);
      await repo.git(['checkout', '-q', '-b', 'topic']);
      await repo.commit('topic work', { 't.txt': 't\n' });
      await repo.git(['checkout', '-q', 'main']);
      const [, , c1] = await repo.hashes();
      await methods['branch.reset']({ path: repo.path, target: c1, mode: 'hard' });

      const { commits } = await methods['log.list']({ path: repo.path, refs: ['topic'] });
      assert.deepEqual(commits.map((c) => c.subject), ['topic work', 'c3', 'c2', 'c1']);
      assert.ok(commits.every((c) => c.refs.every((r) => !r.name.includes('gitalia'))));
    });
  });
});

describe('searching the whole history', () => {
  async function history(repo) {
    const ann = { GIT_AUTHOR_NAME: 'Ann', GIT_AUTHOR_EMAIL: 'ann@x', GIT_AUTHOR_DATE: '@1600000000', GIT_COMMITTER_DATE: '@1600000000' };
    const bob = { GIT_AUTHOR_NAME: 'Bob', GIT_AUTHOR_EMAIL: 'bob@x', GIT_AUTHOR_DATE: '@1700000000', GIT_COMMITTER_DATE: '@1700000000' };
    mkdirSync(join(repo.path, 'src'));
    await repo.commit('fix the login page', { 'src/login.js': '1' }, { env: ann });
    await repo.commit('add a README', { 'README.md': '1' }, { env: bob });
    await repo.commit('Fix the Login redirect', { 'src/login.js': '2' }, { env: bob });
  }
  const subjects = async (repo, query) =>
    (await methods['log.search']({ path: repo.path, query })).commits.map((c) => c.subject);

  test('every word must be in the message, whatever its case', async () => {
    await withRepo(async (repo) => {
      await history(repo);
      assert.deepEqual(await subjects(repo, 'login fix'), ['Fix the Login redirect', 'fix the login page']);
      assert.deepEqual(await subjects(repo, 'login redirect'), ['Fix the Login redirect']);
    });
  });

  test('author, path and date qualifiers', async () => {
    await withRepo(async (repo) => {
      await history(repo);
      assert.deepEqual(await subjects(repo, 'author:ann'), ['fix the login page']);
      assert.deepEqual(await subjects(repo, 'path:src/login.js author:bob'), ['Fix the Login redirect']);
      assert.deepEqual(await subjects(repo, 'since:2022-01-01'), ['Fix the Login redirect', 'add a README']);
      assert.deepEqual(await subjects(repo, 'until:2021-01-01'), ['fix the login page']);
      assert.deepEqual(await subjects(repo, 'path:"README.md"'), ['add a README']);
    });
  });

  test('a hash finds its commit', async () => {
    await withRepo(async (repo) => {
      await history(repo);
      const [, readme] = await repo.hashes();
      assert.deepEqual(await subjects(repo, readme.slice(0, 7)), ['add a README']);
    });
  });

  test('a value that looks like an option stays a value', async () => {
    await withRepo(async (repo) => {
      await history(repo);
      const out = join(repo.path, 'leaked.txt');
      assert.deepEqual(await subjects(repo, `author:--output=${out} --output=${out}`), []);
      assert.equal(existsSync(out), false, 'nothing was written');
    });
  });

  test('commits kept only by a recovery point are not found', async () => {
    await withRepo(async (repo) => {
      await history(repo);
      const [, , first] = await repo.hashes();
      await methods['branch.reset']({ path: repo.path, target: first, mode: 'hard' });
      assert.deepEqual(await subjects(repo, 'login'), ['fix the login page']);
    });
  });
});

describe('ref labels in the graph', () => {
  test('a local branch with a slash is local, not remote', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      await repo.git(['branch', 'feature/login']);
      await repo.git(['tag', 'v1']);
      await repo.withRemote();
      await repo.git(['push', '-q', 'origin', 'main']);
      await repo.git(['fetch', '-q', 'origin']);
      const { commits } = await methods['log.list']({ path: repo.path });
      const refs = Object.fromEntries(commits[0].refs.map((r) => [r.name, r.kind]));
      assert.equal(refs['feature/login'], 'local');
      assert.equal(refs['origin/main'], 'remote');
      assert.equal(refs.v1, 'tag');
      assert.equal(refs.main, 'local');
      assert.ok(commits[0].refs.find((r) => r.name === 'main').isHead);
    });
  });
});
