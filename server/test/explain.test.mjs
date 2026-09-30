/**
 * AI explanations, against a stand-in for LM Studio's local server, so the
 * tests check what Gitkeen sends and how it reads the answer without calling
 * any real model.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { withRepo } from './harness.mjs';

const requests = [];
let reply = { choices: [{ message: { content: 'It adds a line.\n- f.txt gains "two".' }, finish_reason: 'stop' }] };
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'stand-in' }] }));
    requests.push(JSON.parse(body));
    res.end(JSON.stringify(reply));
  });
});

let methods;
before(async () => {
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  // Read when the module loads, so it is set before the import.
  process.env.LMSTUDIO_HOST = `http://127.0.0.1:${server.address().port}`;
  ({ methods } = await import('../api.mjs'));
});
after(() => server.close());

const lastPrompt = () => requests.at(-1).messages.map((m) => m.content).join('\n');
const ask = (args) => methods['ai.explain']({ provider: 'lmstudio', ...args });

describe('explanations', () => {
  test('a commit is explained from its message and diff', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'one\n' });
      const hash = await repo.commit('feat: add two', { 'f.txt': 'one\ntwo\n' });
      const answer = await ask({ path: repo.path, kind: 'commit', hash });
      assert.equal(answer.text, 'It adds a line.\n- f.txt gains "two".');
      assert.equal(answer.provider, 'lmstudio');
      assert.equal(answer.model, 'stand-in');
      const prompt = lastPrompt();
      assert.match(prompt, /Explain what this commit changed/);
      assert.match(prompt, /feat: add two/);
      assert.match(prompt, /\+two/, 'the diff is in it');
    });
  });

  test('a conflict is explained from both sides and the commits behind them', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'top\nmiddle\nbottom\n' });
      await repo.git(['checkout', '-q', '-b', 'topic']);
      await repo.commit('topic says hello', { 'f.txt': 'top\nhello\nbottom\n' });
      await repo.git(['checkout', '-q', 'main']);
      await repo.commit('main says goodbye', { 'f.txt': 'top\ngoodbye\nbottom\n' });
      await methods['repo.merge']({ path: repo.path, source: 'topic' });
      await ask({ path: repo.path, kind: 'conflict', file: 'f.txt' });
      const prompt = lastPrompt();
      assert.match(prompt, /Operation: merge/);
      assert.match(prompt, /Ours: [0-9a-f]+ main says goodbye/);
      assert.match(prompt, /Theirs: [0-9a-f]+ topic says hello/);
      assert.match(prompt, /<ours>\ngoodbye\n<\/ours>/);
      assert.match(prompt, /<theirs>\nhello\n<\/theirs>/);
    });
  });

  test('two branches are explained from what each did since the split', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'one\n' });
      await repo.git(['checkout', '-q', '-b', 'topic']);
      await repo.commit('topic work', { 't.txt': 't\n' });
      await repo.git(['checkout', '-q', 'main']);
      await repo.commit('main work', { 'm.txt': 'm\n' });
      await ask({ path: repo.path, kind: 'branches', base: 'main', target: 'topic' });
      const prompt = lastPrompt();
      assert.match(prompt, /Commits only on topic:\n- [0-9a-f]+ topic work/);
      assert.match(prompt, /Commits only on main:\n- [0-9a-f]+ main work/);
      assert.match(prompt, /They split at [0-9a-f]+ base/);
    });
  });

  test('an operation is explained from what its dialog says', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      await ask({ path: repo.path, kind: 'operation', text: 'Reset main to abc1234 (hard)\nLosing: 3 commits' });
      assert.match(lastPrompt(), /Losing: 3 commits/);
      assert.match(lastPrompt(), /Current branch: main/);
    });
  });

  test('an empty answer is reported, not shown as an explanation', async () => {
    await withRepo(async (repo) => {
      const hash = await repo.commit('base', { 'f.txt': 'one\n' });
      reply = { choices: [{ message: { content: '<think>hmm</think>' }, finish_reason: 'length' }] };
      try {
        await assert.rejects(() => ask({ path: repo.path, kind: 'commit', hash }), /ran out of answer budget/);
      } finally {
        reply = { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] };
      }
    });
  });

  test('refuses what it cannot explain', async () => {
    await withRepo(async (repo) => {
      await repo.commits(1);
      await assert.rejects(() => ask({ path: repo.path, kind: 'everything' }), /cannot explain/);
      await assert.rejects(() => ask({ path: repo.path, kind: 'commit', hash: '--output=x' }), /not a commit/);
    });
  });
});

describe('explaining branches by their full names', () => {
  test('the model sees the names people use', async () => {
    await withRepo(async (repo) => {
      await repo.commit('base', { 'f.txt': 'one\n' });
      await repo.git(['checkout', '-q', '-b', 'topic']);
      await repo.commit('topic work', { 't.txt': 't\n' });
      await ask({ path: repo.path, kind: 'branches', base: 'refs/heads/main', target: 'refs/heads/topic' });
      assert.doesNotMatch(lastPrompt(), /refs\/heads/);
      assert.match(lastPrompt(), /Commits only on topic:/);
    });
  });
});
