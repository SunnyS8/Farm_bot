import test from 'node:test';
import assert from 'node:assert/strict';
import { runSmoke } from '../scripts/smoke.mjs';
import { chunksOf } from '../src/retrieval.mjs';

const env = {
  RUN_MODE: 'offline', LLM_PROTOCOL: 'openai-chat-completions', LLM_PROVIDER: 'Hubris',
  LLM_ENDPOINT: 'https://api.hubris.pw/v1/chat/completions', LLM_API_KEY: 'synthetic-key-not-real',
  LLM_MODEL: 'dots-studio/dots-3-note-preview:free',
};
const args = ['--allow-one-paid-request', '--model=openai/gpt-4o-mini', '--max-tokens=1400'];
const text = 'Настоящий Федеральный закон вступает в силу с даты, определённой в настоящей статье.';
const corpusLoader = async () => ({ files: 1,
  chunks: chunksOf(text, 'Законы/331-ФЗ_2026/КАРТОЧКА.md') });

test('smoke requires matching explicit consent and bounded budget before any request', async () => {
  let requests = 0;
  for (const invalid of [
    [], ['--allow-one-free-request', '--model=openai/gpt-4o-mini'],
    ['--allow-one-paid-request', '--allow-one-free-request'],
    [...args.slice(0, 2), '--max-tokens=1401'],
    [...args, '--unknown=1'],
  ]) {
    await assert.rejects(() => runSmoke({ args: invalid, env, corpusLoader,
      transport: async () => { requests++; }, write: () => {} }));
  }
  assert.equal(requests, 0);
});

test('one paid mock request uses explicit model override, strict grounding and safe usage', async () => {
  let requests = 0; const output = [];
  const result = await runSmoke({ args, env, corpusLoader, write: o => output.push(o),
    transport: async (_, options) => {
      requests++;
      const payload = JSON.parse(options.body);
      assert.equal(payload.model, 'openai/gpt-4o-mini');
      assert.equal(payload.max_tokens, 1400);
      assert.equal(JSON.parse(payload.messages[1].content).untrustedSources.length, 1);
      return new Response(JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 40,
        total_tokens: 140, unknown_secret: 'do-not-print' },
      choices: [{ finish_reason: 'stop', message: {
        content: JSON.stringify({ claims: [{ text: 'Срок определяется статьёй.', sourceId: 'S1', quote: text }] }),
      } }] }), { status: 200 });
    } });
  assert.equal(result.grounded, true);
  assert.equal(requests, 1);
  assert.equal(output[1].configuredRunMode, 'offline');
  assert.deepEqual(output[1].diagnostic.usage, { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 });
  assert.ok(!JSON.stringify(output).includes(env.LLM_API_KEY));
  assert.ok(!JSON.stringify(output).includes('do-not-print'));
  assert.equal(env.LLM_MODEL, 'dots-studio/dots-3-note-preview:free');
});

test('HTTP 200 with refusal or upstream failure is not a grounded success and never retries', async () => {
  for (const response of [
    { choices: [{ finish_reason: 'stop', message: { content: '{"claims":[]}' } }] },
    { error: 'model_unavailable' },
  ]) {
    let requests = 0; const output = [];
    const result = await runSmoke({ args, env, corpusLoader, write: o => output.push(o),
      transport: async () => { requests++; return new Response(JSON.stringify(response)); } });
    assert.equal(result.grounded, false); assert.equal(requests, 1);
    assert.equal(output.length, 2);
  }
  let requests = 0;
  await assert.rejects(() => runSmoke({ args, env, corpusLoader, write: () => {},
    transport: async () => { requests++; return new Response('private-error', { status: 503 }); } }));
  assert.equal(requests, 1);
});
