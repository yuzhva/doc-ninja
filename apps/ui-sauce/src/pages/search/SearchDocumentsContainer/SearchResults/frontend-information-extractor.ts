interface FilterRule {
  containsText: string[]; // Keywords to match
  labelOption: string; // "Status" or "Command Type" value to return
}

interface FilterConfig {
  id: string; // unique key
  labelFilterTitle: string; // Column header / Label
  filterRules: FilterRule[];
}

export class FrontendInformationExtractor {
  /**
   * Checks if text contains keyword, with support for partial matches (declensions)
   */
  private static textContains(
    text: string,
    words: string[],
    keyword: string,
  ): boolean {
    // 1. Exact substring match (fastest)
    if (text.includes(keyword)) return true;

    // 2. Fuzzy match for declensions (e.g. "відпустку" vs "відпустці")
    // Check if any word in text starts with a significant portion of the keyword
    // Only for keywords longer than 4 chars to avoid false positives
    if (keyword.length <= 4) return false;

    const minMatch = Math.ceil(keyword.length * 0.75); // 75% match
    const keywordPrefix = keyword.substring(0, minMatch);

    return words.some((word) => word.startsWith(keywordPrefix));
  }

  /**
   * Determines the value for a specific filter configuration based on summary text.
   */
  static determineValue(
    summary: string | null | undefined,
    config: FilterConfig,
  ): string | null {
    if (!config.filterRules || !summary) return null;

    const lowerSummary = summary.toLowerCase();
    // Split once for performance
    const summaryWords = lowerSummary.split(/[\s,.;:!?()"]+/);

    for (const rule of config.filterRules) {
      // Skip rules with empty keywords list
      if (!rule.containsText || rule.containsText.length === 0) {
        continue;
      }

      // Check if all keywords in the rule are present in the summary
      const isMatch = rule.containsText.every((text) =>
        this.textContains(lowerSummary, summaryWords, text.toLowerCase()),
      );

      if (isMatch) {
        return rule.labelOption;
      }
    }

    return null;
  }
}
