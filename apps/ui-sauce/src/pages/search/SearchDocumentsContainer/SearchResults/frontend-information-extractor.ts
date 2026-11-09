interface FilterRule {
  containsText: string[]; // Keywords to match
  labelOption: string; // "Status" or "Command Type" value to return
}

interface FilterConfig {
  id: string; // unique key
  labelFilterTitle: string; // Column header / Label
  labelFilterDescription?: string; // The filter dropdown's title
  isHighlightedInResults?: boolean; // Opt out of highlighting the matched phrases
  filterRules: FilterRule[];
}

interface FilterMatch {
  labelOption: string; // The value the matched rule resolves to
  matchedTexts: string[]; // The slices of the summary that triggered it
}

// A summary as the keyword lookups read it: lowercased and split into words.
interface PreparedSummary {
  lowerSummary: string;
  summaryWords: string[];
}

class FrontendInformationExtractor {
  /**
   * Finds the slice of text a keyword matches, with support for partial
   * matches (declensions). Returns null when the keyword isn't present.
   *
   * Returns the matched slice rather than a boolean because a declension match
   * lands on a different string than the keyword itself ("відпустці" for the
   * keyword "відпустку") — and it's the slice, not the keyword, that callers
   * need in order to point back at the text.
   */
  private static findKeywordMatch(
    text: string,
    words: string[],
    keyword: string,
  ): string | null {
    // 1. Exact substring match (fastest)
    if (text.includes(keyword)) return keyword;

    // 2. Fuzzy match for declensions (e.g. "відпустку" vs "відпустці")
    // Check if any word in text starts with a significant portion of the keyword
    // Only for keywords longer than 4 chars to avoid false positives
    if (keyword.length <= 4) return null;

    const minMatch = Math.ceil(keyword.length * 0.75); // 75% match
    const keywordPrefix = keyword.substring(0, minMatch);

    return words.find((word) => word.startsWith(keywordPrefix)) ?? null;
  }

  /**
   * Resolves each filter configuration against the summary text, keeping the
   * phrases that made the winning rule apply — one entry per config, in their
   * order, null where no rule applies.
   *
   * The summary is lowercased and split once for all of them, and both the
   * label and the matched phrases come out of the same pass, so surfacing the
   * "why" behind a filter value costs nothing extra.
   */
  static findMatches(
    summary: string | null | undefined,
    configs: FilterConfig[],
  ): (FilterMatch | null)[] {
    if (!summary) return configs.map(() => null);

    const lowerSummary = summary.toLowerCase();
    const prepared: PreparedSummary = {
      lowerSummary,
      summaryWords: lowerSummary.split(/[\s,.;:!?()"]+/),
    };

    return configs.map((config) => this.findPreparedMatch(prepared, config));
  }

  private static findPreparedMatch(
    { lowerSummary, summaryWords }: PreparedSummary,
    config: FilterConfig,
  ): FilterMatch | null {
    if (!config.filterRules) return null;

    for (const rule of config.filterRules) {
      // Skip rules with empty keywords list
      if (!rule.containsText || rule.containsText.length === 0) {
        continue;
      }

      // Check if all keywords in the rule are present in the summary.
      // `every` short-circuits, so a rule that fails half way leaves a partial
      // `matchedTexts` behind — harmless, it's dropped along with the rule.
      const matchedTexts: string[] = [];
      const isMatch = rule.containsText.every((text) => {
        const matchedText = this.findKeywordMatch(
          lowerSummary,
          summaryWords,
          text.toLowerCase(),
        );

        if (matchedText) matchedTexts.push(matchedText);

        return Boolean(matchedText);
      });

      if (isMatch) {
        return { labelOption: rule.labelOption, matchedTexts };
      }
    }

    return null;
  }
}

export { FrontendInformationExtractor };
export type { FilterConfig, FilterMatch };
