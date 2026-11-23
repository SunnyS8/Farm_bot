import { spawn } from 'node:child_process';
import { mkdir, open, writeFile, rmdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { telegramConfiguration, runTelegram } from '../src/telegram.mjs';

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), '..');
const state = path.join(root, '.state');
const lock = path.join(state, 'telegram-worker.lock');
const statusFile = path.join(state, 'telegram-worker.json');
const approved = () => ['--live', '--allow-telegram-polling', '--allow-paid-llm']
  .every(flag => process.argv.includes(flag));

async function prepare() {
  if (!approved()) throw new Error('telegram_explicit_consent_required');
  await mkdir(state, { recursive: true });
  const log = await open(path.join(state, 'telegram-safe.log'), 'a');
  const child = spawn(process.execPath, ['--env-file=.env', script, '--worker',
    '--live', '--allow-telegram-polling', '--allow-paid-llm'], {
    cwd: root, env: { ...process.env, RUN_MODE: 'offline' }, detached: true, windowsHide: true,
    stdio: ['ignore', log.fd, log.fd, 'ipc'],
  });
  await log.close();
  child.once('message', message => {
    console.log(JSON.stringify(message));
    child.disconnect(); child.unref();
    if (message.status !== 'ready') process.exitCode = 1;
  });
  child.once('error', () => { console.error('telegram_prepare_failed'); process.exitCode = 1; });
  child.once('exit', code => { if (code) process.exitCode = 1; });
}

async function worker() {
  if (!approved()) throw new Error('telegram_explicit_consent_required');
  let ownsLock = false;
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => controller.abort());
  try {
    await mkdir(state, { recursive: true });
    await mkdir(lock); ownsLock = true; // No API call if another owned polling worker exists.
    await writeFile(statusFile, JSON.stringify({ status: 'starting', pid: process.pid }));
    // Narrow runtime overrides only. Never edit/print the actual .env or provider key.
    const c = telegramConfiguration({ ...process.env, RUN_MODE: 'offline',
      LLM_MODEL: 'dots-studio/dots-3-note-preview:free', LLM_MAX_TOKENS: '1400' }, { live: true });
    if (c.accessMode !== 'public') throw new Error('telegram_public_required');
    await runTelegram(c, { consent: true, paidConsent: true, expectedUsername: 'zakfarm26_bot',
      signal: controller.signal, onError: () => console.error('telegram_job_failed'),
      onReady: async () => {
        const status = { status: 'ready', pid: process.pid, username: 'zakfarm26_bot',
          accessMode: 'public', privateOnly: true, telegramMode: 'live', bitrixMode: 'offline',
          llmModel: c.llm.model, maxTokens: c.llm.maxTokens, startedAt: new Date().toISOString() };
        await writeFile(statusFile, JSON.stringify(status, null, 2));
        console.log(JSON.stringify(status));
        if (process.connected) process.send(status);
      } });
  } catch (error) {
    // Only locally defined non-secret codes; never raw URL/API description/headers.
    const reason = ['telegram_existing_webhook', 'telegram_unexpected_bot', 'telegram_live_configuration_incomplete',
      'telegram_llm_configuration_incomplete', 'telegram_public_required'].includes(error.message) ?
      error.message : 'telegram_start_or_polling_failed';
    const status = { status: 'failed', reason, pid: process.pid };
    console.error(JSON.stringify(status));
    if (process.connected) process.send(status);
    if (ownsLock) await writeFile(statusFile, JSON.stringify(status));
    process.exitCode = 1;
  } finally {
    controller.abort();
    if (ownsLock) await rmdir(lock).catch(() => {});
  }
}

try {
  if (process.argv.includes('--prepare')) await prepare();
  else if (process.argv.includes('--worker')) await worker();
  else throw new Error('telegram_explicit_entrypoint_required');
} catch {
  console.error('telegram_worker_failed: secrets and raw errors suppressed');
  process.exitCode = 1;
}
