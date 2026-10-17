/**
 * Reading a repository's commitlint rules: a JSON config is held to the same
 * rules as a JS one, so the Commit button blocks what commitlint would refuse.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readCommitRules, validateMessage } from '../commit-rules.mjs';
import { repairSubject } from '../suggest.mjs';
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

describe('putting a suggested subject into the format', () => {
  const conventional = async (repo, rules = "'scope-empty': [2, 'always']") => {
    repo.write('commitlint.config.js', `export default { extends: ['@commitlint/config-conventional'], rules: { ${rules} } };\n`);
    return readCommitRules(repo.path);
  };

  test('a type with its colon missing gets one', async () => {
    await withRepo(async (repo) => {
      const rules = await conventional(repo);
      assert.equal(repairSubject('fix api imports', rules), 'fix: api imports');
    });
  });

  test('a subject with no type gets one, from the files, then the verb, then the whole change', async () => {
    await withRepo(async (repo) => {
      const rules = await conventional(repo);
      assert.equal(repairSubject('Update the install guide.', rules, { files: ['docs/install.md'] }), 'docs: update the install guide');
      assert.equal(repairSubject('add a button', rules, { files: ['src/a.ts'] }), 'feat: add a button');
      assert.equal(repairSubject('settings panel', rules, { files: ['src/a.ts'], fallbackType: 'fix' }), 'fix: settings panel');
      for (const s of ['add a button', 'settings panel']) {
        assert.equal(validateMessage(repairSubject(s, rules, { files: ['src/a.ts'] }), rules).ok, true);
      }
    });
  });

  test('a scope is dropped where none is allowed, and kept where it is', async () => {
    await withRepo(async (repo) => {
      assert.equal(repairSubject('Feat(api): add thing', await conventional(repo)), 'feat: add thing');
      assert.equal(repairSubject('feat(api): add thing', await conventional(repo, '')), 'feat(api): add thing');
    });
  });


  test('without commitlint rules nothing is changed', async () => {
    await withRepo(async (repo) => {
      assert.equal(repairSubject('update settings panel', await readCommitRules(repo.path)), 'update settings panel');
    });
  });
});
