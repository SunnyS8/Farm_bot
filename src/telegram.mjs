import { pathToFileURL } from 'node:url';
import { configuration } from './config.mjs';
import { WorkQueue } from './security.mjs';
import { loadCorpus, search } from './retrieval.mjs';
import { generate, DISCLAIMER } from './adapters.mjs';

export const GREETING = `Здравствуйте! Я консультант по локальной нормативной базе Эском. Укажите номер акта, статью или вопрос. Отвечаю только по найденным источникам с цитатами.
Пилот может быть публичным; группы не поддерживаются. Число обращений к ИИ ограничено.
Вопросы проходят через Telegram и Hubris; цитаты документов также попадут в Telegram. Не отправляйте персональные данные и корпоративные секреты. Использование Telegram должно быть отдельно согласовано вашей организацией.
${DISCLAIMER}`;

const numericId = value => Number.isSafeInteger(value) && value > 0 ? String(value) : '';
const updateId = value => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
export function telegramConfiguration(env = process.env, { live = false } = {}) {
  // Telegram must not inherit Bitrix's requirements or access grants.
  const llm = configuration({ ...env, RUN_MODE: 'offline' });
  const mode = live ? 'live' : env.RUN_MODE || 'offline';
  if (!['offline', 'live'].includes(mode)) throw new Error('telegram_invalid_mode');
  const accessMode = env.TELEGRAM_ACCESS_MODE || 'allowlist';
  if (!['allowlist', 'public'].includes(accessMode)) throw new Error('telegram_invalid_access_mode');
  const raw = env.TELEGRAM_ALLOWED_USER_IDS?.trim() || '';
  const allowed = raw ? raw.split(',').map(id => id.trim()) : [];
  if (allowed.length > 10 || allowed.some(id => !/^[1-9]\d*$/.test(id) ||
      !Number.isSafeInteger(Number(id)) || ['835', '626'].includes(id)))
    throw new Error('telegram_invalid_allowlist');
  const token = env.TELEGRAM_BOT_TOKEN || '';
  const tokenReady = /^\d{5,}:[A-Za-z0-9_-]{20,200}$/.test(token);
  if (mode === 'live') {
    if ((accessMode === 'allowlist' && !allowed.length) || !tokenReady) throw new Error('telegram_live_configuration_incomplete');
    // No hidden provider/model choice, and no paid fallback.
    if (llm.protocol !== 'openai-chat-completions' || !llm.provider ||
        llm.endpoint !== 'https://api.hubris.pw/v1/chat/completions' ||
        llm.model !== 'openai/gpt-4o-mini' || !llm.apiKey || llm.maxTokens > 1400)
      throw new Error('telegram_llm_configuration_incomplete');
  }
  return Object.freeze({ mode, accessMode,
    allowed: Object.freeze([...new Set(allowed)]), token, tokenReady,
    llm: Object.freeze({ ...llm, mode }) });
}

export function privateMessage(update, now = Date.now()) {
  const m = update?.message;
  if (!updateId(update?.update_id) || !m || m.chat?.type !== 'private' ||
      m.from?.is_bot !== false || !numericId(m.from?.id) || m.chat.id !== m.from.id ||
      !numericId(m.message_id) || m.sender_chat || m.forward_origin || m.forward_from || m.via_bot ||
      !Number.isSafeInteger(m.date) || Math.abs(now / 1000 - m.date) > 300 ||
      typeof m.text !== 'string' || !m.text.trim() || m.text.length > 2000) return null;
  return Object.freeze({ sender: String(m.from.id), messageId: String(m.message_id),
    question: m.text.trim(), key: `tg:${m.from.id}:${m.message_id}` });
}

export function authorizeTelegram(update, c, now = Date.now()) {
  const job = privateMessage(update, now);
  return job && permits(c, job.sender) ? job : null;
}

const permits = (c, sender) => /^[1-9]\d*$/.test(sender) &&
  (c.accessMode === 'public' || c.allowed.includes(sender));

export function bootstrapIds(updates, now = Date.now()) {
  return [...new Set(updates.map(update => privateMessage(update, now))
    .filter(job => job?.question === '/start').map(job => job.sender))];
}

export function telegramClient(c, { transport = fetch, signal, readOnly = false } = {}) {
  return async (method, payload = {}) => {
    if (!c.tokenReady || !['getMe', 'getWebhookInfo', 'getUpdates', 'sendMessage'].includes(method) ||
        (readOnly && method === 'sendMessage')) throw new Error('telegram_method_not_allowed');
    if (method === 'sendMessage' && (c.mode !== 'live' ||
        !permits(c, numericId(payload.chat_id)) || typeof payload.text !== 'string' ||
        !payload.text.trim() || payload.text.length > 4096 || payload.allow_paid_broadcast === true ||
        payload.parse_mode !== undefined))
      throw new Error('telegram_send_denied');
    try {
      const response = await transport(`https://api.telegram.org/bot${c.token}/${method}`, {
        method: 'POST', redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(40000)]) : AbortSignal.timeout(40000),
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error('upstream'); }
      let size = 0; const chunks = [];
      if (!response.body) throw new Error('empty');
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 512 * 1024) throw new Error('size');
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (data.ok !== true) throw new Error('api_error');
      return data.result;
    } catch {
      // fetch exceptions may contain the token-bearing URL! Never propagate raw errors.
      throw new Error('telegram_request_failed');
    }
  };
}

export function makeTelegramQueue(c, corpus, { api, llmTransport = fetch, signal,
  onError = () => {} } = {}) {
  if (c.mode !== 'live' || (c.accessMode !== 'public' && !c.allowed.length)) throw new Error('telegram_live_required');
  return new WorkQueue(async job => {
    if (signal?.aborted || !permits(c, job.sender)) return;
    let answer;
    if (job.question === '/start') answer =
      (c.accessMode === 'public' ? 'Это общедоступный пилот, только личные чаты.\n' : '') + GREETING;
    else if (job.question.startsWith('/')) answer = 'Напишите нормативный вопрос текстом, например номер акта и статью.';
    else {
      const sources = search(corpus.chunks, job.question);
      answer = await generate(c.llm, job.question, sources, llmTransport, () => {},
        { publicSources: c.accessMode === 'public' });
    }
    if (signal?.aborted) return;
    if (answer.length > 4096) answer = `Ответ с источниками превышает лимит одного сообщения. Уточните статью или сузьте вопрос.\n\n${DISCLAIMER}`;
    await api('sendMessage', { chat_id: Number(job.sender), text: answer,
      link_preview_options: { is_disabled: true }, protect_content: true });
  }, { max: 20, onError, rateLimit: null, sessionLimit: null });
}

export async function bootstrapTelegram(c, { consent = false, transport = fetch, write = id => console.log(id) } = {}) {
  if (!consent || !c.tokenReady || c.mode !== 'offline') throw new Error('telegram_bootstrap_consent_required');
  const api = telegramClient(c, { transport, readOnly: true });
  const me = await api('getMe');
  if (me?.is_bot !== true || !numericId(me.id)) throw new Error('telegram_invalid_bot');
  // One bounded getUpdates request; no send, offset, webhook deletion or auto-enrolment.
  const updates = await api('getUpdates', { timeout: 25, limit: 100, allowed_updates: ['message'] });
  if (!Array.isArray(updates)) throw new Error('telegram_invalid_updates');
  const ids = bootstrapIds(updates);
  for (const id of ids) write(id); // stdout: only numeric from.id; never names/questions/tokens.
  return ids.length;
}

export async function runTelegram(c, { consent = false, paidConsent = false, transport = fetch, llmTransport = fetch,
  corpusLoader = loadCorpus, signal, onError = () => {}, expectedUsername, onReady = () => {} } = {}) {
  if (c.mode !== 'live' || !consent || !paidConsent || (c.accessMode !== 'public' && !c.allowed.length) || !c.tokenReady)
    throw new Error('telegram_polling_consent_required');
  const api = telegramClient(c, { transport, signal });
  const me = await api('getMe');
  if (me?.is_bot !== true || !numericId(me.id)) throw new Error('telegram_invalid_bot');
  if (expectedUsername && me.username?.toLowerCase() !== expectedUsername.toLowerCase())
    throw new Error('telegram_unexpected_bot');
  const webhook = await api('getWebhookInfo');
  if (!webhook || typeof webhook.url !== 'string') throw new Error('telegram_invalid_webhook_state');
  if (webhook.url) throw new Error('telegram_existing_webhook');
  const corpus = await corpusLoader();
  const queue = makeTelegramQueue(c, corpus, { api, llmTransport, signal, onError });
  await onReady();
  let offset = 0;
  while (!signal?.aborted) {
    const updates = await api('getUpdates', { offset, timeout: 25, limit: 10, allowed_updates: ['message'] });
    if (!Array.isArray(updates) || updates.some(u => !updateId(u?.update_id)))
      throw new Error('telegram_invalid_updates');
    for (const update of updates) {
      // Offset acknowledges ignored/queued updates, not successful delivery. Pilot is volatile.
      offset = Math.max(offset, update.update_id + 1);
      const job = authorizeTelegram(update, c);
      if (!job) continue;
      try { queue.add(job); } catch { /* overload/rate limits: silent discard, no paid retry */ }
    }
  }
  return queue;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => controller.abort());
  try {
    if (process.argv.includes('--bootstrap')) {
      const c = telegramConfiguration();
      await bootstrapTelegram(c, { consent: process.argv.includes('--allow-telegram-bootstrap') });
    } else {
      const c = telegramConfiguration(process.env, { live: process.argv.includes('--live') });
      if (c.mode === 'offline') console.log('telegram_offline: no network requests');
      else await runTelegram(c, { consent: process.argv.includes('--allow-telegram-polling'),
        paidConsent: process.argv.includes('--allow-paid-llm'),
        signal: controller.signal, onError: () => console.error('telegram_job_failed') });
    }
  } catch {
    if (!controller.signal.aborted) {
      console.error('telegram_failed: check local configuration/consent; raw errors suppressed');
      process.exitCode = 1;
    }
    controller.abort();
  }
}
