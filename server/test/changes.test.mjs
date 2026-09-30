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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

describe('image diffs', () => {
  // A 1x1 PNG, and another with a different colour.
  const red = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
  const blue = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==', 'base64');
  const bytesOf = (side) => Buffer.from(side.url.split(',')[1], 'base64');

  test('the two versions of a changed image come back byte for byte', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'logo.png': red });
      repo.write('logo.png', blue);
      const image = await methods['diff.image']({ path: repo.path, file: 'logo.png' });
      assert.equal(image.type, 'image/png');
      assert.deepEqual(bytesOf(image.before), red);
      assert.deepEqual(bytesOf(image.after), blue);

      const commit = await repo.commit('change', { 'logo.png': blue });
      const shown = await methods['diff.image']({ path: repo.path, file: 'logo.png', hash: commit });
      assert.deepEqual(bytesOf(shown.before), red, 'a commit is shown against its parent');
      assert.deepEqual(bytesOf(shown.after), blue);
    });
  });

  test('a new image has no before, and a deleted one no after', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'a.txt': 'a\n' });
      const added = await repo.commit('add', { 'new.png': red });
      assert.equal((await methods['diff.image']({ path: repo.path, file: 'new.png', hash: added })).before, null);
      await repo.git(['rm', '-q', 'new.png']);
      const gone = await methods['diff.image']({ path: repo.path, file: 'new.png', side: 'staged' });
      assert.equal(gone.after, null);
      assert.ok(gone.before);
    });
  });

  test('refuses a file that is not an image, or outside the repository', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'a.txt': 'a\n' });
      await assert.rejects(() => methods['diff.image']({ path: repo.path, file: 'a.txt' }), /not an image/);
      await assert.rejects(() => methods['diff.image']({ path: repo.path, file: '../x.png' }), /Unsafe/);
    });
  });
});

describe('rolling back hunks', () => {
  const read = (repo, file) => readFileSync(join(repo.path, file), 'utf8');

  test('one hunk of two goes back, the other stays', async () => {
    await withRepo(async (repo) => {
      const { lines } = await tenLines(repo);
      const { hunks } = await methods['diff.file']({ path: repo.path, file: 'f.txt', side: 'unstaged' });
      await methods['changes.rollbackHunks']({ path: repo.path, file: 'f.txt', hunks: [hunks[0]] });
      assert.equal(read(repo, 'f.txt'), [...lines.slice(0, 9), 'L10'].join('\n') + '\n');
    });
  });

  test('a single line goes back, and the rest of its hunk stays', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'a\nb\n' });
      repo.write('f.txt', 'a\nnew 1\nnew 2\nb\n');
      const { hunks } = await methods['diff.file']({ path: repo.path, file: 'f.txt', side: 'unstaged' });
      for (const line of hunks[0].lines) if (line.kind === 'add' && line.text !== 'new 1') line.skip = true;
      await methods['changes.rollbackHunks']({ path: repo.path, file: 'f.txt', hunks });
      assert.equal(read(repo, 'f.txt'), 'a\nnew 2\nb\n');
    });
  });

  test('what is staged is not touched', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'a\nb\n' });
      repo.write('f.txt', 'A\nb\n');
      await repo.git(['add', 'f.txt']);
      repo.write('f.txt', 'A\nB\n');
      const { hunks } = await methods['diff.file']({ path: repo.path, file: 'f.txt', side: 'unstaged' });
      await methods['changes.rollbackHunks']({ path: repo.path, file: 'f.txt', hunks });
      assert.equal(read(repo, 'f.txt'), 'A\nb\n', 'the working tree matches the index again');
      assert.equal((await repo.git(['show', ':f.txt'])).stdout, 'A\nb\n', 'the staged change stays');
    });
  });

  test('a diff read before the file changed again is refused, and the file is left alone', async () => {
    await withRepo(async (repo) => {
      await tenLines(repo);
      const { hunks } = await methods['diff.file']({ path: repo.path, file: 'f.txt', side: 'unstaged' });
      repo.write('f.txt', 'something else entirely\n');
      await assert.rejects(() => methods['changes.rollbackHunks']({ path: repo.path, file: 'f.txt', hunks }), /changed since/);
      assert.equal(read(repo, 'f.txt'), 'something else entirely\n');
    });
  });

  test('the Undo panel brings a rolled back hunk back', async () => {
    await withRepo(async (repo) => {
      const { changed } = await tenLines(repo);
      const { hunks } = await methods['diff.file']({ path: repo.path, file: 'f.txt', side: 'unstaged' });
      await methods['changes.rollbackHunks']({ path: repo.path, file: 'f.txt', hunks });
      const [entry] = (await methods['recovery.list']({ path: repo.path })).entries;
      assert.equal(entry.label, 'Rolled back part of f.txt');
      assert.equal(entry.target.kind, 'file');
      await methods['recovery.restore']({ path: repo.path, id: entry.id });
      assert.equal(read(repo, 'f.txt'), changed.join('\n') + '\n');
    });
  });

  test('a whole file rolled back can be brought back too', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'committed\n' });
      repo.write('f.txt', 'my unsaved work\n');
      await methods['changes.rollback']({ path: repo.path, paths: ['f.txt'] });
      assert.equal(read(repo, 'f.txt'), 'committed\n');
      const [entry] = (await methods['recovery.list']({ path: repo.path })).entries;
      assert.equal(entry.label, 'Rolled back f.txt');
      await methods['recovery.restore']({ path: repo.path, id: entry.id });
      assert.equal(read(repo, 'f.txt'), 'my unsaved work\n');
    });
  });
});
