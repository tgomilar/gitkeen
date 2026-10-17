/**
 * Setting Ollama and LM Studio up from Settings: the model chosen there, a
 * server with no model yet, and a download. Run against stand-ins, so nothing
 * is fetched and no real LM Studio is woken.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withRepo } from './harness.mjs';

/** What the stand-in has downloaded, and the model each chat asked for. */
let installed = [];
const asked = [];

const ollama = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: installed.map((name) => ({ name })) }));
    const json = JSON.parse(body || '{}');
    if (req.url === '/api/pull') {
      // The shape of a real pull: a manifest, one layer in parts, then success.
      const lines = [
        { status: 'pulling manifest' },
        { status: 'pulling abc', total: 100, completed: 40 },
        { status: 'pulling abc', total: 100, completed: 100 },
        { status: 'verifying sha256 digest' },
        { status: 'success' }
      ];
      installed.push(json.model);
      return res.end(lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    }
    asked.push(json.model);
    res.end(JSON.stringify({ message: { content: `Answered by ${json.model}.` } }));
  });
});

/** LM Studio's own listing, which says an embedding model is one. */
const lmstudio = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v0/models') {
      return res.end(JSON.stringify({
        data: [
          { id: 'text-embedding-nomic', type: 'embeddings' },
          { id: 'google/gemma-4-e4b', type: 'llm' },
          { id: 'qwen/qwen3-8b', type: 'llm' }
        ]
      }));
    }
    const json = JSON.parse(body || '{}');
    asked.push(json.model);
    res.end(JSON.stringify({ choices: [{ message: { content: `Answered by ${json.model}.` }, finish_reason: 'stop' }] }));
  });
});

let methods;
let dir;
before(async () => {
  for (const server of [ollama, lmstudio]) await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  dir = await mkdtemp(join(tmpdir(), 'gitkeen-local-ai-'));
  process.env.GITKEEN_CONFIG = join(dir, 'config.json');
  process.env.OLLAMA_HOST = `http://127.0.0.1:${ollama.address().port}`;
  process.env.LMSTUDIO_HOST = `http://127.0.0.1:${lmstudio.address().port}`;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GITKEEN_OLLAMA_MODEL;
  delete process.env.GITKEEN_LMSTUDIO_MODEL;
  ({ methods } = await import('../api.mjs'));
});
after(async () => {
  ollama.close();
  lmstudio.close();
  await rm(dir, { recursive: true, force: true });
});

describe('Ollama from Settings', () => {
  test('a running Ollama with no model is not offered', async () => {
    installed = [];
    const status = await methods['ai.ollamaStatus']();
    assert.equal(status.running, true);
    assert.deepEqual(status.models, []);
    const providers = await methods['commit.suggestProviders']();
    assert.ok(!providers.available.includes('ollama'), 'a button that can only fail is not offered');
  });

  test('a download reports its progress and ends with the model installed', async () => {
    installed = [];
    await methods['ai.pullModel']({ model: 'llama3.2:3b' });
    let status;
    for (let i = 0; i < 50; i++) {
      status = await methods['ai.ollamaStatus']();
      if (status.pull?.done) break;
      await new Promise((ok) => setTimeout(ok, 20));
    }
    assert.equal(status.pull.done, true);
    assert.equal(status.pull.error, null);
    assert.equal(status.pull.status, 'success');
    assert.deepEqual(status.models, ['llama3.2:3b']);
  });

  test('a model name that is not one is refused', async () => {
    await assert.rejects(() => methods['ai.pullModel']({ model: 'llama; rm -rf /' }), /not a model name/);
  });

  test('the model chosen in Settings is the one asked', async () => {
    installed = ['llama3.2:3b', 'qwen2.5:7b'];
    const providers = await methods['settings.setModel']({ provider: 'ollama', model: 'qwen2.5:7b' });
    assert.equal(providers.models.ollama, 'qwen2.5:7b');

    await withRepo(async (repo) => {
      const hash = await repo.commit('feat: add one', { 'f.txt': 'one\n' });
      await methods['ai.explain']({ path: repo.path, kind: 'commit', hash, provider: 'ollama' });
    });
    assert.equal(asked.at(-1), 'qwen2.5:7b');
  });

  test('a chosen model that was deleted gives way to one that is there', async () => {
    installed = ['llama3.2:3b'];
    const providers = await methods['commit.suggestProviders']();
    assert.equal(providers.models.ollama, 'llama3.2:3b');
  });
});

describe('LM Studio from Settings', () => {
  test('an embedding model is not offered, since it cannot write a subject', async () => {
    const status = await methods['ai.lmstudioStatus']();
    assert.equal(status.running, true);
    assert.deepEqual(status.models, ['google/gemma-4-e4b', 'qwen/qwen3-8b']);
    const providers = await methods['commit.suggestProviders']();
    assert.equal(providers.models.lmstudio, 'google/gemma-4-e4b');
  });

  test('the model chosen in Settings is the one asked', async () => {
    await methods['settings.setModel']({ provider: 'lmstudio', model: 'qwen/qwen3-8b' });
    await withRepo(async (repo) => {
      const hash = await repo.commit('feat: add one', { 'f.txt': 'one\n' });
      await methods['ai.explain']({ path: repo.path, kind: 'commit', hash, provider: 'lmstudio' });
    });
    assert.equal(asked.at(-1), 'qwen/qwen3-8b');
  });

  test('a model name that is not one is refused before lms runs', async () => {
    await assert.rejects(() => methods['ai.loadLmstudio']({ model: 'x; rm -rf /' }), /not a model name/);
  });
});
