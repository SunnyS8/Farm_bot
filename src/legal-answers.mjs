import { lawIds } from './retrieval.mjs';
import { officialLinks } from './public-sources.mjs';

const normalize = text => text.normalize('NFKC').toLowerCase().replaceAll('ё', 'е')
  .replace(/[‐‑‒–—−]/g, '-').replace(/\s+/g, ' ');

export function asksForActStructure(question) {
  const q = normalize(question);
  return /(?:перечисл|назов|покаж|список|структур)[\s\S]{0,45}(?:все\s+)?стать/u.test(q)
    || /(?:все|какие|сколько)\s+стать/u.test(q);
}

function requestedYear(question) {
  return [...normalize(question).matchAll(
    /(?<!\p{L})от\s+\d{1,2}(?:[./]\d{1,2}[./]|\s+\p{L}+\s+)((?:19|20)\d{2})(?!\d)/gu)]
    .map(match => match[1]);
}

function resolveFolder(chunks, question) {
  const ids = lawIds(question);
  if (ids.length !== 1) return null;
  const years = requestedYear(question);
  const folders = [...new Set(chunks.map(chunk => chunk.file.split('/').slice(0, 2).join('/')))];
  let matches = folders.filter(folder => lawIds(folder).includes(ids[0]));
  if (years.length) matches = matches.filter(folder => years.some(year => folder.includes(year)));
  return matches.length === 1 ? matches[0] : null;
}

function amendedAct(text) {
  const flattened = text.replace(/\s+/g, ' ');
  const match = flattened.match(
    /(Закон(?:а)? Российской Федерации|Федеральн(?:ый|ого) закон(?:а)?)\s+от\s+\d{1,2}\s+\p{L}+\s+\d{4}\s+года\s+№\s*([0-9]+(?:-[\p{L}\d]+)?)\s+"([^"]{3,300})"/iu,
  );
  if (!match) return null;
  const kind = match[1].startsWith('Закон') ? 'Закон РФ' : 'Федеральный закон';
  return `${kind} № ${match[2]} «${match[3]}»`;
}

function articleBody(text) {
  const flattened = text.replace(/\s+/g, ' ');
  const marker = flattened.indexOf('Поделиться документом');
  const body = marker >= 0 ? flattened.slice(marker + 'Поделиться документом'.length) : flattened;
  const end = body.indexOf('Открыть документ');
  return end >= 0 ? body.slice(0, end) : body;
}

function articleSummary(number, text) {
  const body = articleBody(text);
  const act = amendedAct(body);
  if (act) return `изменения в ${act}`;
  if (/настоящий федеральный закон вступает в силу/iu.test(body))
    return 'сроки вступления Федерального закона в силу';
  return 'положения статьи приведены в полном тексте закона';
}

function displayTitle(text, id) {
  const match = text.match(
    /Федеральный закон от (\d{2}\.\d{2}\.\d{4}) №\s*(\d+\s*-\s*ФЗ)\s+"([^"]{3,300})"/iu,
  );
  return match
    ? `Федеральный закон от ${match[1]} № ${match[2].replace(/\s+/g, '')} «${match[3]}»`
    : `Федеральный закон № ${id.toUpperCase()}`;
}

function commencement(text) {
  const general = text.match(/настоящий федеральный закон вступает в силу с ([^,.]{5,60})/iu)?.[1];
  const exception = text.match(/статья 5 настоящего федерального закона вступает в силу с ([^,.]{5,60})/iu)?.[1];
  return general && exception
    ? `Статус по сбору: будущая норма. Статья 5 — с ${exception}; остальные положения — с ${general}.`
    : '';
}

export function answerActStructure(chunks, question) {
  if (!asksForActStructure(question)) return null;
  const folder = resolveFolder(chunks, question);
  if (!folder) return null;
  const owned = chunks.filter(chunk => chunk.file.startsWith(`${folder}/`));
  const id = lawIds(folder)[0];
  if (!id) return null;
  const files = [...new Set(owned.map(chunk => chunk.file)
    .filter(file => /\/Части\/\d+\.html?$/iu.test(file)))].sort((a, b) => a.localeCompare(b, 'ru'));
  if (!files.length || files.length > 200) return null;
  const articles = files.map(file => {
    const fileText = owned.filter(chunk => chunk.file === file).map(chunk => chunk.text).join('\n');
    const number = Number(file.match(/\/(\d+)\.html?$/iu)?.[1]);
    if (!Number.isSafeInteger(number) || number < 1) return null;
    return { number, summary: articleSummary(number, fileText) };
  }).filter(Boolean).sort((a, b) => a.number - b.number);
  if (!articles.length || new Set(articles.map(article => article.number)).size !== articles.length) return null;

  const allText = owned.map(chunk => chunk.text).join('\n');
  const title = displayTitle(allText, id);
  const links = officialLinks(allText);
  const source = links.length
    ? `Официальный источник:\n${links.join('\n')}`
    : 'Источник: локальная копия полного текста в сборе от 18.11.2026.';
  const status = folder.startsWith('Будущие нормы/') ? commencement(allText) : '';
  const articleWord = articles.length % 10 === 1 && articles.length % 100 !== 11 ? 'статья'
    : [2, 3, 4].includes(articles.length % 10) && ![12, 13, 14].includes(articles.length % 100) ? 'статьи' : 'статей';
  return `${title}\n\nВ локальной копии закона ${articles.length} ${articleWord}:\n\n${
    articles.map(article => `${article.number}. Статья ${article.number} — ${article.summary}.`).join('\n')
  }${status ? `\n\n${status}` : ''}\n\n${source}\n\nСправочно.`;
}
