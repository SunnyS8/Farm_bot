import test from 'node:test';
import assert from 'node:assert/strict';
import { whitespaceMap, normalizedQuote, findQuoteRange } from '../src/quotes.mjs';
import { inspectAnswer, renderAnswer, REFUSAL } from '../src/adapters.mjs';

const body = 'Настоящий закон не вступает в силу ранее 01.03.2027, за исключением статьи 5.';
const source = text => [{ sourceId: 'S1', file: 'Законы/Тест/КАРТОЧКА.md', start: 1, end: 9, text }];
const content = quote => JSON.stringify({ claims: [{ text: 'Проверенная выдержка', sourceId: 'S1', quote }] });

test('NBSP and Unicode whitespace canonicalization restores original source span and punctuation', () => {
  const original = body.replaceAll(' ', '\u00a0');
  const sources = source('Введение.\n' + original + '\nОкончание.');
  const checked = inspectAnswer(content(body), sources);
  assert.equal(checked.reason, 'grounded');
  const claim = checked.claims[0];
  assert.equal(claim.quote, original);
  assert.equal(sources[0].text.slice(claim.quoteStart, claim.quoteEnd), original);
  const rendered = renderAnswer(content(body), sources);
  assert.ok(rendered.includes(`Цитата: «${original}»`));
  assert.ok(!rendered.includes(`Цитата: «${body}»`));
  for (const ws of [' ', '\u00a0', '\u202f', '\t', '\r\n', '\n\n ']) {
    const variant = body.replaceAll(' ', ws);
    assert.equal(inspectAnswer(content(body), source(variant)).claims[0].quote, variant);
  }
});

test('multiline matching is continuous and maps UTF-16 indexes including an astral prefix', () => {
  const original = body.replace('не вступает', 'не\r\n \tвступает').replace('за исключением', 'за\n\nисключением');
  const full = '📚 Вводный текст:\r\n' + original + '\r\nКонец';
  const quote = '\u00a0' + body.replaceAll(' ', '\u202f') + '\r\n';
  const match = findQuoteRange(full, quote);
  assert.equal(match.text, original);
  assert.equal(match.start, full.indexOf('Настоящий'));
  assert.equal(full.slice(match.start, match.end), original);
  const mapped = whitespaceMap('a \r\n\u00a0b');
  assert.equal(mapped.normalized, 'a b');
  assert.deepEqual(mapped.starts, [0, 1, 5]);
  assert.deepEqual(mapped.ends, [1, 5, 6]);
});

test('changed date, negation, punctuation, case and concatenated distant words rejected', () => {
  for (const quote of [
    body.replace('2027', '2026'),
    body.replace('не вступает', 'вступает'),
    body.replace(',', ';'),
    body.replace('закон', 'Закон'),
    body.replace('не вступает в силу ранее', 'не вступает ранее'),
    body.replace('закон не', 'законне'),
    body.replace('01.03.2027', '01 .03.2027'),
  ]) {
    assert.equal(findQuoteRange(body, quote), null, quote);
    assert.equal(renderAnswer(content(quote), source(body)), REFUSAL);
  }
});

test('NUL, zero width space, joiner, soft hyphen and BOM are not ignored as whitespace', () => {
  for (const char of ['\0', '\u200b', '\u200c', '\u200d', '\u2060', '\ufeff', '\u00ad']) {
    assert.equal(normalizedQuote(`a${char}b`), `a${char}b`);
    const changed = body.replace('закон', `за${char}кон`);
    assert.equal(findQuoteRange(body, changed), null);
    assert.equal(findQuoteRange(changed, body), null);
    assert.equal(inspectAnswer(content(changed), source(body)).ok, false);
  }
});

test('raw/canonical minimum and maximum source restoration bounds fail closed', () => {
  assert.equal(inspectAnswer(content(' '.repeat(40)), source(' '.repeat(40))).reason, 'quote_too_short');
  assert.equal(inspectAnswer(content('a' + ' '.repeat(40) + 'b'), source('a b')).reason, 'quote_too_short');
  assert.equal(inspectAnswer(content('a'.repeat(501)), source('a'.repeat(501))).reason, 'quote_too_long');
  const expanded = body.replace('закон не', 'закон' + '\n'.repeat(1001) + 'не');
  assert.equal(inspectAnswer(content(body), source(expanded)).reason, 'source_quote_too_long');
});

test('source BB-code/link punctuation is not silently rewritten into a purported exact quote', () => {
  for (const unsafe of [body + ' [USER=1]X[/USER]', body + ' https://example.invalid']) {
    assert.equal(inspectAnswer(content(unsafe), source(unsafe)).reason, 'unsafe_quote_markup');
    assert.equal(renderAnswer(content(unsafe), source(unsafe)), REFUSAL);
  }
});
