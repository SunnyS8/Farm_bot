import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuration } from '../src/config.mjs';
import { createServer } from '../src/server.mjs';
import { loadCorpus } from '../src/retrieval.mjs';

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), '..');
const stateDir = path.join(root, '.state');
const statusFile = path.join(stateDir, 'tunnel.json');
const expectedHash = '341deda3db5ec498a0482254d6c38c0b7cf01a30c37bb5dd95d2216d08955e35';
const binary = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cloudflared', 'cloudflared.exe');

async function prepare() {
  await mkdir(stateDir, { recursive: true });
  const log = await open(path.join(stateDir, 'tunnel-safe.log'), 'a');
  const child = spawn(process.execPath, ['--env-file=.env', script, '--worker'], {
    cwd: root, detached: true, windowsHide: true,
    stdio: ['ignore', log.fd, log.fd, 'ipc'],
    env: { ...process.env, RUN_MODE: 'offline', PORT: '8787' },
  });
  await log.close();
  child.on('error', () => { console.error('tunnel_prepare_failed'); process.exitCode = 1; });
  // Event driven: do not poll a log file, process list, or readiness URL.
  child.once('message', message => {
    console.log(JSON.stringify(message));
    if (child.connected) child.disconnect();
    child.unref();
    if (message.status !== 'ready') process.exitCode = 1;
  });
  child.once('exit', code => { if (code) process.exitCode = 1; });
}

async function worker() {
  let tunnel, server, shuttingDown = false, ready = false;
  const shutdown = async failed => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (tunnel && tunnel.exitCode === null) tunnel.kill();
    server?.closeAllConnections(); server?.close();
    if (process.connected) process.send({ status: failed ? 'failed' : 'stopped' });
    await writeFile(statusFile, JSON.stringify({ status: failed ? 'failed' : 'stopped', pid: process.pid }));
    process.exit(failed ? 1 : 0);
  };
  try {
    const hash = createHash('sha256').update(await readFile(binary)).digest('hex');
    if (hash !== expectedHash) throw new Error('binary_not_verified');
    const c = configuration();
    if (c.mode !== 'offline' || c.port !== 8787) throw new Error('offline_required');
    const corpus = await loadCorpus();
    ({ server } = createServer(c, corpus, { exposeHealth: false }));
    server.listen(8787, '127.0.0.1');
    await once(server, 'listening'); // EADDRINUSE rejects, never tunnel an unknown service.
    const home = path.join(stateDir, 'cloudflared-home');
    await mkdir(home, { recursive: true });
    // Do not pass LLM keys, Bitrix secrets, or unrelated TUNNEL_* variables to cloudflared.
    const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'ComSpec', 'TEMP', 'TMP', 'LOCALAPPDATA']
      .filter(name => process.env[name]).map(name => [name, process.env[name]]));
    env.HOME = home; env.USERPROFILE = home;
    tunnel = spawn(binary, ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:8787',
      '--metrics', '127.0.0.1:0', '--loglevel', 'info'], {
      cwd: home, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env,
    });
    let origin, registered = false, announcing = false;
    const announce = async () => {
      if (!origin || !registered || ready || announcing) return;
      announcing = true;
      const status = { status: 'ready', pid: process.pid, tunnelPid: tunnel.pid,
        origin, callback: `${origin}/bitrix/events`, mode: c.mode,
        authenticationConfigured: c.authReady, publicHealth: false,
        bootstrapBlocked: !c.authReady, binaryVersion: '2026.11.1', sha256: hash };
      await writeFile(statusFile, JSON.stringify(status, null, 2));
      ready = true; clearTimeout(deadline);
      console.log(JSON.stringify(status));
      if (process.connected) process.send(status);
    };
    const capture = chunk => {
      const text = chunk.toString('utf8');
      const url = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/);
      if (url) origin = url[0];
      if (text.includes('Registered tunnel connection')) registered = true;
      // Raw cloudflared output/requests/headers are neither saved nor printed.
      announce().catch(() => shutdown(true));
    };
    const deadline = setTimeout(() => shutdown(true), 90000);
    tunnel.stdout.on('data', capture); tunnel.stderr.on('data', capture);
    tunnel.once('error', () => shutdown(true));
    tunnel.once('exit', () => shutdown(true));
    server.on('error', () => shutdown(true));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(false));
    // Stop the temporary exposure automatically after two hours.
    setTimeout(() => shutdown(false), 2 * 60 * 60 * 1000).unref();
  } catch { await shutdown(true); }
}

if (process.argv.includes('--prepare')) await prepare();
else if (process.argv.includes('--worker')) await worker();
else console.error('Use --prepare. This entrypoint always forces offline and disables public health.');
