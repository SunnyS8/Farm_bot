import { lawIds } from './retrieval.mjs';

const ARTICLE = /(?:статья|ст\.)\s*(\d+(?:\.\d+)*)/iu;

export function createConversationMemory({
  ttlMs = 30 * 60_000,
  maxEntries = 1000,
  clock = () => Date.now(),
} = {}) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000 || !Number.isSafeInteger(maxEntries) || maxEntries < 1)
    throw new Error('invalid_conversation_memory');
  const entries = new Map();

  function prune(now) {
    for (const [sender, entry] of entries) {
      if (now - entry.updatedAt >= ttlMs) entries.delete(sender);
    }
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  }

  function clear(sender) {
    entries.delete(String(sender));
  }

  function contextualize(sender, question) {
    const key = String(sender);
    const now = clock();
    prune(now);
    const explicitLaws = lawIds(question);
    const explicitArticle = question.match(ARTICLE)?.[1];
    if (explicitLaws.length === 1) {
      const entry = {
        lawId: explicitLaws[0],
        ...(explicitArticle ? { article: explicitArticle } : {}),
        updatedAt: now,
      };
      entries.delete(key);
      entries.set(key, entry);
      prune(now);
      return question;
    }
    // Ambiguous multi-act questions must never inherit or overwrite a previous act.
    if (explicitLaws.length > 1) return question;
    const previous = entries.get(key);
    if (!previous) return question;
    const next = {
      ...previous,
      ...(explicitArticle ? { article: explicitArticle } : {}),
      updatedAt: now,
    };
    entries.delete(key);
    entries.set(key, next);
    const label = `Федеральный закон № ${next.lawId.toUpperCase()}`;
    const article = next.article ? `; последняя обсуждавшаяся статья ${next.article}` : '';
    return `${question}\n\nКонтекст диалога: ${label}${article}.`;
  }

  function inspect(sender) {
    const now = clock();
    prune(now);
    const entry = entries.get(String(sender));
    return entry ? { lawId: entry.lawId, article: entry.article } : null;
  }

  return Object.freeze({ contextualize, clear, inspect });
}
