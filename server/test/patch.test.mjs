/**
 * Patch files and bundles: moving commits without a server.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { methods } from '../api.mjs';
import { Repo, withRepo } from './harness.mjs';

/** Two repositories with the same start, for carrying work from one to the other. */
async function twin(repo) {
  await repo.commit('base', { 'f.txt': 'one\n' });
  const other = await Repo.create();
  await other.git(['pull', '-q', repo.path, 'main']);
  return other;
}

describe('patches', () => {
  test('a commit saved as a patch is replayed as the same commit elsewhere', async () => {
    await withRepo(async (repo) => {
      const other = await twin(repo);
      try {
        const hash = await repo.commit('feat: add two', { 'f.txt': 'one\ntwo\n' }, { env: { GIT_AUTHOR_NAME: 'Ann', GIT_AUTHOR_EMAIL: 'ann@x' } });
        const patch = await methods['patch.create']({ path: repo.path, hashes: [hash] });
        assert.match(patch.name, /^[0-9a-f]{7}-feat-add-two\.patch$/);
        assert.match(patch.content, /^From [0-9a-f]{40} /);

        const result = await methods['patch.apply']({ path: other.path, patch: patch.content });
        assert.deepEqual(result, { ok: true, mode: 'commits', commits: 1 });
        assert.equal((await other.log())[0], 'feat: add two');
        assert.equal((await other.git(['log', '-1', '--format=%an'])).stdout.trim(), 'Ann', 'the author came along');
      } finally {
        await other.destroy();
      }
    });
  });

  test('several commits go into one patch, oldest first', async () => {
    await withRepo(async (repo) => {
      const other = await twin(repo);
      try {
        const a = await repo.commit('first', { 'f.txt': 'one\n1\n' });
        const b = await repo.commit('second', { 'f.txt': 'one\n1\n2\n' });
        const patch = await methods['patch.create']({ path: repo.path, hashes: [b, a] });
        assert.equal(patch.commits, 2);
        assert.ok(patch.content.indexOf('first') < patch.content.indexOf('second'));
        await methods['patch.apply']({ path: other.path, patch: patch.content });
        assert.deepEqual((await other.log()).slice(0, 2), ['second', 'first']);
      } finally {
        await other.destroy();
      }
    });
  });

  test('a plain diff changes the files and makes no commit', async () => {
    await withRepo(async (repo) => {
      const other = await twin(repo);
      try {
        repo.write('f.txt', 'one\nchanged\n');
        const diff = (await repo.git(['diff'])).stdout;
        const result = await methods['patch.apply']({ path: other.path, patch: diff });
        assert.equal(result.mode, 'files');
        assert.match(await other.status(), /M f\.txt/);
        assert.deepEqual(await other.log(), ['base']);
      } finally {
        await other.destroy();
      }
    });
  });

  test('a patch that does not fit changes nothing', async () => {
    await withRepo(async (repo) => {
      const other = await twin(repo);
      try {
        const hash = await repo.commit('change', { 'f.txt': 'ONE\n' });
        const patch = await methods['patch.create']({ path: repo.path, hashes: [hash] });
        await other.commit('conflicting', { 'f.txt': 'something else\n' });
        const head = await other.head();
        await assert.rejects(() => methods['patch.apply']({ path: other.path, patch: patch.content }), /does not apply/);
        assert.equal(await other.head(), head);
        assert.equal(await other.status(), '');
        assert.equal(other.midOperation(), false, 'no half-finished git am is left');
      } finally {
        await other.destroy();
      }
    });
  });
});

describe('bundles', () => {
  test('a bundle carries every branch and tag to another repository', async () => {
    await withRepo(async (repo) => {
      await repo.commits(2);
      await repo.git(['branch', 'topic']);
      await repo.git(['tag', 'v1']);
      const bundle = await methods['bundle.create']({ path: repo.path });
      assert.match(bundle.name, /\.bundle$/);
      assert.ok(bundle.bytes > 0);

      await withRepo(async (other) => {
        await other.commits(1);
        const result = await methods['bundle.import']({ path: other.path, base64: bundle.base64, name: 'laptop' });
        assert.deepEqual(result.branches.sort(), ['laptop/main', 'laptop/topic']);
        assert.equal((await other.git(['rev-parse', 'laptop/main'])).stdout.trim(), await repo.head());
        assert.equal((await other.git(['rev-parse', 'v1^{commit}'])).stdout.trim(), await repo.head());
        assert.equal((await other.log())[0], 'c1', 'no branch of its own moved');
      });
    });
  });

  test('refuses a file that is not a bundle, or a name that is not a plain word', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      const junk = Buffer.from('not a bundle').toString('base64');
      await assert.rejects(() => methods['bundle.import']({ path: repo.path, base64: junk, name: 'x' }), /not a bundle/);
      await assert.rejects(() => methods['bundle.import']({ path: repo.path, base64: junk, name: '--upload-pack=x' }), /Name the bundle/);
    });
  });
});
