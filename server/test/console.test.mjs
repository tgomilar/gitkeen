/**
 * The smart console: what it runs, what it refuses, and the safety net under
 * the commands that can lose work.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { methods } from '../api.mjs';
import { tokenize, checkCommand } from '../console.mjs';
import { withRepo } from './harness.mjs';

const run = (repo, line, confirmed = false) => methods['console.run']({ path: repo.path, line, confirmed });
const undoLatest = async (repo) => {
  const [entry] = (await methods['recovery.list']({ path: repo.path })).entries;
  await methods['recovery.restore']({ path: repo.path, id: entry.id });
  return entry;
};

describe('what the console will run', () => {
  test('arguments are split like a shell would, but nothing is run by a shell', () => {
    assert.deepEqual(tokenize('commit -m "fix: two words" --no-verify').args, ['commit', '-m', 'fix: two words', '--no-verify']);
    assert.deepEqual(tokenize("log --grep='a b'").args, ['log', '--grep=a b']);
    for (const line of ['status | cat', 'log; rm -rf x', 'log && echo', 'show $(id)', 'log `id`', 'diff > out']) {
      assert.match(tokenize(line).error, /shell syntax/, line);
    }
    assert.match(tokenize('commit -m "open').error, /not closed/);
  });

  test('only everyday Git commands, and none of the options that start a program', () => {
    for (const args of [['frobnicate'], ['-c', 'core.pager=x', 'log'], ['fetch', '--upload-pack=x'], ['push', '--receive-pack=x'],
      ['rebase', '--exec', 'rm x', 'main'], ['diff', '--output=/tmp/x'], ['config', 'alias.x', '!rm'], ['log', '--ext-diff'], ['merge', '-s', 'mine', 'x']]) {
      assert.equal(checkCommand(args).ok, false, args.join(' '));
    }
    assert.equal(checkCommand(['config', '--get', 'user.name']).ok, true);
  });

  test('a command that would wait for an editor goes to Gitalia\'s editor instead', () => {
    assert.deepEqual(checkCommand(['rebase', '-i', 'HEAD~3']).redirect, { to: 'rebase', base: 'HEAD~3' });
    assert.deepEqual(checkCommand(['add', '-p', 'a.txt']).redirect, { to: 'hunks', file: 'a.txt' });
    assert.deepEqual(checkCommand(['commit']).redirect, { to: 'commit' });
    assert.equal(checkCommand(['commit', '--amend']).ok, true, 'amending keeps the message, no editor needed');
  });
});

describe('running commands', () => {
  test('status and log come back as data to draw', async () => {
    await withRepo(async (repo) => {
      await repo.commits(3);
      repo.write('c1.txt', 'changed\n');
      const status = await run(repo, 'git status');
      assert.equal(status.ok, true);
      assert.equal(status.kind, 'status');
      assert.deepEqual(status.data.files.map((f) => f.path), ['c1.txt']);
      const log = await run(repo, 'log -n 2');
      assert.equal(log.kind, 'log');
      assert.deepEqual(log.data.commits.map((c) => c.subject), ['c3', 'c2']);
    });
  });

  test('an error comes back with its meaning in plain words', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      const r = await run(repo, 'switch mian');
      assert.equal(r.ok, false);
      assert.ok(r.explanation, 'there is an explanation');
      assert.match(`${r.explanation.what} ${r.explanation.fix}`, /Tab|find|cannot/i);
    });
  });

  test('nothing waits for an editor', async () => {
    await withRepo(async (repo) => {
      await repo.commits(2);
      const r = await run(repo, 'commit --amend', true);
      assert.equal(r.ok, true, r.stderr);
      assert.equal((await repo.log())[0], 'c2', 'the message is kept');
    });
  });
});

describe('the safety net', () => {
  test('a risky command waits for confirmation, and says what it would do', async () => {
    await withRepo(async (repo) => {
      await repo.commits(3);
      const tip = await repo.head();
      const first = await run(repo, 'reset --hard HEAD~2');
      assert.equal(first.needsConfirm, true);
      assert.match(first.preview.lines.join(' '), /2 commits back/);
      assert.equal(await repo.head(), tip, 'nothing ran yet');
    });
  });

  test('reset --hard is undone from the Undo panel, work in files included', async () => {
    await withRepo(async (repo) => {
      await repo.commits(3);
      const tip = await repo.head();
      repo.write('c3.txt', 'unsaved work\n');
      const r = await run(repo, 'reset --hard HEAD~2', true);
      assert.equal(r.ok, true);
      assert.ok(r.recorded >= 2, 'the branch and the file were both saved');
      const entries = (await methods['recovery.list']({ path: repo.path })).entries;
      // Restore the branch first, then the file on top of it.
      await methods['recovery.restore']({ path: repo.path, id: entries.find((e) => e.target.kind === 'branch').id });
      assert.equal(await repo.head(), tip);
      await methods['recovery.restore']({ path: repo.path, id: entries.find((e) => e.target.kind === 'file').id });
      assert.equal(readFileSync(join(repo.path, 'c3.txt'), 'utf8'), 'unsaved work\n');
    });
  });

  test('files deleted by clean can be brought back', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      repo.write('notes.txt', 'my notes\n');
      const preview = await methods['console.preview']({ path: repo.path, line: 'clean -f' });
      assert.match(preview.lines.join(' '), /notes\.txt/);
      await run(repo, 'clean -f', true);
      assert.equal(existsSync(join(repo.path, 'notes.txt')), false);
      const entry = await undoLatest(repo);
      assert.match(entry.label, /Console: git clean -f/);
      assert.equal(readFileSync(join(repo.path, 'notes.txt'), 'utf8'), 'my notes\n');
    });
  });

  test('a deleted branch and a dropped stash come back', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      await repo.git(['branch', 'old']);
      await run(repo, 'branch -D old', true);
      assert.notEqual((await repo.git(['rev-parse', '--verify', '--quiet', 'old'])).code, 0);
      await undoLatest(repo);
      assert.equal((await repo.git(['rev-parse', '--verify', '--quiet', 'old'])).code, 0);

      repo.write('c1.txt', 'stashed\n');
      await repo.git(['stash', '-q']);
      await run(repo, 'stash drop', true);
      assert.equal((await repo.git(['stash', 'list'])).stdout, '');
      await undoLatest(repo);
      assert.match((await repo.git(['stash', 'list'])).stdout, /stash@\{0\}/);
    });
  });
});
