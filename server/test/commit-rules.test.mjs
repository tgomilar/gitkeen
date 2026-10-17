/**
 * Reading a repository's commitlint rules: a JSON config is held to the same
 * rules as a JS one, so the Commit button blocks what commitlint would refuse.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readCommitRules, validateMessage } from '../commit-rules.mjs';
import { withRepo } from './harness.mjs';

const check = async (repo, message) => validateMessage(message, await readCommitRules(repo.path));

describe('commitlint rules', () => {
  test('a JSON config is enforced', async () => {
    await withRepo(async (repo) => {
      repo.write('.commitlintrc.json', JSON.stringify({
        rules: { 'header-max-length': [2, 'always', 20], 'type-enum': [2, 'always', ['feat', 'fix']] }
      }));
      const rules = await readCommitRules(repo.path);
      assert.equal(rules.maxHeader, 20);
      assert.deepEqual(rules.types, ['feat', 'fix']);

      assert.equal((await check(repo, 'feat: a subject far too long for it')).ok, false);
      assert.match((await check(repo, 'docs: short')).blocking[0].message, /not an allowed type/);
      assert.equal((await check(repo, 'fix: short')).ok, true);
    });
  });

  test('.commitlintrc is read as JSON, and a warning does not block', async () => {
    await withRepo(async (repo) => {
      repo.write('.commitlintrc', JSON.stringify({ rules: { 'header-max-length': [1, 'always', 10] } }));
      const result = await check(repo, 'fix: longer than ten');
      assert.equal(result.problems.length, 1);
      assert.equal(result.blocking.length, 0);
    });
  });

  test('a JSON config that extends the conventional preset gets its rules', async () => {
    await withRepo(async (repo) => {
      repo.write('.commitlintrc.json', JSON.stringify({ extends: ['@commitlint/config-conventional'] }));
      assert.match((await check(repo, 'update things')).blocking[0].message, /must read/);
      assert.equal((await check(repo, 'feat: add a thing')).ok, true);
    });
  });

  test('a JS config is still read', async () => {
    await withRepo(async (repo) => {
      repo.write('commitlint.config.js', "export default { rules: { 'header-max-length': [2, 'always', 20] } };\n");
      assert.equal((await check(repo, 'feat: a subject far too long for it')).ok, false);
    });
  });
});
