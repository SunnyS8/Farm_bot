import { readdir, lstat, realpath, readFile } from 'node:fs/promises';
import path from 'node:path';
import { VAULT_ROOT } from './config.mjs';

const ROOTS = ['Законы', 'Постановления', 'Приказы', 'ЕАЭС', 'Изменяющие акты', 'Будущие нормы', 'Архив'];
const normalize = text => text.normalize('NFKC').toLowerCase().replaceAll('ё', 'е').replace(/[‐‑‒–—−]/g, '-');
export const tokens = text => [...new Set(normalize(text)
  .match(/[\p{L}\d]+(?:-[\p{L}\d]+)?/gu) || [])].filter(t => t.length >= 3 &&
    !['что', 'как', 'для', 'или', 'это', 'при', 'его', 'она', 'мне', 'есть', 'какие', 'нужно',
      'когда', 'вступит', 'вступает', 'вступления', 'вступление', 'силу', 'срок', 'сроки'].includes(t));

// Exact number AND act type: 331-ФЗ is not 1331-ФЗ, 331-ФКЗ, or an incidental amendment.
export function lawIds(text) {
  return [...new Set([...normalize(text).matchAll(/(?<![\p{L}\d])(\d{1,6})\s*-\s*(фкз|фз)(?![\p{L}\d])/gu)]
    .map(match => `${match[1]}-${match[2]}`))];
}

export function governmentDecisionIds(text) {
  const normalized = normalize(text);
  const compact = [...normalized.matchAll(
    /(?<![\p{L}\d])пп(?:\s+рф)?(?:\s*(?:№|no\.?))?[\s_-]*(\d{1,6})(?![\p{L}\d])/gu,
  )].map(match => `пп-${match[1]}`);
  const chained = [...normalized.matchAll(
    /(?<![\p{L}\d])пп(?:\s+рф)?\s*(?:№|no\.?)?\s*\d{1,6}\s+(?:и|,)\s*(?:№|no\.?)\s*(\d{1,6})(?!\d)/gu,
  )].map(match => `пп-${match[1]}`);
  const full = [...normalized.matchAll(
    /постановлен\p{L}*\s+правительств\p{L}*(?:\s+российской\s+федерации|\s+рф)?[\s\S]{0,80}?(?:№|no\.?)\s*(\d{1,6})(?!\d)/gu,
  )].map(match => `пп-${match[1]}`);
  return [...new Set([...compact, ...chained, ...full])];
}

export function actIds(text) {
  return [...new Set([...lawIds(text), ...governmentDecisionIds(text)])];
}

function folderActIds(folder) {
  const normalized = normalize(folder);
  const decisions = [...normalized.matchAll(/(?:^|[/_])пп[_-]*(\d{1,6})(?=[/_]|$)/gu)]
    .map(match => `пп-${match[1]}`);
  return [...new Set([...lawIds(folder), ...decisions])];
}

function timingScore(text) {
  const t = normalize(text).replace(/\s+/g, ' ');
  let score = 0;
  if (/вступ\p{L}*\s+в\s+силу/u.test(t)) score += 20;
  if (/настоящий федеральный (?:конституционный )?закон вступает в силу/u.test(t)) score += 120;
  if (/за исключением/u.test(t) && score) score += 30;
  if (/статус:/.test(t) && /вступ/u.test(t)) score += 15;
  return score;
}

function topicScore(question, text) {
  const q = normalize(question);
  const t = normalize(text).replace(/\s+/g, ' ');
  let score = 0;
  if (q.includes('ррпп') || q.includes('реестр российской промышленной продукции')) {
    if (t.includes('реестр российской промышленной продукции')) score += 300;
    if (t.includes('реестровой записи')) score += 160;
    if (/включен\p{L}*\s+в\s+реестр российской промышленной продукции/u.test(t)) score += 100;
    if (t.includes('реестр независимых гарантий')) score -= 300;
  }
  return score;
}

export function textOf(raw, extension) {
  if (extension === '.md') return raw;
  // No HTML execution, remote resources, or script/style contents.
  return raw.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(?:\/p|\/div|br|\/tr|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|lt|gt|quot);/g, x =>
      ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' })[x])
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => {
      const v = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
      return v > 0 && v <= 0x10ffff ? String.fromCodePoint(v) : '';
    }).replace(/[ \t]+/g, ' ');
}

export function chunksOf(text, file) {
  const lines = text.replace(/\r/g, '').split('\n');
  const chunks = [];
  let buffer = '', first = 1;
  for (let i = 0; i < lines.length; i++) {
    // Split even single-line HTML exports; bounded fragments, no full document sent.
    const pieces = lines[i].match(/[\s\S]{1,1600}/g) || [''];
    for (const piece of pieces) {
      if (buffer.length + piece.length > 1800 && buffer.trim()) {
        chunks.push({ file, start: first, end: i + 1, text: buffer.trim() });
        buffer = ''; first = i + 1;
      }
      buffer += piece + '\n';
    }
  }
  if (buffer.trim()) chunks.push({ file, start: first, end: lines.length, text: buffer.trim() });
  return chunks;
}

export function within(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export async function loadCorpus() {
  const root = await realpath(VAULT_ROOT);
  // Refuse a substituted vault root, symlinks/junctions, including ancestor redirects.
  if (path.resolve(root).toLowerCase() !== path.resolve(VAULT_ROOT).toLowerCase())
    throw new Error('vault_redirect');
  const chunks = [];
  let bytes = 0, files = 0;
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) continue;
      const canonical = await realpath(full);
      if (!within(root, canonical)) throw new Error('vault_escape');
      if (stat.isDirectory()) { await walk(full); continue; }
      const ext = path.extname(entry.name).toLowerCase();
      if (!stat.isFile() || !['.md', '.html', '.htm'].includes(ext)) continue;
      if (stat.size > 12 * 1024 * 1024) continue;
      bytes += stat.size; files++;
      if (bytes > 128 * 1024 * 1024 || files > 5000) throw new Error('corpus_limit');
      const raw = await readFile(canonical, 'utf8');
      const file = path.relative(root, canonical).split(path.sep).join('/');
      chunks.push(...chunksOf(textOf(raw, ext), file));
      if (chunks.length > 150000) throw new Error('corpus_limit');
    }
  }
  for (const folder of ROOTS) {
    const full = path.join(root, folder);
    const stat = await lstat(full);
    if (stat.isSymbolicLink() || !stat.isDirectory() || !within(root, await realpath(full)))
      throw new Error('vault_redirect');
    await walk(full);
  }
  return { chunks, files };
}

export function search(chunks, question) {
  const ids = actIds(question);
  if (ids.length) return searchActs(chunks, question, ids);
  const terms = tokens(question).slice(0, 24);
  if (!terms.length) return [];
  const minimum = terms.length >= 3 ? 2 : terms.length;
  const candidates = chunks.map(chunk => {
    const haystack = `${chunk.file}\n${chunk.text}`.toLowerCase().replaceAll('ё', 'е');
    const hits = terms.filter(t => haystack.includes(t)).length;
    return { ...chunk, hits };
  }).filter(c => c.hits >= minimum && c.text.length >= 60)
    .sort((a, b) => b.hits - a.hits);
  const selected = [], seen = new Set();
  for (const c of candidates) {
    if (seen.has(c.text)) continue;
    seen.add(c.text); selected.push({ ...c, sourceId: `S${selected.length + 1}` });
    if (selected.length === 4) break;
  }
  return selected;
}

function searchActs(chunks, question, ids) {
  if (ids.length > 3) return []; // Keep cross-document context bounded.
  // Only an explicit date of the act disambiguates its year. A question such as
  // "вступит ли ... в 2027 году" must not mistake the commencement year for publication year.
  const years = [...normalize(question).matchAll(
    /(?<!\p{L})от\s+\d{1,2}(?:[./]\d{1,2}[./]|\s+\p{L}+\s+)((?:19|20)\d{2})(?!\d)/gu)]
    .map(m => m[1]);
  const folders = [...new Set(chunks.map(c => c.file.split('/').slice(0, 2).join('/')))];
  const selectedFolders = [];
  for (const act of ids) {
    let matches = folders.filter(folder => folderActIds(folder).includes(act));
    if (years.length) matches = matches.filter(folder => years.some(year => folder.includes(year)));
    // Never silently pick between same-number acts from different years or cross-references.
    if (matches.length !== 1) return [];
    selectedFolders.push(matches[0]);
  }
  const timing = /вступ\p{L}*[\s\S]{0,25}силу|когда[\s\S]{0,25}действ|срок/iu.test(question);
  const actNumbers = ids.map(id => id.split('-').at(-1));
  const terms = tokens(question).filter(term => !ids.includes(term) &&
    !actNumbers.includes(term) && !years.includes(term)).slice(0, 24);
  const selected = [], seen = new Set();
  const limit = ids.length === 3 ? 6 : 4;
  function add(chunk) {
    if (!chunk || seen.has(chunk.text) || selected.length >= limit) return;
    seen.add(chunk.text); selected.push({ ...chunk, sourceId: `S${selected.length + 1}` });
  }
  for (const folder of selectedFolders) {
    const owned = chunks.filter(c => c.file.startsWith(`${folder}/`) && c.text.length >= 60);
    const score = c => {
      const text = normalize(c.text);
      return terms.filter(term => text.includes(term)).length * 10 +
        (timing ? timingScore(c.text) : 0) + topicScore(question, c.text);
    };
    const rank = list => list.map(c => ({ ...c, hits: score(c) }))
      .sort((a, b) => b.hits - a.hits || a.start - b.start);
    // Keep the status/edition/coverage warning in the context, then the actual provision.
    const cards = rank(owned.filter(c => /\/КАРТОЧКА\.md$/iu.test(c.file)));
    const full = rank(owned.filter(c => /\/Текст_для_чтения\.html?$/iu.test(c.file) ||
      /\/Части\/[^/]+\.html?$/iu.test(c.file) || /\/Источник_карточка\.html?$/iu.test(c.file)));
    add(cards[0]);
    if (ids.length === 1 || full[0]?.hits > 0) add(full[0]);
    if (ids.length === 1) {
      // Do not fill remaining context with nav/news or unrelated articles.
      if (full[1]?.hits > 0) add(full[1]);
      const reference = rank(owned.filter(c => /\/Источник_карточка\.html?$/iu.test(c.file) &&
        (!timing || timingScore(c.text) > 0)));
      if (reference[0]?.hits > 0) add(reference[0]);
    }
  }
  return selected;
}

export function sourceLink(source) {
  // Link is generated from a scanned local file, never from LLM or request input.
  const vault = path.win32.basename(VAULT_ROOT);
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(source.file)}`;
}
