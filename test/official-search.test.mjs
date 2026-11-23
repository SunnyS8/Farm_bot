import test from 'node:test';
import assert from 'node:assert/strict';
import { needsOfficialSearch, officialQueries, renderOfficialSearch,
  searchOfficialPublications } from '../src/official-search.mjs';

const fixedNow = () => new Date('2026-11-23T10:00:00.000Z');

test('official search routes freshness and missing-local questions', () => {
  assert.equal(needsOfficialSearch('Действует ли приказ сейчас?', true), true);
  assert.equal(needsOfficialSearch('Что сказано в статье 5?', true), false);
  assert.equal(needsOfficialSearch('Найди приказ Минздрава', false), true);
  assert.deepEqual(officialQueries('61-ФЗ и ПП РФ № 719'), [
    { Number: '61-ФЗ', NumberSearchType: '0' },
    { Number: '719', NumberSearchType: '0' },
  ]);
});

test('official client uses only fixed HTTPS API and normalizes bounded results', async () => {
  const urls = [];
  const result = await searchOfficialPublications('ПП РФ № 719', {
    now: fixedNow,
    transport: async (url, options) => {
      urls.push(url);
      assert.equal(url.origin, 'https://publication.pravo.gov.ru');
      assert.equal(url.pathname, '/api/Documents');
      assert.equal(url.searchParams.get('Number'), '719');
      assert.equal(url.searchParams.get('PageSize'), '10');
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      return new Response(JSON.stringify({ items: [{
        eoNumber: '0001201507200016',
        complexName: 'Постановление Правительства Российской Федерации от 17.07.2015 № 719',
        publishDateShort: '2015-07-20T00:00:00',
        number: '719',
      }] }), { headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal(urls.length, 1);
  assert.equal(result.status, 'ok');
  assert.equal(result.items[0].url,
    'https://publication.pravo.gov.ru/document/0001201507200016');
  const rendered = renderOfficialSearch(result);
  assert.match(rendered, /официальному источнику/i);
  assert.match(rendered, /не подтверждает текущий статус/i);
});

test('official client fails closed on errors, invalid JSON and oversized bodies', async () => {
  for (const transport of [
    async () => { throw new Error('network secret'); },
    async () => new Response('not json'),
    async () => new Response('x'.repeat(513 * 1024)),
  ]) {
    const result = await searchOfficialPublications('331-ФЗ', { now: fixedNow, transport });
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.items, []);
    assert.ok(!renderOfficialSearch(result).includes('secret'));
  }
});
