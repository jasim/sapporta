/**
 * The most words a search term is split into. Every word adds a full copy of
 * the table's search predicate to the query, so a long term would otherwise
 * grow the SQL past what SQLite accepts.
 */
export const MAX_SEARCH_WORDS = 16;

/**
 * The words a table search matches: the term split on whitespace, with a
 * double-quoted phrase kept as one word. `blue "sea remembers"` is `blue`,
 * `sea remembers`. A repeated word, compared case-insensitively as the search
 * does, is kept once, and words past `MAX_SEARCH_WORDS` are dropped.
 */
export function searchWords(term: string): string[] {
  const words: string[] = [];
  const seen = new Set<string>();
  for (const match of term.matchAll(/"([^"]*)"?|(\S+)/g)) {
    const word = (match[1] ?? match[2] ?? "").trim();
    const key = word.toLowerCase();
    if (word === "" || seen.has(key)) continue;
    seen.add(key);
    words.push(word);
    if (words.length === MAX_SEARCH_WORDS) break;
  }
  return words;
}
