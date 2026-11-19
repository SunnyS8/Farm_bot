import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { configuration } from './config.mjs';
import { decodeBody, authorize, WorkQueue } from './security.mjs';
import { loadCorpus, search } from './retrieval.mjs';
import { generate, send } from './adapters.mjs';

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function createServer(c, corpus, { worker, onError = () => {}, exposeHealth = true } = {}) {
  const queue = new WorkQueue(worker || (async job => {
    if (c.mode !== 'live') return; // Offline callback never calls either remote API.
    const sources = search(corpus.chunks, job.question);
    const answer = await generate(c, job.question, sources);
    await send(c, job.sender, answer);
  }), { onError });
  const server = http.createServer(async (req, res) => {
    req.setTimeout(5000, () => req.destroy());
    if (exposeHealth && req.method === 'GET' && req.url === '/health') {
      return reply(res, 200, { status: 'ok', mode: c.mode, authenticationConfigured: c.authReady,
        files: corpus.files, chunks: corpus.chunks.length, pending: queue.jobs.length,
        processed: queue.processed, failed: queue.failed });
    }
    if (req.method !== 'POST' || req.url !== '/bitrix/events') return reply(res, 404, { error: 'not_found' });
    try {
      const body = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) { reply(res, 413, { error: 'body_limit' }); req.destroy(); return; }
        body.push(chunk);
      }
      const type = (req.headers['content-type'] || '').split(';')[0].trim();
      const job = authorize(decodeBody(Buffer.concat(body).toString('utf8'), type), c);
      const status = queue.add(job);
      reply(res, 200, { status }); // ACK before LLM work; no answer in callback body.
    } catch (error) {
      const code = error.message;
      const status = code === 'unauthorized' ? 401 :
        ['forbidden', 'expired_event', 'unsupported_event'].includes(code) ? 403 :
          ['queue_full', 'rate_limit'].includes(code) ? 429 : 400;
      if (!res.headersSent && !res.destroyed) reply(res, status, { error: status === 400 ? 'invalid_request' : code });
    }
  });
  server.requestTimeout = 8000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 40;
  return { server, queue };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const c = configuration();
    const corpus = await loadCorpus();
    const { server } = createServer(c, corpus, { onError: () => console.error('job_failed') });
    server.on('error', () => { console.error('listen_failed'); process.exitCode = 1; });
    server.listen(c.port, '127.0.0.1', () => console.log(`pilot_ready mode=${c.mode} port=${c.port}`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
      server.close(); setTimeout(() => process.exit(0), 1000).unref();
    });
  } catch { console.error('startup_failed: check local configuration and vault accessibility'); process.exitCode = 1; }
}
