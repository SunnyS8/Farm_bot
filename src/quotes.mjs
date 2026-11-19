// Unicode White_Space only. Do NOT use String.trim(), NFKC, \s, or remove
// invisible characters: U+FEFF/U+200B/NUL are NOT normalized whitespace here.
const whitespace = char => /\p{White_Space}/u.test(char);

export function whitespaceMap(text) {
  let normalized = '';
  const starts = [], ends = [];
  for (let i = 0; i < text.length;) {
    const start = i;
    if (whitespace(text[i])) {
      do { i++; } while (i < text.length && whitespace(text[i]));
      normalized += ' ';
    } else {
      normalized += text[i++];
    }
    // Map every normalized UTF-16 code unit to the entire original span.
    starts.push(start); ends.push(i);
  }
  return { normalized, starts, ends };
}

export function normalizedQuote(text) {
  return whitespaceMap(text).normalized.replace(/^ +| +$/g, '');
}

export function findQuoteRange(source, quote) {
  const needle = normalizedQuote(quote);
  if (!needle) return null;
  const mapped = whitespaceMap(source);
  const at = mapped.normalized.indexOf(needle);
  if (at < 0) return null;
  const start = mapped.starts[at];
  const end = mapped.ends[at + needle.length - 1];
  return { start, end, text: source.slice(start, end) };
}
