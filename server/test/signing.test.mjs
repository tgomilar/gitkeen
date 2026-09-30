/**
 * Signed commits, with an SSH key so the tests need no gpg setup.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { methods } from '../api.mjs';
import { withRepo } from './harness.mjs';

/** A throwaway SSH key, configured as this repository's signing key. */
async function signingKey(repo, { trusted = true } = {}) {
  const key = join(repo.path, '.git', 'test-signing-key');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'test', '-f', key]);
  await repo.git(['config', 'gpg.format', 'ssh']);
  await repo.git(['config', 'user.signingkey', key]);
  if (trusted) {
    const signers = join(repo.path, '.git', 'allowed-signers');
    writeFileSync(signers, `test@example.com ${readFileSync(`${key}.pub`, 'utf8')}`);
    await repo.git(['config', 'gpg.ssh.allowedSignersFile', signers]);
  }
}

async function commitFile(repo, message, sign) {
  repo.write('f.txt', `${message}\n`);
  await repo.git(['add', 'f.txt']);
  const result = await methods['changes.commit']({ path: repo.path, paths: ['f.txt'], message, sign });
  return (await methods['commit.details']({ path: repo.path, hash: result.commit })).signature;
}

describe('signed commits', () => {
  test('a commit signed from the panel shows a good signature and its signer', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      await signingKey(repo);
      const signature = await commitFile(repo, 'signed', true);
      assert.equal(signature.status, 'good');
      assert.equal(signature.format, 'ssh');
      assert.equal(signature.signer, 'test@example.com');
      assert.ok(signature.key);
    });
  });

  test('turning signing off for one commit wins over commit.gpgsign', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      await signingKey(repo);
      await repo.git(['config', 'commit.gpgsign', 'true']);
      assert.equal((await commitFile(repo, 'default', null)).status, 'good', 'the setting signs by default');
      assert.equal((await commitFile(repo, 'not signed', false)).status, 'none');
    });
  });

  test('a signature from a key Git does not know cannot be checked', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      await signingKey(repo, { trusted: false });
      const signature = await commitFile(repo, 'unknown signer', true);
      assert.equal(signature.format, 'ssh');
      assert.ok(['unknown', 'untrusted'].includes(signature.status), signature.status);
    });
  });

  test('reports how the repository signs', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      assert.deepEqual(await methods['commit.signing']({ path: repo.path }), { format: 'openpgp', key: null, always: false, available: false });
      await signingKey(repo);
      await repo.git(['config', 'commit.gpgsign', 'true']);
      const signing = await methods['commit.signing']({ path: repo.path });
      assert.equal(signing.format, 'ssh');
      assert.equal(signing.always, true);
      assert.equal(signing.available, true);
    });
  });
});
