import type {
  DocumentIntelligenceConfig,
  NameMatch,
  SearchMatch,
} from '../types';

/**
 * Ukrainian Name Processor
 * Specialized processor for handling Ukrainian name declensions and patterns
 */
export class UkrainianNameProcessor {
  private config: DocumentIntelligenceConfig;
  private stats = {
    processedDocuments: 0,
    foundMatches: 0,
    declensionPatterns: new Map<string, number>(),
  };

  constructor(config: DocumentIntelligenceConfig) {
    this.config = config;
  }

  /**
   * Process analysis result and add Ukrainian name matches
   */
  async execute(
    result: any,
    document: { content: string; metadata: any },
    config: any,
  ): Promise<any> {
    const { content, metadata } = document;
    const targetNames = config.targetNames || [];
    const searchMatches = config.searchMatches || [];

    if (!targetNames.length) {
      return result;
    }

    console.log(
      `    🇺🇦 Processing Ukrainian names for ${targetNames.length} targets...`,
    );

    try {
      // Find Ukrainian name matches using declension patterns
      const nameMatches = await this.findUkrainianNameMatches(
        content,
        targetNames,
        searchMatches,
        result,
      );

      // Add matches to result
      result.ukrainianNameMatches = nameMatches;

      this.stats.processedDocuments++;
      this.stats.foundMatches += nameMatches.length;

      console.log(
        `    ✅ Ukrainian processor found ${nameMatches.length} matches`,
      );

      return result;
    } catch (error) {
      console.error('Ukrainian name processing failed:', error);
      return result;
    }
  }

  /**
   * Find Ukrainian name matches using declension patterns
   */
  private async findUkrainianNameMatches(
    content: string,
    targetNames: string[],
    searchMatches: SearchMatch[],
    analysisResult: any,
  ): Promise<NameMatch[]> {
    const matches: NameMatch[] = [];
    const entities = analysisResult.tasks?.entities?.entities || [];
    const sentiment = analysisResult.tasks?.sentiment?.overall;

    // Method 1: Entity-based matching (most accurate)
    for (const targetName of targetNames) {
      const entityMatches = this.findEntityMatches(
        targetName,
        entities,
        content,
        sentiment,
      );
      matches.push(...entityMatches);
    }

    // Method 2: Pattern-based matching for missed names
    for (const targetName of targetNames) {
      if (matches.some((m) => m.name === targetName)) {
        continue; // Already found via entities
      }

      const patternMatches = this.findPatternMatches(
        targetName,
        content,
        sentiment,
      );
      matches.push(...patternMatches);
    }

    // Method 3: Enhanced search-based matching
    for (const searchMatch of searchMatches) {
      if (matches.some((m) => m.name === searchMatch.name)) {
        continue; // Already found
      }

      const enhancedMatches = this.enhanceSearchMatches(
        searchMatch,
        content,
        sentiment,
      );
      matches.push(...enhancedMatches);
    }

    return matches;
  }

  /**
   * Find matches using NLP entities
   */
  private findEntityMatches(
    targetName: string,
    entities: any[],
    content: string,
    sentiment: any,
  ): NameMatch[] {
    const matches: NameMatch[] = [];

    for (const entity of entities) {
      if (
        entity.label === 'PERSON' &&
        entity.confidence > this.config.confidence!.entityThreshold
      ) {
        const similarity = this.calculateNameSimilarity(
          entity.text,
          targetName,
        );

        if (similarity > this.config.confidence!.nameMatchThreshold) {
          matches.push({
            name: targetName,
            declension: entity.text,
            position: entity.start,
            confidence: Math.min(similarity, entity.confidence),
            processingMethod: 'intelligent',
            nlpContext: {
              sentimentScore: sentiment?.score,
              entityContext: this.extractEntityContext(
                content,
                entity.start,
                entity.end,
              ),
              confidence: entity.confidence,
              hasDateContext: this.hasDateContext(
                content,
                entity.start,
                entity.end,
              ),
              hasActionContext: this.hasActionContext(
                content,
                entity.start,
                entity.end,
              ),
            },
          });

          // Track declension patterns
          const pattern = this.identifyDeclensionPattern(
            targetName,
            entity.text,
          );
          this.stats.declensionPatterns.set(
            pattern,
            (this.stats.declensionPatterns.get(pattern) || 0) + 1,
          );
        }
      }
    }

    return matches;
  }

  /**
   * Find matches using Ukrainian declension patterns
   */
  private findPatternMatches(
    targetName: string,
    content: string,
    sentiment: any,
  ): NameMatch[] {
    const matches: NameMatch[] = [];
    const [surname, firstName, patronymic] = targetName.split(' ');

    if (!surname || !firstName) return matches;

    // Ukrainian declension patterns
    const patterns = this.generateDeclensionPatterns(
      surname,
      firstName,
      patronymic,
    );

    for (const pattern of patterns) {
      const regex = new RegExp(pattern.regex, 'gi');
      let match;

      while ((match = regex.exec(content)) !== null) {
        const matchText = match[0];
        const similarity = this.calculateNameSimilarity(matchText, targetName);

        if (similarity > this.config.confidence!.nameMatchThreshold) {
          matches.push({
            name: targetName,
            declension: matchText,
            position: match.index,
            confidence: similarity * pattern.confidence,
            processingMethod: 'intelligent',
            nlpContext: {
              sentimentScore: sentiment?.score,
              entityContext: this.extractEntityContext(
                content,
                match.index,
                match.index + matchText.length,
              ),
              hasDateContext: this.hasDateContext(
                content,
                match.index,
                match.index + matchText.length,
              ),
              hasActionContext: this.hasActionContext(
                content,
                match.index,
                match.index + matchText.length,
              ),
            },
          });

          // Track pattern success
          this.stats.declensionPatterns.set(
            pattern.type,
            (this.stats.declensionPatterns.get(pattern.type) || 0) + 1,
          );
        }
      }
    }

    return matches;
  }

  /**
   * Enhance search matches with NLP context
   */
  private enhanceSearchMatches(
    searchMatch: SearchMatch,
    content: string,
    sentiment: any,
  ): NameMatch[] {
    const matches: NameMatch[] = [];

    for (const position of searchMatch.positions) {
      // Find the actual match text at this position
      const matchText = this.findMatchTextAtPosition(
        content,
        searchMatch.name,
        position,
      );

      if (matchText) {
        const similarity = this.calculateNameSimilarity(
          matchText,
          searchMatch.name,
        );

        if (similarity > this.config.confidence!.nameMatchThreshold) {
          matches.push({
            name: searchMatch.name,
            declension: matchText,
            position,
            confidence: similarity * searchMatch.confidence,
            processingMethod: 'search',
            nlpContext: {
              sentimentScore: sentiment?.score,
              entityContext: this.extractEntityContext(
                content,
                position,
                position + matchText.length,
              ),
              hasDateContext: this.hasDateContext(
                content,
                position,
                position + matchText.length,
              ),
              hasActionContext: this.hasActionContext(
                content,
                position,
                position + matchText.length,
              ),
            },
          });
        }
      }
    }

    return matches;
  }

  /**
   * Generate Ukrainian declension patterns
   */
  private generateDeclensionPatterns(
    surname: string,
    firstName: string,
    patronymic?: string,
  ): Array<{ regex: string; confidence: number; type: string }> {
    const patterns = [];

    // Genitive case (найчастіший відмінок у документах)
    patterns.push({
      regex: `${surname.slice(0, -1)}[аи]\\s+${firstName.slice(0, -1)}[аи]${patronymic ? `\\s+${patronymic.slice(0, -1)}[іч]` : ''}`,
      confidence: 0.95,
      type: 'genitive_full',
    });

    // Dative case
    patterns.push({
      regex: `${surname.slice(0, -1)}[уюові]\\s+${firstName.slice(0, -1)}[уюові]${patronymic ? `\\s+${patronymic.slice(0, -1)}[уюові]` : ''}`,
      confidence: 0.9,
      type: 'dative_full',
    });

    // Accusative case
    patterns.push({
      regex: `${surname.slice(0, -1)}[аи]\\s+${firstName.slice(0, -1)}[аи]${patronymic ? `\\s+${patronymic.slice(0, -1)}[аи]` : ''}`,
      confidence: 0.85,
      type: 'accusative_full',
    });

    // Instrumental case
    patterns.push({
      regex: `${surname.slice(0, -1)}[оюимьме]\\s+${firstName.slice(0, -1)}[оюимьме]${patronymic ? `\\s+${patronymic.slice(0, -1)}[оюимьме]` : ''}`,
      confidence: 0.8,
      type: 'instrumental_full',
    });

    // Two-part patterns (surname + first name)
    patterns.push({
      regex: `${surname.slice(0, -1)}[аи]\\s+${firstName.slice(0, -1)}[аи]`,
      confidence: 0.85,
      type: 'genitive_two_part',
    });

    // Exact match (nominative case)
    patterns.push({
      regex: targetName.replace(/\s+/g, '\\s+'),
      confidence: 1.0,
      type: 'exact_match',
    });

    return patterns;
  }

  /**
   * Calculate name similarity using Ukrainian-specific logic
   */
  private calculateNameSimilarity(found: string, target: string): number {
    const foundParts = found.toLowerCase().split(/\s+/);
    const targetParts = target.toLowerCase().split(/\s+/);

    let matchingParts = 0;
    let totalComparisons = 0;

    for (const targetPart of targetParts) {
      for (const foundPart of foundParts) {
        totalComparisons++;
        const similarity = this.stringSimilarity(targetPart, foundPart);
        if (similarity > 0.8) {
          matchingParts++;
        }
      }
    }

    const baseSimilarity =
      totalComparisons > 0
        ? matchingParts / Math.max(targetParts.length, foundParts.length)
        : 0;

    // Boost for similar length
    const lengthBoost =
      Math.abs(foundParts.length - targetParts.length) === 0 ? 0.1 : 0;

    // Boost for Ukrainian declension patterns
    const declensionBoost = this.hasDeclensionPattern(found, target) ? 0.15 : 0;

    return Math.min(1.0, baseSimilarity + lengthBoost + declensionBoost);
  }

  /**
   * Check if text has Ukrainian declension pattern
   */
  private hasDeclensionPattern(found: string, target: string): boolean {
    const foundParts = found.toLowerCase().split(/\s+/);
    const targetParts = target.toLowerCase().split(/\s+/);

    if (foundParts.length !== targetParts.length) return false;

    // Check for common Ukrainian endings
    const ukrainianEndings = ['а', 'и', 'у', 'ю', 'ові', 'ем', 'ом', 'ою'];

    for (let i = 0; i < foundParts.length; i++) {
      const foundPart = foundParts[i];
      const targetPart = targetParts[i];

      // Check if found part is a declension of target part
      const foundRoot = foundPart.slice(0, -1);
      const targetRoot = targetPart.slice(0, -1);

      if (
        foundRoot === targetRoot &&
        ukrainianEndings.some((ending) => foundPart.endsWith(ending))
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate string similarity using Levenshtein distance
   */
  private stringSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1)
      .fill(null)
      .map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator,
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Extract entity context around position
   */
  private extractEntityContext(
    content: string,
    start: number,
    end: number,
  ): string {
    const contextStart = Math.max(0, start - 100);
    const contextEnd = Math.min(content.length, end + 100);
    return content
      .substring(contextStart, contextEnd)
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Check if context has date information
   */
  private hasDateContext(content: string, start: number, end: number): boolean {
    const context = this.extractEntityContext(content, start, end);
    const datePatterns = [
      /\d{1,2}\.\d{1,2}\.\d{4}/g,
      /\d{4}[-/]\d{1,2}[-/]\d{1,2}/g,
      /(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)/gi,
    ];

    return datePatterns.some((pattern) => pattern.test(context));
  }

  /**
   * Check if context has action information
   */
  private hasActionContext(
    content: string,
    start: number,
    end: number,
  ): boolean {
    const context = this.extractEntityContext(content, start, end);
    const actionWords = [
      'призначено',
      'звільнено',
      'прийнято',
      'відправлено',
      'направлено',
      'затверджено',
      'підписано',
      'виконано',
      'доручено',
      'вирішено',
    ];

    return actionWords.some((word) => context.toLowerCase().includes(word));
  }

  /**
   * Find match text at specific position
   */
  private findMatchTextAtPosition(
    content: string,
    targetName: string,
    position: number,
  ): string | null {
    // Look for name-like patterns around the position
    const windowStart = Math.max(0, position - 20);
    const windowEnd = Math.min(
      content.length,
      position + targetName.length + 20,
    );
    const window = content.substring(windowStart, windowEnd);

    // Find name patterns in the window
    const namePattern = /[А-ЯЇІЄҐ][а-яїієґ']+(?:\s+[А-ЯЇІЄҐ][а-яїієґ']+)*/g;
    let match;

    while ((match = namePattern.exec(window)) !== null) {
      const actualPosition = windowStart + match.index;

      // Check if this match is close to the expected position
      if (Math.abs(actualPosition - position) <= 10) {
        return match[0];
      }
    }

    return null;
  }

  /**
   * Identify declension pattern type
   */
  private identifyDeclensionPattern(
    originalName: string,
    foundName: string,
  ): string {
    const originalParts = originalName.toLowerCase().split(' ');
    const foundParts = foundName.toLowerCase().split(' ');

    if (originalName.toLowerCase() === foundName.toLowerCase()) {
      return 'exact_match';
    }

    if (foundParts.some((part) => part.endsWith('а') || part.endsWith('и'))) {
      return 'genitive_case';
    }

    if (foundParts.some((part) => part.endsWith('у') || part.endsWith('ю'))) {
      return 'dative_case';
    }

    if (foundParts.some((part) => part.endsWith('ом') || part.endsWith('ою'))) {
      return 'instrumental_case';
    }

    return 'unknown_pattern';
  }

  /**
   * Get processor statistics
   */
  getStats(): any {
    const totalPatterns = Array.from(
      this.stats.declensionPatterns.values(),
    ).reduce((sum, count) => sum + count, 0);

    return {
      processedDocuments: this.stats.processedDocuments,
      foundMatches: this.stats.foundMatches,
      averageMatchesPerDocument:
        this.stats.processedDocuments > 0
          ? (this.stats.foundMatches / this.stats.processedDocuments).toFixed(2)
          : 0,
      declensionPatterns: Object.fromEntries(this.stats.declensionPatterns),
      totalPatternMatches: totalPatterns,
    };
  }
}
