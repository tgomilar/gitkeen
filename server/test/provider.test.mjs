/**
 * Choosing the AI provider in Settings, against stand-ins for LM Studio and
 * Ollama, so the tests check which server is asked without calling a real model.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withRepo } from './harness.mjs';

const asked = [];

/** A local server that lists one model and answers every chat with its name. */
function standIn(name, models, reply) {
  return createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET') return res.end(JSON.stringify(models));
      asked.push(name);
      res.end(JSON.stringify(reply(`Answered by ${name}.`)));
    });
  });
}

const lmstudio = standIn('lmstudio', { data: [{ id: 'lm-model' }] }, (text) => ({
  choices: [{ message: { content: text }, finish_reason: 'stop' }]
}));
const ollama = standIn('ollama', { models: [{ name: 'llama3.2' }] }, (text) => ({ message: { content: text } }));

let methods;
let dir;
before(async () => {
  for (const s of [lmstudio, ollama]) await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  dir = await mkdtemp(join(tmpdir(), 'gitkeen-provider-'));
  // Read when the modules load, so they are set before the import. Hosted keys
  // from the shell would otherwise come first and hide what is being tested.
  process.env.GITKEEN_CONFIG = join(dir, 'config.json');
  process.env.LMSTUDIO_HOST = `http://127.0.0.1:${lmstudio.address().port}`;
  process.env.OLLAMA_HOST = `http://127.0.0.1:${ollama.address().port}`;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  ({ methods } = await import('../api.mjs'));
});
after(async () => {
  lmstudio.close();
  ollama.close();
  await rm(dir, { recursive: true, force: true });
});

describe('choosing the AI provider', () => {
  test('without a choice, the first running provider is used', async () => {
    const providers = await methods['commit.suggestProviders']();
    assert.deepEqual(providers.available, ['lmstudio', 'ollama']);
    assert.equal(providers.preferred, 'lmstudio');
  });

  test('a chosen provider is used for explanations', async () => {
    const providers = await methods['settings.setProvider']({ provider: 'ollama' });
    assert.equal(providers.preferred, 'ollama');

    const saved = JSON.parse(await readFile(process.env.GITKEEN_CONFIG, 'utf8'));
    assert.equal(saved.provider, 'ollama', 'the choice is saved with the keys');

    await withRepo(async (repo) => {
      const hash = await repo.commit('feat: add one', { 'f.txt': 'one\n' });
      const answer = await methods['ai.explain']({ path: repo.path, kind: 'commit', hash });
      assert.equal(answer.provider, 'ollama');
      assert.equal(answer.text, 'Answered by ollama.');
      assert.equal(asked.at(-1), 'ollama', 'LM Studio was not asked');
    });
  });

  test('a chosen provider that stops running falls back to one that is', async () => {
    await methods['settings.setProvider']({ provider: 'ollama' });
    await new Promise((ok) => ollama.close(ok));
    const providers = await methods['commit.suggestProviders']();
    assert.deepEqual(providers.available, ['lmstudio']);
    assert.equal(providers.preferred, 'lmstudio');
  });

  test('an unknown provider is refused', async () => {
    await assert.rejects(methods['settings.setProvider']({ provider: 'nope' }), /Unknown provider "nope"/);
  });
});
