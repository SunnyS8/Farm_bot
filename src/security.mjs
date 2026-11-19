import { timingSafeEqual } from 'node:crypto';
import { ALLOWED_USERS } from './config.mjs';

const scalar = x => typeof x === 'string' || typeof x === 'number' ? String(x) : '';
const id = x => /^[1-9]\d*$/.test(scalar(x)) ? scalar(x) : '';
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

// PHP bracket notation without third-party parsers or prototype pollution.
export function decodeBody(body, contentType) {
  if (contentType === 'application/json') return JSON.parse(body);
  if (contentType !== 'application/x-www-form-urlencoded') throw new Error('unsupported_type');
  const result = Object.create(null);
  let count = 0;
  for (const [key, value] of new URLSearchParams(body)) {
    if (++count > 500 || !/^[A-Za-z0-9_]+(?:\[[A-Za-z0-9_]+\])*$/.test(key))
      throw new Error('invalid_form');
    const parts = key.match(/[A-Za-z0-9_]+/g);
    if (parts.length > 8 || parts.some(p => ['__proto__', 'constructor', 'prototype'].includes(p)))
      throw new Error('invalid_form');
    let current = result;
    for (const p of parts.slice(0, -1)) {
      if (Object.hasOwn(current, p) && typeof current[p] !== 'object') throw new Error('duplicate_field');
      current = current[p] ??= Object.create(null);
    }
    const last = parts.at(-1);
    if (Object.hasOwn(current, last)) throw new Error('duplicate_field');
    current[last] = value;
  }
  return result;
}

export function authorize(payload, c, now = Date.now()) {
  const a = payload?.auth;
  if (!c.authReady || !equal(a?.application_token, c.applicationToken) ||
      !equal(a?.member_id, c.memberId) || a?.domain !== c.domain)
    throw new Error('unauthorized');
  if (payload.event !== 'ONIMBOTMESSAGEADD') throw new Error('unsupported_event');
  const ts = Number(payload.ts);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) throw new Error('expired_event');
  const p = payload.data?.PARAMS, u = payload.data?.USER;
  const sender = id(p?.FROM_USER_ID);
  if (!ALLOWED_USERS.includes(sender) || id(u?.ID) !== sender ||
      id(p?.AUTHOR_ID) !== sender || scalar(p?.DIALOG_ID) !== sender ||
      p?.MESSAGE_TYPE !== 'P' || p?.CHAT_TYPE !== 'P' || p?.SYSTEM !== 'N' ||
      u?.IS_BOT !== 'N' || u?.IS_CONNECTOR !== 'N' || u?.IS_EXTRANET !== 'N' ||
      id(p?.TO_USER_ID) !== c.botId ||
      id(payload.data?.BOT?.[c.botId]?.BOT_ID) !== c.botId)
    throw new Error('forbidden');
  const messageId = id(p.MESSAGE_ID);
  if (!messageId || typeof p.MESSAGE !== 'string' || !p.MESSAGE.trim() || p.MESSAGE.length > 2000)
    throw new Error('invalid_message');
  // Discard all incoming OAuth credentials/endpoints immediately; never use them.
  return Object.freeze({ sender, messageId, question: p.MESSAGE.trim(), key: `${c.botId}:${messageId}` });
}

export class WorkQueue {
  constructor(worker, { max = 20, now = () => Date.now(), onError = () => {},
    rateLimit = 5, sessionLimit = 50 } = {}) {
    this.worker = worker; this.max = max; this.now = now; this.onError = onError;
    this.jobs = []; this.seen = new Map(); this.rates = new Map(); this.running = false;
    this.total = 0; this.processed = 0; this.failed = 0;
    this.rateLimit = rateLimit; this.sessionLimit = sessionLimit;
  }
  add(job) {
    const now = this.now();
    for (const [key, expiry] of this.seen) if (expiry <= now) this.seen.delete(key);
    if (this.seen.has(job.key)) return 'duplicate';
    if (this.jobs.length + Number(this.running) >= this.max || this.seen.size >= 1000)
      throw new Error('queue_full');
    const history = this.rateLimit === null ? [] :
      (this.rates.get(job.sender) || []).filter(t => now - t < 60_000);
    if ((this.rateLimit !== null && history.length >= this.rateLimit) ||
        (this.sessionLimit !== null && this.total >= this.sessionLimit)) throw new Error('rate_limit');
    if (this.rateLimit !== null) { history.push(now); this.rates.set(job.sender, history); }
    this.seen.set(job.key, now + 600_000); this.total++;
    this.jobs.push(job);
    // Worker starts after the HTTP callback has had a chance to send ACK.
    if (!this.running) { this.running = true; setImmediate(() => this.drain()); }
    return 'accepted';
  }
  async drain() {
    while (this.jobs.length) {
      const job = this.jobs.shift();
      try { await this.worker(job); this.processed++; }
      catch { this.failed++; this.onError('job_failed'); }
    }
    this.running = false;
  }
}
