/**
 * Submodules: other repositories kept inside this one at a recorded commit.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { methods } from '../api.mjs';
import { Repo, withRepo } from './harness.mjs';

// Git refuses to clone a submodule from a local folder unless told to, which
// is what these tests do. This reaches only the Git processes of this test.
process.env.GIT_CONFIG_COUNT = '1';
process.env.GIT_CONFIG_KEY_0 = 'protocol.file.allow';
process.env.GIT_CONFIG_VALUE_0 = 'always';

/** A library repository, added to `repo` as the submodule `libs/lib`. */
async function withLibrary(repo) {
  const lib = await Repo.create();
  const first = await lib.commit('lib one', { 'lib.txt': '1\n' });
  const second = await lib.commit('lib two', { 'lib.txt': '2\n' });
  await repo.commit('base', { 'a.txt': 'a\n' });
  await repo.git(['submodule', 'add', '-q', lib.path, 'libs/lib']);
  await repo.git(['commit', '-qm', 'add the library']);
  return { lib, first, second };
}

const find = async (path) => (await methods['submodule.list']({ path })).submodules;

describe('submodules', () => {
  test('lists a checked-out submodule with its URL and recorded commit', async () => {
    await withRepo(async (repo) => {
      const { lib, second } = await withLibrary(repo);
      try {
        const [sub] = await find(repo.path);
        assert.equal(sub.path, 'libs/lib');
        assert.equal(sub.url, lib.path);
        assert.equal(sub.state, 'clean');
        assert.equal(sub.recorded, second);
        assert.equal(sub.checkedOut, second);
      } finally {
        await lib.destroy();
      }
    });
  });

  test('a fresh clone has it not checked out, and update brings it in', async () => {
    await withRepo(async (repo) => {
      const { lib, second } = await withLibrary(repo);
      const clone = mkdtempSync(join(tmpdir(), 'gitkeen-clone-'));
      try {
        await repo.git(['clone', '-q', repo.path, clone]);
        let [sub] = await find(clone);
        assert.equal(sub.state, 'not-initialized');
        assert.equal(sub.checkedOut, null);

        const result = await methods['submodule.update']({ path: clone });
        [sub] = result.submodules;
        assert.equal(sub.state, 'clean');
        assert.equal(sub.checkedOut, second);
        assert.ok(existsSync(join(clone, 'libs/lib/lib.txt')));
      } finally {
        rmSync(clone, { recursive: true, force: true });
        await lib.destroy();
      }
    });
  });

  test('a submodule moved to another commit is reported, and update puts it back', async () => {
    await withRepo(async (repo) => {
      const { lib, first, second } = await withLibrary(repo);
      try {
        await new Repo(join(repo.path, 'libs/lib')).git(['checkout', '-q', first]);
        let [sub] = await find(repo.path);
        assert.equal(sub.state, 'moved');
        assert.equal(sub.checkedOut, first);
        assert.equal(sub.recorded, second);

        [sub] = (await methods['submodule.update']({ path: repo.path, paths: ['libs/lib'] })).submodules;
        assert.equal(sub.state, 'clean');
        assert.equal(sub.checkedOut, second);
      } finally {
        await lib.destroy();
      }
    });
  });

  test('refuses a path that is not a submodule', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      await assert.rejects(() => methods['submodule.update']({ path: repo.path, paths: ['nope'] }), /not a submodule/);
      assert.deepEqual(await find(repo.path), []);
    });
  });
});
