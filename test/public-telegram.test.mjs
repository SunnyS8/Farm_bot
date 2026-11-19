import test from 'node:test';
import assert from 'node:assert/strict';
import { telegramConfiguration, authorizeTelegram, makeTelegramQueue } from '../src/telegram.mjs';
import { configuration, ALLOWED_USERS } from '../src/config.mjs';
import { authorize } from '../src/security.mjs';
import { chunksOf } from '../src/retrieval.mjs';
import { renderAnswer, REFUSAL } from '../src/adapters.mjs';
import { officialLinks } from '../src/public-sources.mjs';

const env = { RUN_MODE: 'offline', TELEGRAM_ACCESS_MODE: 'public',
  TELEGRAM_BOT_TOKEN: '123456:synthetic_token_not_real_12345678',
  LLM_PROTOCOL: 'openai-chat-completions', LLM_PROVIDER: 'Hubris',
  LLM_ENDPOINT: 'https://api.hubris.pw/v1/chat/completions', LLM_MODEL: 'openai/gpt-4o-mini',
  LLM_API_KEY: 'synthetic-key', LLM_MAX_TOKENS: '1400' };
const c = telegramConfiguration(env, { live: true });
const question = 'Когда вступит в силу 331-ФЗ?';
const quote = 'Настоящий Федеральный закон вступает в силу с даты, установленной настоящей статьёй.';
const chunks = chunksOf(quote + '\nhttps://publication.pravo.gov.ru/document/1234567890',
  'Будущие нормы/331-ФЗ_2026/КАРТОЧКА.md');
const update = (sender = 777777777, number = 1, text = question) => ({ update_id: number,
  message: { from: { id: sender, is_bot: false }, chat: { id: sender, type: 'private' },
    date: Math.floor(Date.now() / 1000), message_id: number, text } });
const idle = () => new Promise(resolve => setImmediate(resolve));
const drain = async q => { while (q.running) await idle(); };

test('public allows unknown humans in private, denies groups; default code still allowlist', () => {
  assert.equal(c.allowed.length, 0); assert.equal(c.accessMode, 'public');
  assert.equal(authorizeTelegram(update(), c).sender, '777777777');
  const group = update(); group.message.chat.type = 'supergroup';
  assert.equal(authorizeTelegram(group, c), null);
  const empty = telegramConfiguration({});
  assert.equal(empty.accessMode, 'allowlist'); assert.equal(authorizeTelegram(update(), empty), null);
  assert.throws(() => telegramConfiguration({ ...env, TELEGRAM_ACCESS_MODE: 'all' }));
});

test('Telegram public does not change Bitrix grants or token validation', () => {
  assert.deepEqual(ALLOWED_USERS, ['835', '626']);
  const bitrix = configuration({ ...env, BITRIX_MEMBER_ID: 'member',
    BITRIX_APPLICATION_TOKEN: 'synthetic-long-test-token', BITRIX_BOT_ID: '999' });
  assert.throws(() => authorize({ event: 'ONIMBOTMESSAGEADD',
    data: { USER: { ID: '777777777' } } }, bitrix), /unauthorized/);
  assert.throws(() => authorize({
    event: 'ONIMBOTMESSAGEADD', ts: String(Math.floor(Date.now() / 1000)),
    auth: { application_token: bitrix.applicationToken, member_id: 'member', domain: bitrix.domain },
    data: { USER: { ID: '777777777' }, PARAMS: { FROM_USER_ID: '777777777' } },
  }, bitrix), /forbidden/);
});

test('public sources show act title and original quote, never local paths/Obsidian', () => {
  const sources = chunks.map((s, i) => ({ ...s, sourceId: `S${i + 1}` }));
  const content = text => JSON.stringify({ claims: [{ text, sourceId: 'S1', quote }] });
  const answer = renderAnswer(content('Срок определяется законом.'), sources, { publicSources: true });
  assert.notEqual(answer, REFUSAL); assert.ok(answer.includes('331-ФЗ')); assert.ok(answer.includes(quote));
  assert.ok(answer.includes('https://publication.pravo.gov.ru/document/1234567890'));
  for (const hidden of ['Будущие нормы/', 'КАРТОЧКА.md', 'obsidian:', 'C:\\', 'строки извлечённого'])
    assert.ok(!answer.includes(hidden));
  for (const local of ['C:\\Users\\private\\secret.md', sources[0].file, 'КАРТОЧКА.md', 'obsidian://open?file=secret'])
    assert.equal(renderAnswer(content(local), sources, { publicSources: true }), REFUSAL);
  assert.ok(renderAnswer(content('Внутренний режим'), sources).includes('obsidian:'));
});

test('official references require exact official host, not credentials or spoofed URLs', () => {
  assert.deepEqual(officialLinks([
    'https://publication.pravo.gov.ru.evil.invalid/document/1',
    'https://attacker@publication.pravo.gov.ru/document/1', 'https://base.garant.ru/123/',
    'file:///C:/secret.md', 'https://publication.pravo.gov.ru/document/1234567890',
  ].join('\n')), ['https://publication.pravo.gov.ru/document/1234567890']);
});

test('Telegram has no per-user/day/session LLM quota; still serial, deduplicated and public-safe', async () => {
  let calls = 0; const sent = [];
  const q = makeTelegramQueue(c, { chunks }, {
    api: async (method, payload) => { assert.equal(method, 'sendMessage'); sent.push(payload.text); },
    llmTransport: async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: {
        content: JSON.stringify({ claims: [{ text: 'Срок указан в норме.', sourceId: 'S1', quote }] }),
      } }] }));
    },
  });
  for (let i = 1; i <= 60; i++) {
    const job = authorizeTelegram(update(777777777, i), c);
    q.add(job); assert.equal(q.add(job), 'duplicate');
    await drain(q);
  }
  assert.equal(calls, 60); assert.equal(sent.length, 60);
  assert.equal(q.rateLimit, null); assert.equal(q.sessionLimit, null);
  assert.equal(q.rates.size, 0); // Public strangers cannot grow an unbounded per-user rate table.
  assert.ok(sent.every(text => !text.includes('obsidian:') && !text.includes('КАРТОЧКА.md')));
});
