/**
 * Staging and committing: the tick is now a stage, so these tests pin down
 * what a tick does to the index and what the index does to a commit.
 *
 * The rule being tested: a commit carries exactly the index. A whole ticked
 * file goes in by `git add`, a ticked hunk by `git apply --cached`, and
 * whatever the index does not hold stays out of the commit, on purpose.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { methods } from '../api.mjs';
import { withRepo } from './harness.mjs';

/** A ten-line file with `nth` and `nth2` rewritten, so the change is two hunks. */
async function tenLines(repo) {
  const lines = Array.from({ length: 10 }, (_, i) => `l${i + 1}`);
  await repo.commit('base', { 'f.txt': lines.join('\n') + '\n' });
  const changed = [...lines];
  changed[0] = 'L1';
  changed[9] = 'L10';
  repo.write('f.txt', changed.join('\n') + '\n');
  return { lines, changed };
}

describe('staging a whole file', () => {
  test('ticking an unversioned file puts it in the index, unticking brings it back', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'a.txt': 'one\n' });
      repo.write('new.txt', 'hello\n');
      assert.match(await repo.status(), /^\?\? new.txt$/m);

      await methods['changes.stage']({ path: repo.path, paths: ['new.txt'], on: true });
      assert.match(await repo.status(), /^A  new.txt$/m, 'ticked means staged');

      await methods['changes.stage']({ path: repo.path, paths: ['new.txt'], on: false });
      assert.match(await repo.status(), /^\?\? new.txt$/m, 'unticked means unversioned again');
    });
  });

  test('ticking a modified file stages its working-tree content', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'one\n' });
      repo.write('f.txt', 'one\nchanged\n');

      await methods['changes.stage']({ path: repo.path, paths: ['f.txt'], on: true });
      assert.equal((await repo.git(['show', ':f.txt'])).stdout, 'one\nchanged\n');

      await methods['changes.stage']({ path: repo.path, paths: ['f.txt'], on: false });
      assert.equal((await repo.git(['show', ':f.txt'])).stdout, 'one\n', 'index back to HEAD');
    });
  });
});

describe('commit takes the index', () => {
  test('a commit carries what was staged, not what the working tree grew later', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'one\n' });
      repo.write('f.txt', 'one\nstaged-line\n');
      await methods['changes.stage']({ path: repo.path, paths: ['f.txt'], on: true });
      repo.write('f.txt', 'one\nstaged-line\nabsent-from-index\n');

      const result = await methods['changes.commit']({ path: repo.path, paths: ['f.txt'], message: 'half', amend: false });
      assert.equal(result.ok, true);
      assert.equal(
        (await repo.git(['show', `${result.commit}:f.txt`])).stdout,
        'one\nstaged-line\n',
        'the commit is the index'
      );
      assert.equal((await repo.status()), 'M f.txt', 'the later edit is still there, unstaged');
    });
  });

  test('one staged hunk of two goes in, the other stays behind', async () => {
    await withRepo(async (repo) => {
      const { lines, changed } = await tenLines(repo);
      const { hunks } = await methods['diff.file']({ path: repo.path, file: 'f.txt', side: 'unstaged' });
      assert.equal(hunks.length, 2, 'the file edits are far enough apart to be two hunks');

      await methods['changes.stageHunks']({ path: repo.path, file: 'f.txt', side: 'unstaged', hunks: [hunks[0]] });

      const index = ['L1', ...lines.slice(1, 9), 'l10'].join('\n') + '\n';
      assert.equal((await repo.git(['show', ':f.txt'])).stdout, index, 'only the first hunk is staged');

      const result = await methods['changes.commit']({ path: repo.path, paths: ['f.txt'], message: 'first hunk', amend: false });
      assert.equal(result.ok, true);
      assert.equal((await repo.git(['show', `${result.commit}:f.txt`])).stdout, index);
      assert.equal((await repo.status()), 'M f.txt', 'the second hunk is still on the worktree side');
      assert.equal((await repo.git(['show', ':f.txt'])).stdout, index);
    });
  });

  test('staging both hunks at once stages everything', async () => {
    await withRepo(async (repo) => {
      const { changed } = await tenLines(repo);
      const { hunks } = await methods['diff.file']({ path: repo.path, file: 'f.txt', side: 'unstaged' });
      await methods['changes.stageHunks']({ path: repo.path, file: 'f.txt', side: 'unstaged', hunks });

      assert.equal(
        (await repo.git(['show', ':f.txt'])).stdout,
        changed.join('\n') + '\n',
        'index now matches the working tree'
      );
      assert.equal((await repo.status()).trim(), 'M  f.txt', 'nothing unstaged left');
    });
  });

  test('an unstage takes a hunk back out of the index', async () => {
    await withRepo(async (repo) => {
      const { lines } = await tenLines(repo);
      repo.write('f.txt', ['L1', ...lines.slice(1)].join('\n') + '\n');
      await methods['changes.stage']({ path: repo.path, paths: ['f.txt'], on: true });

      const { hunks } = await methods['diff.file']({ path: repo.path, file: 'f.txt', side: 'staged' });
      assert.equal(hunks.length, 1, 'one whole-file hunk is staged');
      await methods['changes.stageHunks']({ path: repo.path, file: 'f.txt', side: 'staged', hunks: [hunks[0]] });

      assert.equal(
        (await repo.git(['show', ':f.txt'])).stdout,
        lines.join('\n') + '\n',
        'the index gave that hunk back'
      );
      assert.equal((await repo.status()), 'M f.txt', 'the edit itself is untouched, now unstaged');
    });
  });

  test('a hunk whose file has no trailing newline survives the round trip', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'l1\nl2' });
      repo.write('f.txt', 'L1\nl2');
      const { hunks } = await methods['diff.file']({ path: repo.path, file: 'f.txt', side: 'unstaged' });
      await methods['changes.stageHunks']({ path: repo.path, file: 'f.txt', side: 'unstaged', hunks });

      assert.equal((await repo.git(['show', ':f.txt'])).stdout, 'L1\nl2');
      assert.equal((await repo.status()).trim(), 'M  f.txt');
    });
  });

  test('amend with nothing staged rewrites the message only', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'a.txt': 'a\n' });
      const before = await repo.head();
      const result = await methods['changes.commit']({ path: repo.path, paths: [], message: 'renamed', amend: true });
      assert.equal(result.ok, true);
      assert.equal((await repo.git(['show', '-s', '--format=%s', result.commit])).stdout.trim(), 'renamed');
      assert.equal(
        (await repo.git(['show', '-s', '--format=%T', result.commit])).stdout,
        (await repo.git(['show', '-s', '--format=%T', before])).stdout,
        'the tree is untouched'
      );
    });
  });

  test('refuses a commit when nothing is staged', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'a.txt': 'a\n' });
      repo.write('a.txt', 'b\n');
      await assert.rejects(
        () => methods['changes.commit']({ path: repo.path, paths: ['a.txt'], message: 'nope', amend: false }),
        /Nothing is staged/
      );
    });
  });
});

describe('what hunk staging refuses', () => {
  test('a path that escapes the repository', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'a\n' });
      await assert.rejects(
        () => methods['changes.stageHunks']({
          path: repo.path, file: '../escape.txt', side: 'unstaged',
          hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, heading: '', lines: [] }]
        }),
        /relative file path/
      );
    });
  });

  test('no hunks selected', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'a\n' });
      await assert.rejects(
        () => methods['changes.stageHunks']({ path: repo.path, file: 'f.txt', side: 'unstaged', hunks: [] }),
        /at least one hunk/
      );
    });
  });
});
describe('hunks of awkward files', () => {
  for (const name of ['[x].txt', 'tab\there.txt', 'quote"d.txt', 'back\\slash.txt']) {
    test(`stages a hunk of ${JSON.stringify(name)}`, async () => {
      await withRepo(async (repo) => {
        await repo.commit('base', { [name]: 'one\ntwo\n' });
        repo.write(name, 'one\nTWO\n');
        const { hunks } = await methods['diff.file']({ path: repo.path, file: name, side: 'unstaged' });
        await methods['changes.stageHunks']({ path: repo.path, file: name, side: 'unstaged', hunks });
        const { stdout } = await repo.git(['diff', '--cached', '--name-only', '-z']);
        assert.equal(stdout, `${name}\0`, 'the hunk reached the index');
      });
    });
  }

  test('unstaging the hunk of a new file takes the file out of the index', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'a.txt': 'a\n' });
      repo.write('new.txt', 'hello\nworld\n');
      await repo.git(['add', 'new.txt']);
      const { hunks } = await methods['diff.file']({ path: repo.path, file: 'new.txt', side: 'staged' });
      await methods['changes.stageHunks']({ path: repo.path, file: 'new.txt', side: 'staged', hunks });
      assert.match(await repo.status(), /^\?\? new\.txt$/m, 'untracked again, not an empty staged file');
    });
  });

  test('a hunk line carrying a newline is refused, so it cannot name another file', async () => {
    await withRepo(async (repo) => {
      await tenLines(repo);
      const { hunks } = await methods['diff.file']({ path: repo.path, file: 'f.txt', side: 'unstaged' });
      const forged = structuredClone(hunks[0]);
      forged.lines[0].text += '\ndiff --git a/other b/other';
      await assert.rejects(
        () => methods['changes.stageHunks']({ path: repo.path, file: 'f.txt', side: 'unstaged', hunks: [forged] }),
        /malformed/
      );
      assert.equal((await repo.git(['diff', '--cached', '--name-only'])).stdout, '');
    });
  });
});

describe('unticking a staged rename', () => {
  test('takes both halves out of the index', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'old.txt': 'same content, long enough to be a rename\n' });
      await repo.git(['mv', 'old.txt', 'new.txt']);
      await methods['changes.stage']({ path: repo.path, paths: ['new.txt'], on: false });
      const files = await repo.files();
      assert.ok(files.includes('old.txt'), 'the old name is back in the index');
      assert.ok(!files.includes('new.txt'), 'the new name is not staged');
      assert.equal((await repo.git(['diff', '--cached', '--name-only'])).stdout, '', 'nothing staged, no deletion');
    });
  });
});

describe('staging single lines', () => {
  /** The hunks of one side, with every changed line except `keep` marked skipped. */
  async function only(repo, file, side, keep) {
    const { hunks } = await methods['diff.file']({ path: repo.path, file, side });
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.kind !== 'context' && !keep(line)) line.skip = true;
      }
    }
    return hunks;
  }
  const index = async (repo, file) => (await repo.git(['show', `:${file}`])).stdout;

  test('one added line of two', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'a\nb\n' });
      repo.write('f.txt', 'a\nnew 1\nnew 2\nb\n');
      const hunks = await only(repo, 'f.txt', 'unstaged', (l) => l.text === 'new 2');
      await methods['changes.stageHunks']({ path: repo.path, file: 'f.txt', side: 'unstaged', hunks });
      assert.equal(await index(repo, 'f.txt'), 'a\nnew 2\nb\n');
      assert.equal(await repo.status(), 'MM f.txt', 'the other line still waits in the working tree');
    });
  });

  test('a removed line on its own', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'a\nold 1\nold 2\nb\n' });
      repo.write('f.txt', 'a\nb\n');
      const hunks = await only(repo, 'f.txt', 'unstaged', (l) => l.text === 'old 1');
      await methods['changes.stageHunks']({ path: repo.path, file: 'f.txt', side: 'unstaged', hunks });
      assert.equal(await index(repo, 'f.txt'), 'a\nold 2\nb\n');
    });
  });

  test('the new half of a replaced line keeps the old one too', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'a\nold\nb\n' });
      repo.write('f.txt', 'a\nnew\nb\n');
      const hunks = await only(repo, 'f.txt', 'unstaged', (l) => l.kind === 'add');
      await methods['changes.stageHunks']({ path: repo.path, file: 'f.txt', side: 'unstaged', hunks });
      assert.equal(await index(repo, 'f.txt'), 'a\nold\nnew\nb\n');
    });
  });

  test('unstaging one line leaves the rest of the hunk staged', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'a\nold\nb\n' });
      repo.write('f.txt', 'a\nnew 1\nnew 2\nb\n');
      await repo.git(['add', 'f.txt']);
      const hunks = await only(repo, 'f.txt', 'staged', (l) => l.text === 'new 1');
      await methods['changes.stageHunks']({ path: repo.path, file: 'f.txt', side: 'staged', hunks });
      assert.equal(await index(repo, 'f.txt'), 'a\nnew 2\nb\n', 'new 1 left the index; the rest of the staged change is untouched');
    });
  });

  test('part of a new file is unstaged, and the file stays in the index', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'a.txt': 'a\n' });
      repo.write('new.txt', 'one\ntwo\nthree\n');
      await repo.git(['add', 'new.txt']);
      const hunks = await only(repo, 'new.txt', 'staged', (l) => l.text === 'two');
      await methods['changes.stageHunks']({ path: repo.path, file: 'new.txt', side: 'staged', hunks });
      assert.equal(await index(repo, 'new.txt'), 'one\nthree\n');
    });
  });

  test('a line at the end of a file with no final newline', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'a\nb' });
      repo.write('f.txt', 'a\nb\nc\nd');
      const hunks = await only(repo, 'f.txt', 'unstaged', (l) => l.text === 'c' || (l.kind === 'del' && l.text === 'b') || (l.kind === 'add' && l.text === 'b'));
      await methods['changes.stageHunks']({ path: repo.path, file: 'f.txt', side: 'unstaged', hunks });
      assert.equal(await index(repo, 'f.txt'), 'a\nb\nc\n');
    });
  });

  test('a selection with no changed line in it is refused', async () => {
    await withRepo(async (repo) => {
      await tenLines(repo);
      const hunks = await only(repo, 'f.txt', 'unstaged', () => false);
      await assert.rejects(
        () => methods['changes.stageHunks']({ path: repo.path, file: 'f.txt', side: 'unstaged', hunks }),
        /at least one changed line/
      );
    });
  });
});
