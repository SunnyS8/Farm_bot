import test from 'node:test';
import assert from 'node:assert/strict';
import { actIds, lawIds, loadCorpus, search, chunksOf } from '../src/retrieval.mjs';
import { inspectAnswer, renderAnswer, generate, REFUSAL } from '../src/adapters.mjs';
import { configuration } from '../src/config.mjs';
import { answerActStructure, answerRrpp, asksForActStructure } from '../src/legal-answers.mjs';

const folder = 'Будущие нормы/08_331-ФЗ_2026';
const card = '# Федеральный закон № 331-ФЗ\nСтатус: НЕ ВСТУПИЛ В СИЛУ. См. сроки и исключения.\n' +
  'Карточка не является полным текстом акта. Полнота: полный текст доступной редакции.';
// Synthetic dates make the test independent of a hardcoded answer for one statute.
const provision = 'Статья 7\n1. Настоящий Федеральный закон вступает в силу с 1 марта 2090 года, ' +
  'за исключением статьи 5 настоящего Федерального закона.\n' +
  '2. Статья 5 настоящего Федерального закона вступает в силу с 1 декабря 2089 года.';
const corpus = [
  ...chunksOf('Когда закон вступит в силу — новости 44-ФЗ. Нерелевантная общая навигация сайта.'.repeat(2),
    'Законы/11_44-ФЗ_2013/Части/020.html'),
  ...chunksOf('Федеральный закон 331-ФЗ меняет статью 5 закона 61-ФЗ. Изменения вступают в силу отдельно.',
    'Законы/01_61-ФЗ_2010/Источник_карточка.html'),
  ...chunksOf(card, `${folder}/КАРТОЧКА.md`),
  ...chunksOf('Это обзорный раздел, содержащий другие статьи о требованиях маркировки и реестрах.'.repeat(2),
    `${folder}/Текст_для_чтения.html`),
  ...chunksOf(provision, `${folder}/Текст_для_чтения.html`).map(s => ({ ...s, start: 410, end: 459 })),
  ...chunksOf('Новости, когда совокупность сделок расценивается как антиконкурентное соглашение.'.repeat(2),
    `${folder}/Источник_карточка.html`),
];

test('legal structure mode lists every article deterministically without an LLM', () => {
  const synthetic = [];
  for (let number = 1; number <= 3; number++) {
    const body = number < 3
      ? `Статья ${number}\nВнести в Федеральный закон от 1 января 2020 года № ${number}00-ФЗ "Тестовый закон ${number}" следующие изменения.`
      : 'Статья 3\nНастоящий Федеральный закон вступает в силу с 1 марта 2090 года. Статья 5 настоящего Федерального закона вступает в силу с 1 декабря 2089 года.';
    synthetic.push(...chunksOf(body, `${folder}/Части/${String(number).padStart(3, '0')}.html`));
  }
  synthetic.push(...chunksOf(
    'Федеральный закон от 04.08.2026 № 331-ФЗ "О тестовых изменениях"\nhttps://publication.pravo.gov.ru/document/0000000000000000',
    `${folder}/КАРТОЧКА.md`,
  ));
  const question = 'Федеральный закон от 04.08.2026 № 331-ФЗ. Перечисли все статьи.';
  assert.equal(asksForActStructure(question), true);
  const answer = answerActStructure(synthetic, question);
  assert.match(answer, /В локальной копии закона 3 статьи/);
  assert.match(answer, /Статья 1 — изменения в Федеральный закон № 100-ФЗ/);
  assert.match(answer, /Статья 3 — сроки вступления/);
  assert.match(answer, /publication\.pravo\.gov\.ru/);
});

test('exact law identity normalizes unicode dashes, not adjacent numbers/types', () => {
  assert.deepEqual(lawIds('№ 331‑ФЗ, 331 – ФЗ; 1331-ФЗ и 331-ФКЗ'), ['331-фз', '1331-фз', '331-фкз']);
  assert.deepEqual(lawIds('331-ФЗabc 331-ФЗ2 abc331-ФЗ'), []);
});

test('cross-act identity recognizes laws and government decisions', () => {
  assert.deepEqual(actIds('44-ФЗ с учётом ПП РФ № 719 и ПП № 1875'),
    ['44-фз', 'пп-719', 'пп-1875']);
  assert.deepEqual(actIds('44-ФЗ с учётом ПП РФ № 719 и № 1875'),
    ['44-фз', 'пп-719', 'пп-1875']);
  assert.deepEqual(actIds('Постановление Правительства Российской Федерации от 17.07.2015 № 719'),
    ['пп-719']);
  assert.deepEqual(actIds('товар 719 и запись 1875'), []);
});

test('regression: Когда вступит в силу 331-ФЗ? selects own card then full commencement provision', () => {
  const result = search(corpus, 'Когда вступит в силу 331-ФЗ?');
  assert.ok(result.length >= 2 && result.length <= 4);
  assert.ok(result.every(s => s.file.startsWith(`${folder}/`)));
  assert.ok(result[0].file.endsWith('/КАРТОЧКА.md'));
  assert.equal(result[1].text, provision);
  assert.ok(result[1].text.includes('за исключением статьи 5'));
  assert.ok(result.every(s => !s.text.includes('Новости')));
  assert.deepEqual(result.map(s => s.sourceId), result.map((_, i) => `S${i + 1}`));
  assert.ok(search(corpus, 'Когда вступит в силу 331-ФЗ в 2027 году?').length >= 2);
});

test('no silent cross-reference or partial number fallback; ambiguity requires clarification', () => {
  assert.deepEqual(search(corpus, 'Когда вступит в силу 1331-ФЗ?'), []);
  assert.deepEqual(search(corpus.filter(s => !s.file.startsWith(folder)), 'Когда вступит в силу 331-ФЗ?'), []);
  const both = [...corpus, ...chunksOf(card, 'Архив/331-ФЗ_2020/КАРТОЧКА.md')];
  assert.deepEqual(search(both, 'Когда вступит в силу 331-ФЗ?'), []);
  assert.ok(search(both, 'Когда вступит в силу 331-ФЗ от 04.08.2026?').length > 0);
  assert.ok(search(both, 'Когда вступит в силу 331-ФЗ от 4 августа 2026 года?').length > 0);
});

test('source grounding accepts exact applicable quote, rejects wrong source, year, spacing and lengths', () => {
  const result = search(corpus, 'Когда вступит в силу 331-ФЗ?');
  const source = result.find(s => s.text === provision);
  const quote = provision.split('\n').slice(1).join('\n');
  const answer = JSON.stringify({ claims: [{ text: 'Общий срок и исключение приведены в статье 7.',
    sourceId: source.sourceId, quote }] });
  assert.equal(inspectAnswer(answer, result).reason, 'grounded');
  assert.notEqual(renderAnswer(answer, result), REFUSAL);
  assert.equal(renderAnswer(answer.replace('2090', '2027'), result), REFUSAL);
  assert.equal(renderAnswer(answer.replace(source.sourceId, 'S1'), result), REFUSAL);
  const make = quote => JSON.stringify({ claims: [{ text: 'Вывод', sourceId: source.sourceId, quote }] });
  assert.equal(inspectAnswer(make('a'.repeat(39)), result).reason, 'quote_too_short');
  assert.equal(inspectAnswer(make('a'.repeat(501)), result).reason, 'quote_too_long');
  const nbsp = [{ ...source, text: source.text.replaceAll(' ', '\u00a0') }];
  assert.equal(inspectAnswer(answer, nbsp).reason, 'grounded');
  assert.notEqual(renderAnswer(answer, nbsp), REFUSAL);
  assert.equal(inspectAnswer('```json\n' + answer + '\n```', result).reason, 'fenced_json');
  assert.equal(renderAnswer('```json\n' + answer + '\n```', result), REFUSAL);
});

test('reasoning-only, truncated or fenced output is diagnosed but never promoted to answer', async () => {
  const result = search(corpus, 'Когда вступит в силу 331-ФЗ?');
  const source = result[1];
  const valid = JSON.stringify({ claims: [{ text: 'Срок из источника', sourceId: source.sourceId,
    quote: provision.split('\n')[1] }] });
  const cfg = { mode: 'live', endpoint: 'https://mock.invalid/chat', model: 'mock', apiKey: 'synthetic' };
  for (const [message, finish_reason, expected] of [
    [{ content: null, reasoning_content: valid }, 'stop', 'missing_answer_content'],
    [{ content: valid }, 'length', 'truncated_answer'],
    [{ content: '```json\n' + valid + '\n```' }, 'stop', 'fenced_json'],
  ]) {
    let diagnostic;
    const answer = await generate(cfg, 'Когда вступит в силу 331-ФЗ?', result,
      async () => new Response(JSON.stringify({ choices: [{ message, finish_reason }] })),
      info => { diagnostic = info; });
    assert.equal(answer, REFUSAL);
    assert.equal(diagnostic.reason, expected);
    assert.ok(!JSON.stringify(diagnostic).includes('Срок из источника'));
  }
});

test('explicit bounded output budget forwarded unchanged; no automatic retry on truncation', async () => {
  assert.equal(configuration({}).maxTokens, 1400);
  for (const value of ['0', '255', '8193', 'NaN', '4096.5'])
    assert.throws(() => configuration({ LLM_MAX_TOKENS: value }), /invalid_output_budget/);
  const cfg = { ...configuration({ LLM_MAX_TOKENS: '4096' }), mode: 'live',
    endpoint: 'https://mock.invalid/chat', model: 'mock', apiKey: 'synthetic' };
  let calls = 0, reason;
  const answer = await generate(cfg, 'Когда вступит в силу 331-ФЗ?',
    search(corpus, 'Когда вступит в силу 331-ФЗ?'), async (_, options) => {
      calls++;
      assert.equal(JSON.parse(options.body).max_tokens, 4096);
      return new Response(JSON.stringify({ choices: [{ message: { content: null, reasoning_content: 'hidden' },
        finish_reason: 'length' }] }));
    }, diagnostic => { reason = diagnostic.reason; });
  assert.equal(reason, 'truncated_answer');
  assert.equal(answer, REFUSAL);
  assert.equal(calls, 1);
});

test('actual vault regression: own card and article 7 with both commencement rules',
  { skip: process.platform !== 'win32' }, async () => {
    const { chunks } = await loadCorpus();
    const result = search(chunks, 'Когда вступит в силу 331-ФЗ?');
    assert.ok(result.length >= 2);
    assert.equal(result[0].file, `${folder}/КАРТОЧКА.md`);
    assert.ok(result.every(s => s.file.startsWith(`${folder}/`)));
    const statute = result.find(s => s.file.endsWith('/Текст_для_чтения.html') &&
      /Статья 7/.test(s.text) && /1\. Настоящий Федеральный закон вступает/.test(s.text) &&
      /2\. Статья 5 настоящего Федерального закона вступает/.test(s.text));
    assert.ok(statute, 'The actual governing provision, not merely a card or amendment reference, is required');
    const quote = statute.text.match(/1\. Настоящий Федеральный закон вступает[\s\S]*?2\. Статья 5[^\n]+/u)?.[0];
    assert.ok(quote && quote.length >= 40 && quote.length <= 500);
    const content = JSON.stringify({ claims: [{ text: 'Общий срок и исключение: см. точную цитату статьи 7.',
      sourceId: statute.sourceId, quote }] });
    assert.equal(inspectAnswer(content, result).reason, 'grounded');
    assert.notEqual(renderAnswer(content, result), REFUSAL);
});

test('actual vault regression: cross-document RРПП question selects 44-FZ, PP 719 and PP 1875',
  { skip: process.platform !== 'win32' }, async () => {
    const { chunks } = await loadCorpus();
    const result = search(chunks,
      'Как проверить товар в РРПП при закупке по 44-ФЗ с учётом ПП РФ № 719 и ПП РФ № 1875?');
    assert.ok(result.length >= 5 && result.length <= 6);
    assert.ok(result.some(source => source.file.startsWith('Законы/11_44-ФЗ_2013/')));
    assert.ok(result.some(source => source.file.startsWith('Постановления/03_ПП_719_2015/')));
    assert.ok(result.some(source => source.file.startsWith('Постановления/04_ПП_1875_2024/')));
  });

test('actual vault regression: deterministic RРПП answer covers registry, proof and 44-FZ',
  { skip: process.platform !== 'win32' }, async () => {
    const { chunks } = await loadCorpus();
    const answer = answerRrpp(chunks,
      'Как проверить товар в РРПП и использовать запись при закупке по 44-ФЗ?');
    assert.match(answer, /gisp\.gov\.ru\/pp719v2\/pub\/prod/);
    assert.match(answer, /подтверждением происхождения служит номер реестровой записи/);
    assert.match(answer, /закупки по 44-ФЗ/);
    assert.match(answer, /приложения 2 и 3 обрезаны/);
  });
