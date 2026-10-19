import { describe, expect, it } from "vitest";
import { MAX_SEARCH_WORDS, searchWords } from "./search-words.js";

describe("searchWords", () => {
  it("splits on whitespace and keeps quoted phrases whole", () => {
    expect(searchWords('blue  "sea remembers" 2,500')).toEqual([
      "blue",
      "sea remembers",
      "2,500",
    ]);
    expect(searchWords('"unclosed phrase')).toEqual(["unclosed phrase"]);
    expect(searchWords(' "" ')).toEqual([]);
  });

  it("keeps a repeated word once, ignoring case", () => {
    expect(searchWords('Blue blue "BLUE" moon')).toEqual(["Blue", "moon"]);
  });

  it(`keeps at most ${MAX_SEARCH_WORDS} words`, () => {
    const term = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    const words = searchWords(term);
    expect(words).toHaveLength(MAX_SEARCH_WORDS);
    expect(words[0]).toBe("w0");
  });
});
