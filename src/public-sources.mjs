import { lawIds } from './retrieval.mjs';

export function containsLocalReference(text, sources) {
  if (/(?:[a-z]:[\\/]|\\\\|obsidian:|file:|\/(?:Users|home|tmp)\/|(?:Законы|Постановления|Приказы|ЕАЭС|Будущие нормы|Изменяющие акты|Архив)[\\/])/iu.test(text))
    return true;
  return sources.some(s => text.includes(s.file) || text.includes(s.file.replaceAll('/', '\\')) ||
    text.includes(s.file.split('/').at(-1)));
}

export function officialLinks(text) {
  const allowed = new Set(['publication.pravo.gov.ru', 'pravo.gov.ru', 'government.ru',
    'docs.eaeunion.org', 'eec.eaeunion.org']);
  const result = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"\[\]]+/gu)) {
    try {
      const url = new URL(match[0].replace(/[),.;]+$/g, ''));
      if (!allowed.has(url.hostname) || url.username || url.password || url.port || url.hash ||
          url.href.length > 500) continue;
      if (!result.includes(url.href)) result.push(url.href);
      if (result.length === 2) break;
    } catch { /* Only syntactically valid, exact-host official references. Never fetch them. */ }
  }
  return result;
}

export function publicSource(source, sources) {
  const folder = source.file.split('/').slice(0, 2).join('/');
  const related = sources.filter(s => s.file.split('/').slice(0, 2).join('/') === folder);
  const acts = lawIds(folder);
  const heading = related.map(s => s.text.match(/^(?:#\s+)?((?:Федеральный|Постановление|Приказ|Решение|Распоряжение|Закон)[^\n]{5,300})/u)?.[1])
    .find(text => text && !containsLocalReference(text, sources) && !/https?:|[<>\[\]]/iu.test(text));
  const title = acts.length === 1 ? `Федеральный ${acts[0].endsWith('-фкз') ? 'конституционный ' : ''}закон № ${acts[0].toUpperCase()}` :
    heading || `Нормативный документ (${source.sourceId})`;
  const article = source.text.match(/Статья\s+\d+(?:\.\d+)*/u)?.[0];
  const links = officialLinks(related.map(s => s.text).join('\n'));
  return `Источник: ${title}${article ? `, ${article}` : ''}\n${links.join('\n')}`.trim();
}
