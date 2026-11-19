import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { configuration } from '../src/config.mjs';
import { createServer } from '../src/server.mjs';

test('tunnel exposure without Bitrix configuration is fail-closed and hides health/routes', async t => {
  const c = configuration({ RUN_MODE: 'offline' });
  assert.equal(c.authReady, false);
  let worked = false;
  const { server } = createServer(c, { files: 0, chunks: [] }, {
    exposeHealth: false, worker: async () => { worked = true; },
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/health', '/', '/.env', '/src/server.mjs', '/bitrix/events']) {
    assert.equal((await fetch(base + route)).status, 404);
  }
  const denied = await fetch(base + '/bitrix/events', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'ONIMBOTMESSAGEADD', data: { USER: { ID: '835' } } }),
  });
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { error: 'unauthorized' });
  assert.equal(worked, false);
});
