import { actIds } from './retrieval.mjs';

const API = 'https://publication.pravo.gov.ru/api/Documents';
const DOCUMENT = 'https://publication.pravo.gov.ru/document/';
const normalize = text => text.normalize('NFKC').toLowerCase().replaceAll('ё', 'е')
  .replace(/[‐‑‒–—−]/g, '-').replace(/\s+/g, ' ').trim();

const STOP = new Set(['какой', 'какая', 'какие', 'какое', 'когда', 'где', 'есть', 'ли',
  'что', 'такое', 'действует', 'действующий', 'актуальная', 'актуальный', 'редакция',
  'найди', 'проверь', 'официальный', 'источник', 'норма', 'нормы', 'сейчас', 'сегодня']);

function clean(value, max = 500) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

export function needsOfficialSearch(question, hasLocalSources) {
  const q = normalize(question);
  if (!hasLocalSources) return true;
  return /(?:актуальн\p{L}*|действует\s+ли|последн\p{L}*\s+редакц\p{L}*|официальн\p{L}*\s+(?:источник|опубликован)|проверь\s+(?:сейчас|сегодня)|жив\p{L}*\s+поиск)/u.test(q);
}

export function officialQueries(question) {
  const ids = actIds(question).slice(0, 3);
  if (ids.length) return ids.map(id => {
    const decision = id.match(/^пп-(\d+)$/u);
    const law = id.match(/^(\d+)-(фз|фкз)$/u);
    return { Number: decision ? decision[1] : `${law[1]}-${law[2].toUpperCase()}`,
      NumberSearchType: '0' };
  });
  const terms = normalize(question).match(/[\p{L}\d-]{3,}/gu) || [];
  const phrase = terms.filter(term => !STOP.has(term)).slice(0, 8).join(' ').slice(0, 140);
  return phrase.length >= 4 ? [{ Name: phrase }] : [];
}

function normalizeItem(item) {
  const eoNumber = clean(item?.eoNumber, 24);
  if (!/^\d{10,20}$/.test(eoNumber)) return null;
  const complexName = clean(item?.complexName || item?.title, 700);
  if (!complexName) return null;
  const published = clean(item?.publishDateShort || item?.viewDate, 30);
  return Object.freeze({
    eoNumber,
    complexName,
    number: clean(item?.number, 80),
    name: clean(item?.name, 500),
    published,
    url: `${DOCUMENT}${eoNumber}`,
  });
}

async function readJson(response) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error('official_upstream_status');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 512 * 1024) throw new Error('official_upstream_size');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function request(query, transport) {
  const url = new URL(API);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  url.searchParams.set('PageSize', '10');
  url.searchParams.set('Index', '1');
  url.searchParams.set('SortedBy', '4');
  url.searchParams.set('SortDestination', '2');
  if (url.origin !== 'https://publication.pravo.gov.ru' || url.pathname !== '/api/Documents')
    throw new Error('official_endpoint_denied');
  const response = await transport(url, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: { Accept: 'application/json' },
  });
  const data = await readJson(response);
  if (!Array.isArray(data?.items)) throw new Error('official_invalid_response');
  return data.items.map(normalizeItem).filter(Boolean);
}

export async function searchOfficialPublications(question, {
  transport = fetch, now = () => new Date(),
} = {}) {
  const queries = officialQueries(question);
  const checkedAt = now().toISOString();
  if (!queries.length) return Object.freeze({ status: 'ok', checkedAt, items: [] });
  try {
    const settled = await Promise.allSettled(queries.map(query => request(query, transport)));
    const fulfilled = settled.filter(result => result.status === 'fulfilled');
    if (!fulfilled.length) return Object.freeze({ status: 'unavailable', checkedAt, items: [] });
    const seen = new Set();
    const items = fulfilled.flatMap(result => result.value).filter(item => {
      if (seen.has(item.eoNumber)) return false;
      seen.add(item.eoNumber);
      return true;
    }).slice(0, 5);
    return Object.freeze({ status: 'ok', checkedAt, items: Object.freeze(items) });
  } catch {
    return Object.freeze({ status: 'unavailable', checkedAt, items: [] });
  }
}

const displayDate = value => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'дата не указана' :
    new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC' }).format(date);
};

export function renderOfficialSearch(result, { limit = 3 } = {}) {
  if (!result || result.status === 'disabled') return '';
  const checked = displayDate(result.checkedAt);
  if (result.status !== 'ok')
    return `Официальный поиск: сервис publication.pravo.gov.ru был недоступен при проверке ${checked}.`;
  if (!result.items.length)
    return `Официальный поиск на publication.pravo.gov.ru выполнен ${checked}, совпадений по запросу не найдено.\nЭто не подтверждает отсутствие нормы: поиск портала охватывает официальные публикации, а не консолидированные редакции.`;
  const rows = result.items.slice(0, limit).map((item, index) =>
    `${index + 1}. ${item.complexName}\nОпубликовано: ${displayDate(item.published)}; № опубликования ${item.eoNumber}\n${item.url}`);
  return `Проверка по официальному источнику на ${checked}:\n\n${rows.join('\n\n')}\n\nВажно: портал подтверждает реквизиты и факт официального опубликования, но сам результат поиска не подтверждает текущий статус или консолидированную редакцию акта.`;
}
