import test from 'node:test';
import assert from 'node:assert/strict';
import { telegramConfiguration, privateMessage, authorizeTelegram, bootstrapIds,
  bootstrapTelegram, telegramClient, makeTelegramQueue, runTelegram, GREETING } from '../src/telegram.mjs';
import { chunksOf } from '../src/retrieval.mjs';
import { REFUSAL } from '../src/adapters.mjs';

const env = {
  RUN_MODE: 'offline', TELEGRAM_BOT_TOKEN: '123456:synthetic_token_not_real_12345678',
  TELEGRAM_ALLOWED_USER_IDS: '123456789,987654321',
  LLM_PROTOCOL: 'openai-chat-completions', LLM_PROVIDER: 'Hubris',
  LLM_ENDPOINT: 'https://api.hubris.pw/v1/chat/completions', LLM_MODEL: 'openai/gpt-4o-mini',
  LLM_API_KEY: 'synthetic-llm-key', LLM_MAX_TOKENS: '1400',
};
const c = telegramConfiguration(env, { live: true });
const now = 1800000000000;
const update = (id = 123456789, text = '/start', current = Date.now()) => ({
  update_id: 10, message: { message_id: 5, date: Math.floor(current / 1000), text,
    from: { id, is_bot: false, first_name: 'PRIVATE NAME' }, chat: { id, type: 'private' } },
});
const response = result => new Response(JSON.stringify({ ok: true, result }));
const idle = () => new Promise(resolve => setImmediate(resolve));

test('Telegram defaults deny all/offline; requires its own IDs and explicit LLM settings', () => {
  const empty = telegramConfiguration({});
  assert.equal(empty.mode, 'offline'); assert.deepEqual(empty.allowed, []);
  assert.equal(authorizeTelegram(update(), empty), null);
  for (const ids of ['', '835', '626', 'abc', '-10', '123,,456', '9007199254740993']) {
    assert.throws(() => telegramConfiguration({ ...env, TELEGRAM_ALLOWED_USER_IDS: ids }, { live: true }));
  }
  assert.throws(() => telegramConfiguration({ ...env, LLM_MODEL: 'other-model' }, { live: true }));
  assert.throws(() => telegramConfiguration({ ...env, LLM_MAX_TOKENS: '1401' }, { live: true }));
  assert.deepEqual(c.allowed, ['123456789', '987654321']);
  assert.equal(env.RUN_MODE, 'offline');
});

test('private text authorization rejects strangers, Bitrix IDs, groups, bots, forwarded/stale data', () => {
  assert.equal(authorizeTelegram(update(123456789, '331-ФЗ', now), c, now).sender, '123456789');
  for (const id of [835, 626, 1]) assert.equal(authorizeTelegram(update(id, '/start', now), c, now), null);
  for (const mutate of [
    u => { u.message.chat.type = 'group'; },
    u => { u.message.chat.id = 987654321; },
    u => { u.message.from.is_bot = true; },
    u => { u.message.forward_origin = { type: 'user' }; },
    u => { u.message.via_bot = { id: 2 }; },
    u => { u.message.sender_chat = {}; },
    u => { u.message.date -= 301; },
    u => { u.message.text = 'x'.repeat(2001); },
    u => { delete u.message.text; u.message.document = { file_id: 'ignored' }; },
    u => { u.edited_message = u.message; delete u.message; },
    u => { u.message.from.id = '123456789'; },
  ]) {
    const u = update(123456789, '/start', now); mutate(u);
    assert.equal(privateMessage(u, now), null);
  }
});

test('bootstrap filters exact /start in private chat and prints IDs only; no auto enrolment or sends', async () => {
  const offline = telegramConfiguration({ ...env, TELEGRAM_ALLOWED_USER_IDS: '' });
  const ordinary = update(987654321, 'PRIVATE QUESTION');
  const group = update(777777777); group.message.chat.type = 'supergroup';
  const candidates = [update(), ordinary, group, update(123456789, '/start payload'), update()];
  assert.deepEqual(bootstrapIds(candidates), ['123456789']);
  const methods = [], printed = [];
  const count = await bootstrapTelegram(offline, { consent: true, write: id => printed.push(id),
    transport: async (url, options) => {
      const method = url.split('/').at(-1); methods.push(method);
      assert.equal(options.redirect, 'error');
      if (method === 'getMe') return response({ id: 555555, is_bot: true, username: 'hidden_bot' });
      assert.equal(method, 'getUpdates');
      const payload = JSON.parse(options.body);
      assert.deepEqual(payload.allowed_updates, ['message']);
      assert.equal(payload.offset, undefined);
      return response(candidates);
    } });
  assert.equal(count, 1); assert.deepEqual(printed, ['123456789']);
  assert.deepEqual(methods, ['getMe', 'getUpdates']);
  assert.deepEqual(offline.allowed, []);
});

test('bootstrap and polling without consent/config cannot make even one request', async () => {
  let calls = 0; const transport = async () => { calls++; throw new Error('must not run'); };
  await assert.rejects(() => bootstrapTelegram(telegramConfiguration(env), { transport }));
  await assert.rejects(() => runTelegram(c, { transport }));
  await assert.rejects(() => runTelegram(telegramConfiguration({}), { transport, consent: true }));
  assert.equal(calls, 0);
});

test('Telegram token-bearing failures are sanitized; redirects, API errors and oversized bodies fail', async () => {
  for (const transport of [
    async url => { throw new Error('fetch failed ' + url); },
    async () => new Response('SECRET', { status: 500 }),
    async () => new Response(JSON.stringify({ ok: false, description: 'SECRET TOKEN' })),
    async () => new Response('x'.repeat(513 * 1024)),
  ]) {
    const api = telegramClient(c, { transport });
    await assert.rejects(() => api('getUpdates', {}), error =>
      error.message === 'telegram_request_failed' && !error.message.includes(c.token));
  }
  const readOnly = telegramClient(c, { readOnly: true });
  await assert.rejects(() => readOnly('sendMessage', { chat_id: 123456789, text: 'test' }));
});

test('sendMessage rechecks allowed recipient, length and plain-text payload without paid broadcast', async () => {
  const requests = [];
  const api = telegramClient(c, { transport: async (_, options) => {
    requests.push(JSON.parse(options.body)); return response({ message_id: 10 });
  } });
  await assert.rejects(() => api('sendMessage', { chat_id: 835, text: 'no' }));
  await assert.rejects(() => api('sendMessage', { chat_id: 123456789, text: 'x'.repeat(4097) }));
  await assert.rejects(() => api('sendMessage', { chat_id: 123456789, text: 'paid', allow_paid_broadcast: true }));
  await assert.rejects(() => api('sendMessage', { chat_id: 123456789, text: 'markup', parse_mode: 'HTML' }));
  await assert.rejects(() => api('getFile', {}));
  assert.equal(requests.length, 0);
});

test('authorized /start uses bounded queue without LLM; strangers never get greeting', async () => {
  const requests = []; let llmCalls = 0;
  const api = telegramClient(c, { transport: async (_, options) => {
    requests.push(JSON.parse(options.body)); return response({ message_id: 10 });
  } });
  const q = makeTelegramQueue(c, { chunks: [] }, { api,
    llmTransport: async () => { llmCalls++; throw new Error('unexpected'); } });
  assert.equal(authorizeTelegram(update(1), c), null);
  const job = authorizeTelegram(update(), c);
  q.add(job); assert.equal(q.add(job), 'duplicate');
  await idle(); await idle();
  assert.equal(llmCalls, 0); assert.equal(requests.length, 1);
  assert.equal(requests[0].text, GREETING);
  assert.equal(requests[0].parse_mode, undefined);
  assert.equal(requests[0].allow_paid_broadcast, undefined);
  assert.deepEqual(requests[0].link_preview_options, { is_disabled: true });
  assert.equal(requests[0].protect_content, true);
  assert.ok(GREETING.includes('Telegram и Hubris'));
});

test('existing retrieval + Hubris grounding is used, missing sources do not call LLM', async () => {
  const quote = 'Настоящий Федеральный закон вступает в силу с даты, установленной настоящей статьёй.';
  const chunks = chunksOf(quote, 'Законы/331-ФЗ_2026/КАРТОЧКА.md');
  const sent = []; let llmCalls = 0;
  const q = makeTelegramQueue(c, { chunks }, {
    api: async (method, payload) => { assert.equal(method, 'sendMessage'); sent.push(payload); },
    llmTransport: async (_, options) => {
      llmCalls++;
      const payload = JSON.parse(options.body);
      assert.equal(payload.model, 'openai/gpt-4o-mini'); assert.equal(payload.max_tokens, 1400);
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: {
        content: JSON.stringify({ claims: [{ text: 'Срок указан в законе.', sourceId: 'S1', quote }] }),
      } }] }));
    },
  });
  q.add(authorizeTelegram(update(123456789, '331-ФЗ'), c));
  for (let i = 0; i < 5; i++) await idle();
  assert.equal(llmCalls, 1); assert.equal(sent.length, 1);
  assert.ok(sent[0].text.includes(quote)); assert.ok(sent[0].text.includes('не является юридическим заключением'));
  const u = update(987654321, '999999-ФЗ'); u.message.message_id = 6;
  q.add(authorizeTelegram(u, c));
  for (let i = 0; i < 5; i++) await idle();
  assert.equal(llmCalls, 1); assert.equal(sent[1].text, REFUSAL);
});

test('polling acknowledges ignored updates via offset; no webhook mutation or automatic sends', async () => {
  const controller = new AbortController(); const methods = []; let polls = 0;
  const q = await runTelegram(c, { consent: true, paidConsent: true, signal: controller.signal,
    corpusLoader: async () => ({ chunks: [] }), transport: async (url, options) => {
      const method = url.split('/').at(-1); methods.push(method);
      if (method === 'getMe') return response({ id: 55555, is_bot: true });
      if (method === 'getWebhookInfo') return response({ url: '' });
      assert.equal(method, 'getUpdates');
      const payload = JSON.parse(options.body);
      if (++polls === 1) { assert.equal(payload.offset, 0); return response([update(1)]); }
      assert.equal(payload.offset, 11); controller.abort(); return response([]);
    } });
  assert.equal(q.total, 0);
  assert.deepEqual(methods, ['getMe', 'getWebhookInfo', 'getUpdates', 'getUpdates']);
});

test('paid consent, expected bot and empty webhook required before polling; never delete webhook', async () => {
  const methods = [];
  await assert.rejects(() => runTelegram(c, { consent: true, transport: async () => {
    methods.push('unexpected'); throw new Error('must not call');
  } }), /telegram_polling_consent_required/);
  assert.deepEqual(methods, []);
  await assert.rejects(() => runTelegram(c, { consent: true, paidConsent: true,
    expectedUsername: 'zakfarm26_bot', transport: async url => {
      methods.push(url.split('/').at(-1));
      return response({ id: 55555, is_bot: true, username: 'different_bot' });
    } }), /telegram_unexpected_bot/);
  assert.deepEqual(methods, ['getMe']);
  methods.length = 0;
  await assert.rejects(() => runTelegram(c, { consent: true, paidConsent: true,
    expectedUsername: 'zakfarm26_bot', transport: async url => {
      const method = url.split('/').at(-1); methods.push(method);
      return response(method === 'getMe' ? { id: 55555, is_bot: true, username: 'zakfarm26_bot' } :
        { url: 'https://private-webhook.invalid/secret' });
    } }), /telegram_existing_webhook/);
  assert.deepEqual(methods, ['getMe', 'getWebhookInfo']);
});
