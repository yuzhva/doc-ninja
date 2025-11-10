import type { DocumentIntelligenceConfig } from '../types';

/**
 * Context Extractor
 * Extracts and enriches contextual information for name matches
 */
export class ContextExtractor {
  private config: DocumentIntelligenceConfig;
  private stats = {
    processedDocuments: 0,
    extractedContexts: 0,
    contextTypes: new Map<string, number>(),
  };

  constructor(config: DocumentIntelligenceConfig) {
    this.config = config;
  }

  /**
   * Process analysis result and enrich with contextual information
   */
  async execute(
    result: any,
    document: { content: string; metadata: any },
    config: any,
  ): Promise<any> {
    const { content } = document;
    const nameMatches = result.ukrainianNameMatches || [];

    if (!nameMatches.length) {
      return result;
    }

    console.log(
      `    📝 Extracting context for ${nameMatches.length} matches...`,
    );

    try {
      // Enrich each match with detailed context
      for (const match of nameMatches) {
        await this.enrichMatchWithContext(match, content);
      }

      this.stats.processedDocuments++;
      this.stats.extractedContexts += nameMatches.length;

      console.log(
        `    ✅ Context extractor enriched ${nameMatches.length} matches`,
      );

      return result;
    } catch (error) {
      console.error('Context extraction failed:', error);
      return result;
    }
  }

  /**
   * Enrich a single match with contextual information
   */
  private async enrichMatchWithContext(
    match: any,
    content: string,
  ): Promise<void> {
    const context = this.extractExtendedContext(
      content,
      match.position,
      match.declension.length,
    );

    // Extract different types of contextual information
    const positionContext = this.extractPositionContext(
      content,
      match.position,
    );
    const dateContext = this.extractDateContext(context);
    const actionContext = this.extractActionContext(context);
    const reasonContext = this.extractReasonContext(context);
    const organizationContext = this.extractOrganizationContext(context);

    // Enrich NLP context
    if (!match.nlpContext) {
      match.nlpContext = {};
    }

    // Add position context
    match.nlpContext.hasPositionContext = !!positionContext;
    if (positionContext) {
      match.nlpContext.positionContext = positionContext;
      this.trackContextType('position');
    }

    // Add date context
    match.nlpContext.hasDateContext = !!dateContext;
    if (dateContext) {
      match.nlpContext.dateContext = dateContext;
      this.trackContextType('date');
    }

    // Add action context
    match.nlpContext.hasActionContext = !!actionContext;
    if (actionContext) {
      match.nlpContext.actionContext = actionContext;
      this.trackContextType('action');
    }

    // Add reason context
    match.nlpContext.hasReasonContext = !!reasonContext;
    if (reasonContext) {
      match.nlpContext.reasonContext = reasonContext;
      this.trackContextType('reason');
    }

    // Add organization context
    if (organizationContext) {
      match.nlpContext.organizationContext = organizationContext;
      this.trackContextType('organization');
    }

    // Calculate context richness score
    match.nlpContext.contextRichness = this.calculateContextRichness({
      hasPositionContext: match.nlpContext.hasPositionContext,
      hasDateContext: match.nlpContext.hasDateContext,
      hasActionContext: match.nlpContext.hasActionContext,
      hasReasonContext: match.nlpContext.hasReasonContext,
      organizationContext: !!organizationContext,
    });

    // Update overall confidence based on context richness
    const contextBonus = match.nlpContext.contextRichness * 0.1;
    match.confidence = Math.min(1.0, match.confidence + contextBonus);
  }

  /**
   * Extract extended context around the match
   */
  private extractExtendedContext(
    content: string,
    position: number,
    matchLength: number,
  ): string {
    const contextStart = Math.max(0, position - 200);
    const contextEnd = Math.min(content.length, position + matchLength + 200);
    return content.substring(contextStart, contextEnd);
  }

  /**
   * Extract position/role context
   */
  private extractPositionContext(
    content: string,
    position: number,
  ): string | null {
    const context = this.extractExtendedContext(content, position, 0);

    const positionPatterns = [
      // Ukrainian positions/roles
      /(?:директор|керівник|начальник|завідувач|голова|заступник|секретар|спеціаліст|інженер|економіст|бухгалтер|юрисконсульт|лікар|вчитель|викладач|професор|доцент)/gi,
      // Government positions
      /(?:міністр|заступник міністра|голова|заступник голови|секретар ради|депутат|мер|заступник мера)/gi,
      // Academic positions
      /(?:ректор|проректор|декан|завідувач кафедри|професор|доцент|асистент|старший викладач)/gi,
    ];

    for (const pattern of positionPatterns) {
      const matches = context.match(pattern);
      if (matches) {
        return matches[0];
      }
    }

    return null;
  }

  /**
   * Extract date context
   */
  private extractDateContext(context: string): string | null {
    const datePatterns = [
      // DD.MM.YYYY format
      /\d{1,2}\.\d{1,2}\.\d{4}/g,
      // YYYY-MM-DD format
      /\d{4}[-/]\d{1,2}[-/]\d{1,2}/g,
      // Ukrainian month names
      /\d{1,2}\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)\s+\d{4}/gi,
      // Partial dates
      /(січень|лютий|березень|квітень|травень|червень|липень|серпень|вересень|жовтень|листопад|грудень)\s+\d{4}/gi,
    ];

    for (const pattern of datePatterns) {
      const matches = context.match(pattern);
      if (matches) {
        return matches[0];
      }
    }

    return null;
  }

  /**
   * Extract action context
   */
  private extractActionContext(context: string): string | null {
    const actionPatterns = [
      // Administrative actions
      /(?:призначити|звільнити|прийняти|направити|відправити|доручити|затвердити|підписати|виконати|вирішити)/gi,
      // Status changes
      /(?:призначено|звільнено|прийнято|направлено|відправлено|доручено|затверджено|підписано|виконано|вирішено)/gi,
      // Decision actions
      /(?:ухвалити|прийняти рішення|встановити|визначити|схвалити|відхилити|скасувати)/gi,
    ];

    for (const pattern of actionPatterns) {
      const matches = context.match(pattern);
      if (matches) {
        return matches[0];
      }
    }

    return null;
  }

  /**
   * Extract reason context
   */
  private extractReasonContext(context: string): string | null {
    const reasonPatterns = [
      // Reason indicators
      /(?:у зв'язку з|через|внаслідок|з метою|для|задля|з причини|оскільки|тому що)/gi,
      // Common reasons
      /(?:хвороба|відпустка|звільнення|переведення|призначення|реорганізація|скорочення|пенсія|навчання)/gi,
      // Legal reasons
      /(?:відповідно до|згідно з|на підставі|керуючись|у відповідності з)/gi,
    ];

    for (const pattern of reasonPatterns) {
      const matches = context.match(pattern);
      if (matches) {
        // Try to extract the full reason phrase
        const reasonMatch = context.match(
          new RegExp(`${matches[0]}[^.]*`, 'gi'),
        );
        return reasonMatch ? reasonMatch[0] : matches[0];
      }
    }

    return null;
  }

  /**
   * Extract organization context
   */
  private extractOrganizationContext(context: string): string | null {
    const orgPatterns = [
      // Government organizations
      /(?:міністерство|департамент|управління|комітет|комісія|рада|адміністрація|виконком)/gi,
      // Educational institutions
      /(?:університет|інститут|коледж|школа|ліцей|гімназія|академія)/gi,
      // Medical institutions
      /(?:лікарня|поліклініка|амбулаторія|диспансер|медичний центр)/gi,
      // Companies
      /(?:товариство з обмеженою відповідальністю|тов|акціонерне товариство|ат|приватне підприємство|пп)/gi,
    ];

    for (const pattern of orgPatterns) {
      const matches = context.match(pattern);
      if (matches) {
        return matches[0];
      }
    }

    return null;
  }

  /**
   * Calculate context richness score (0-1)
   */
  private calculateContextRichness(contextFlags: {
    hasPositionContext: boolean;
    hasDateContext: boolean;
    hasActionContext: boolean;
    hasReasonContext: boolean;
    organizationContext: boolean;
  }): number {
    let score = 0;
    let maxScore = 5;

    if (contextFlags.hasPositionContext) score += 1;
    if (contextFlags.hasDateContext) score += 1;
    if (contextFlags.hasActionContext) score += 1;
    if (contextFlags.hasReasonContext) score += 1;
    if (contextFlags.organizationContext) score += 1;

    return score / maxScore;
  }

  /**
   * Track context type usage
   */
  private trackContextType(type: string): void {
    this.stats.contextTypes.set(
      type,
      (this.stats.contextTypes.get(type) || 0) + 1,
    );
  }

  /**
   * Get extractor statistics
   */
  getStats(): any {
    return {
      processedDocuments: this.stats.processedDocuments,
      extractedContexts: this.stats.extractedContexts,
      averageContextsPerDocument:
        this.stats.processedDocuments > 0
          ? (
              this.stats.extractedContexts / this.stats.processedDocuments
            ).toFixed(2)
          : 0,
      contextTypes: Object.fromEntries(this.stats.contextTypes),
    };
  }
}
