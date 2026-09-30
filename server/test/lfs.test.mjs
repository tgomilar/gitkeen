/**
 * Git LFS: large files stored outside the repository, with a small pointer
 * committed in their place. Skipped when git-lfs is not installed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { methods } from '../api.mjs';
import { withRepo } from './harness.mjs';

let haveLfs = true;
try { execFileSync('git', ['lfs', 'version'], { stdio: 'ignore' }); } catch { haveLfs = false; }

const status = (repo) => methods['lfs.status']({ path: repo.path });

/** LFS set up for this repository only, tracking *.bin, with one file committed. */
async function withLfsFile(repo) {
  await methods['lfs.install']({ path: repo.path });
  await methods['lfs.track']({ path: repo.path, pattern: '*.bin' });
  writeFileSync(join(repo.path, 'big.bin'), Buffer.alloc(4096, 7));
  await repo.git(['add', '.gitattributes', 'big.bin']);
  await repo.git(['commit', '-qm', 'add a large file']);
}

describe('git lfs', { skip: !haveLfs && 'git-lfs is not installed' }, () => {
  test('setting up for one repository leaves the global settings alone', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      const before = await status(repo);
      assert.equal(before.installed, true);
      const after = await methods['lfs.install']({ path: repo.path });
      assert.equal(after.ready, true);
      assert.match((await repo.git(['config', '--local', '--get', 'filter.lfs.clean'])).stdout, /git-lfs clean/);
    });
  });

  test('tracking a pattern writes .gitattributes, and the file is stored as a pointer', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      await withLfsFile(repo);
      assert.match(readFileSync(join(repo.path, '.gitattributes'), 'utf8'), /^\*\.bin filter=lfs/m);
      const s = await status(repo);
      assert.deepEqual(s.patterns.map((p) => p.pattern), ['*.bin']);
      assert.equal(s.files.length, 1);
      assert.equal(s.files[0].path, 'big.bin');
      assert.equal(s.files[0].downloaded, true);
      assert.match((await repo.git(['show', 'HEAD:big.bin'])).stdout, /^version https:\/\/git-lfs/, 'the commit holds a pointer');
    });
  });

  test('untracking removes the pattern', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      await withLfsFile(repo);
      const s = await methods['lfs.untrack']({ path: repo.path, pattern: '*.bin' });
      assert.deepEqual(s.patterns, []);
    });
  });

  test('a diff of an LFS file says what changed, not the pointer lines', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      await withLfsFile(repo);
      writeFileSync(join(repo.path, 'big.bin'), Buffer.alloc(8192, 9));
      const diff = await methods['diff.file']({ path: repo.path, file: 'big.bin' });
      assert.equal(diff.lfs.before.size, 4096);
      assert.equal(diff.lfs.after.size, 8192);
      assert.notEqual(diff.lfs.before.oid, diff.lfs.after.oid);
    });
  });

  test('a clone that skipped the downloads gets the content with pull', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      await withLfsFile(repo);
      const clone = mkdtempSync(join(tmpdir(), 'gitalia-lfs-'));
      try {
        execFileSync('git', ['clone', '-q', repo.path, clone], { env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' } });
        execFileSync('git', ['lfs', 'install', '--local'], { cwd: clone, stdio: 'ignore' });
        let s = await methods['lfs.status']({ path: clone });
        assert.equal(s.files[0].downloaded, false, 'only the pointer is here');
        s = await methods['lfs.pull']({ path: clone });
        assert.equal(s.files[0].downloaded, true);
        assert.equal(readFileSync(join(clone, 'big.bin')).length, 4096);
      } finally {
        rmSync(clone, { recursive: true, force: true });
      }
    });
  });

  test('refuses a pattern that looks like an option', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      await assert.rejects(() => methods['lfs.track']({ path: repo.path, pattern: '--help' }), /file pattern/);
    });
  });
});

describe('a diff that is not LFS', () => {
  test('carries no LFS reading', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'a\n' });
      repo.write('f.txt', 'b\n');
      assert.equal((await methods['diff.file']({ path: repo.path, file: 'f.txt' })).lfs, null);
    });
  });
});
