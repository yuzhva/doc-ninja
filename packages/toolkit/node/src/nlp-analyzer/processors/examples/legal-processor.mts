import { AnalysisConfig, DocumentChunk, LoadedPipeline } from '../../types.mjs';
import { BaseProcessor } from '../base-processor.mjs';

interface LegalAnalysisResult {
  citations: Array<{
    type: 'case' | 'statute' | 'regulation';
    citation: string;
    confidence: number;
  }>;
  parties: Array<{
    name: string;
    role: 'plaintiff' | 'defendant' | 'party' | 'entity';
    confidence: number;
  }>;
  legal_concepts: Array<{
    concept: string;
    category:
      'contract' | 'tort' | 'criminal' | 'constitutional' | 'administrative';
    confidence: number;
  }>;
  key_dates: Array<{
    date: string;
    context: string;
    significance: 'filing' | 'hearing' | 'deadline' | 'incident';
  }>;
  document_type: {
    type:
      | 'contract'
      | 'motion'
      | 'brief'
      | 'opinion'
      | 'statute'
      | 'regulation'
      | 'other';
    confidence: number;
  };
  risk_assessment: {
    level: 'low' | 'medium' | 'high';
    factors: string[];
  };
}

class LegalDocumentProcessor extends BaseProcessor {
  private legalPatterns = {
    caseCitations: [
      /\b\d+\s+[A-Za-z.]+\s+\d+/g, // 123 F.3d 456
      /\b\w+\s+v\.?\s+\w+/g, // Case v. Name
    ],
    statuteCitations: [
      /\b\d+\s+U\.S\.C\.?\s+§?\s*\d+/g, // 42 U.S.C. § 1983
      /\b\w+\s+Code\s+§?\s*\d+/g, // Penal Code § 123
    ],
    dates: [
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/g,
      /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
      /\b\d{4}-\d{2}-\d{2}\b/g,
    ],
  };

  private legalTerms = {
    contract: [
      'agreement',
      'contract',
      'covenant',
      'breach',
      'consideration',
      'offer',
      'acceptance',
    ],
    tort: [
      'negligence',
      'liability',
      'damages',
      'injury',
      'duty',
      'breach of duty',
    ],
    criminal: [
      'prosecution',
      'defense',
      'guilty',
      'innocent',
      'sentence',
      'conviction',
    ],
    constitutional: [
      'amendment',
      'constitutional',
      'rights',
      'due process',
      'equal protection',
    ],
    administrative: [
      'regulation',
      'agency',
      'rulemaking',
      'compliance',
      'enforcement',
    ],
  };

  constructor(model?: LoadedPipeline, config?: any) {
    super(model, config);
  }

  async process(
    chunks: DocumentChunk[],
    config: AnalysisConfig,
  ): Promise<LegalAnalysisResult> {
    const fullText = chunks.map((chunk) => chunk.text).join(' ');

    const citations = await this.extractCitations(fullText);
    const parties = await this.extractParties(fullText, chunks);
    const legalConcepts = await this.extractLegalConcepts(fullText);
    const keyDates = await this.extractKeyDates(fullText);
    const documentType = await this.classifyDocumentType(fullText);
    const riskAssessment = await this.assessRisk(fullText, legalConcepts);

    return {
      citations,
      parties,
      legal_concepts: legalConcepts,
      key_dates: keyDates,
      document_type: documentType,
      risk_assessment: riskAssessment,
    };
  }

  private async extractCitations(text: string): Promise<
    Array<{
      type: 'case' | 'statute' | 'regulation';
      citation: string;
      confidence: number;
    }>
  > {
    const citations: Array<{
      type: 'case' | 'statute' | 'regulation';
      citation: string;
      confidence: number;
    }> = [];

    // Extract case citations
    this.legalPatterns.caseCitations.forEach((pattern) => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach((match) => {
          citations.push({
            type: 'case',
            citation: match.trim(),
            confidence: 0.85,
          });
        });
      }
    });

    // Extract statute citations
    this.legalPatterns.statuteCitations.forEach((pattern) => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach((match) => {
          citations.push({
            type: 'statute',
            citation: match.trim(),
            confidence: 0.9,
          });
        });
      }
    });

    return citations;
  }

  private async extractParties(
    text: string,
    chunks: DocumentChunk[],
  ): Promise<
    Array<{
      name: string;
      role: 'plaintiff' | 'defendant' | 'party' | 'entity';
      confidence: number;
    }>
  > {
    const parties: Array<{
      name: string;
      role: 'plaintiff' | 'defendant' | 'party' | 'entity';
      confidence: number;
    }> = [];

    // Use AI model if available
    if (this.model) {
      return this.processWithFallback(
        () => this.extractPartiesWithAI(chunks),
        () => this.extractPartiesWithRules(text),
        'AI party extraction',
      );
    }

    return this.extractPartiesWithRules(text);
  }

  private async extractPartiesWithAI(chunks: DocumentChunk[]): Promise<
    Array<{
      name: string;
      role: 'plaintiff' | 'defendant' | 'party' | 'entity';
      confidence: number;
    }>
  > {
    if (!this.model) throw new Error('No model available');

    const parties: Array<{
      name: string;
      role: 'plaintiff' | 'defendant' | 'party' | 'entity';
      confidence: number;
    }> = [];

    for (const chunk of chunks) {
      try {
        const entities = (await this.model(chunk.text)) as Array<{
          entity: string;
          word: string;
          score: number;
        }>;

        entities.forEach((entity) => {
          if (entity.entity.includes('PER') || entity.entity.includes('ORG')) {
            const role = this.determinePartyRole(chunk.text, entity.word);
            parties.push({
              name: entity.word,
              role,
              confidence: entity.score,
            });
          }
        });
      } catch (error) {
        console.warn(`AI party extraction failed:`, error);
      }
    }

    return parties;
  }

  private extractPartiesWithRules(text: string): Array<{
    name: string;
    role: 'plaintiff' | 'defendant' | 'party' | 'entity';
    confidence: number;
  }> {
    const parties: Array<{
      name: string;
      role: 'plaintiff' | 'defendant' | 'party' | 'entity';
      confidence: number;
    }> = [];

    // Pattern for "A v. B" format
    const vsPattern = /\b([A-Z][a-zA-Z\s]+)\s+v\.?\s+([A-Z][a-zA-Z\s]+)\b/g;
    let match;

    while ((match = vsPattern.exec(text)) !== null) {
      parties.push({
        name: match[1].trim(),
        role: 'plaintiff',
        confidence: 0.8,
      });
      parties.push({
        name: match[2].trim(),
        role: 'defendant',
        confidence: 0.8,
      });
    }

    // Pattern for "Plaintiff" and "Defendant" mentions
    const plaintiffPattern = /plaintiff[^.]*?([A-Z][a-zA-Z\s]+)/gi;
    const defendantPattern = /defendant[^.]*?([A-Z][a-zA-Z\s]+)/gi;

    while ((match = plaintiffPattern.exec(text)) !== null) {
      parties.push({
        name: match[1].trim(),
        role: 'plaintiff',
        confidence: 0.7,
      });
    }

    while ((match = defendantPattern.exec(text)) !== null) {
      parties.push({
        name: match[1].trim(),
        role: 'defendant',
        confidence: 0.7,
      });
    }

    return parties;
  }

  private determinePartyRole(
    context: string,
    entityName: string,
  ): 'plaintiff' | 'defendant' | 'party' | 'entity' {
    const contextLower = context.toLowerCase();
    const entityIndex = contextLower.indexOf(entityName.toLowerCase());

    if (entityIndex === -1) return 'entity';

    const surroundingText = contextLower.slice(
      Math.max(0, entityIndex - 100),
      entityIndex + entityName.length + 100,
    );

    if (surroundingText.includes('plaintiff')) return 'plaintiff';
    if (surroundingText.includes('defendant')) return 'defendant';
    if (surroundingText.includes('party')) return 'party';

    return 'entity';
  }

  private async extractLegalConcepts(text: string): Promise<
    Array<{
      concept: string;
      category:
        'contract' | 'tort' | 'criminal' | 'constitutional' | 'administrative';
      confidence: number;
    }>
  > {
    const concepts: Array<{
      concept: string;
      category:
        'contract' | 'tort' | 'criminal' | 'constitutional' | 'administrative';
      confidence: number;
    }> = [];

    Object.entries(this.legalTerms).forEach(([category, terms]) => {
      terms.forEach((term) => {
        const regex = new RegExp(`\\b${term}\\b`, 'gi');
        const matches = text.match(regex);

        if (matches) {
          concepts.push({
            concept: term,
            category: category as any,
            confidence: 0.75,
          });
        }
      });
    });

    return concepts;
  }

  private async extractKeyDates(text: string): Promise<
    Array<{
      date: string;
      context: string;
      significance: 'filing' | 'hearing' | 'deadline' | 'incident';
    }>
  > {
    const keyDates: Array<{
      date: string;
      context: string;
      significance: 'filing' | 'hearing' | 'deadline' | 'incident';
    }> = [];

    this.legalPatterns.dates.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const dateStr = match[0];
        const startIndex = match.index;
        const context = text.slice(
          Math.max(0, startIndex - 50),
          startIndex + dateStr.length + 50,
        );

        const significance = this.determineDateSignificance(context);

        keyDates.push({
          date: dateStr,
          context: context.trim(),
          significance,
        });
      }
    });

    return keyDates;
  }

  private determineDateSignificance(
    context: string,
  ): 'filing' | 'hearing' | 'deadline' | 'incident' {
    const contextLower = context.toLowerCase();

    if (contextLower.includes('filed') || contextLower.includes('filing'))
      return 'filing';
    if (contextLower.includes('hearing') || contextLower.includes('court'))
      return 'hearing';
    if (contextLower.includes('deadline') || contextLower.includes('due'))
      return 'deadline';

    return 'incident';
  }

  private async classifyDocumentType(text: string): Promise<{
    type:
      | 'contract'
      | 'motion'
      | 'brief'
      | 'opinion'
      | 'statute'
      | 'regulation'
      | 'other';
    confidence: number;
  }> {
    const textLower = text.toLowerCase();
    const documentIndicators = {
      contract: [
        'agreement',
        'hereby agree',
        'consideration',
        'terms and conditions',
      ],
      motion: ['motion', 'moves the court', 'respectfully requests'],
      brief: ['argument', 'respectfully submit', 'conclusion'],
      opinion: ['court finds', 'we hold', 'judgment'],
      statute: ['section', 'subsection', 'enacted'],
      regulation: ['regulation', 'pursuant to', 'compliance'],
    };

    let bestMatch = { type: 'other' as const, confidence: 0 };

    Object.entries(documentIndicators).forEach(([type, indicators]) => {
      const score =
        indicators.filter((indicator) => textLower.includes(indicator)).length /
        indicators.length;
      if (score > bestMatch.confidence) {
        bestMatch = { type: type as any, confidence: score };
      }
    });

    return bestMatch;
  }

  private async assessRisk(
    text: string,
    legalConcepts: Array<{
      concept: string;
      category: string;
      confidence: number;
    }>,
  ): Promise<{ level: 'low' | 'medium' | 'high'; factors: string[] }> {
    const riskFactors: string[] = [];
    let riskScore = 0;

    // Check for high-risk legal concepts
    const highRiskConcepts = [
      'liability',
      'damages',
      'breach',
      'negligence',
      'prosecution',
    ];
    const foundHighRisk = legalConcepts.filter((concept) =>
      highRiskConcepts.includes(concept.concept.toLowerCase()),
    );

    if (foundHighRisk.length > 0) {
      riskScore += 30;
      riskFactors.push(
        `High-risk legal concepts: ${foundHighRisk.map((c) => c.concept).join(', ')}`,
      );
    }

    // Check for urgency indicators
    const urgencyKeywords = [
      'emergency',
      'immediate',
      'urgent',
      'deadline',
      'sanctions',
    ];
    const hasUrgency = urgencyKeywords.some((keyword) =>
      text.toLowerCase().includes(keyword),
    );

    if (hasUrgency) {
      riskScore += 25;
      riskFactors.push('Contains urgency indicators');
    }

    // Check for monetary amounts
    const monetaryPattern = /\$[\d,]+/g;
    const amounts = text.match(monetaryPattern);
    if (amounts && amounts.length > 0) {
      const largeAmounts = amounts.filter((amount) => {
        const num = parseInt(amount.replace(/[$,]/g, ''));
        return num > 10000;
      });

      if (largeAmounts.length > 0) {
        riskScore += 20;
        riskFactors.push(
          `Significant monetary amounts: ${largeAmounts.join(', ')}`,
        );
      }
    }

    const level = riskScore >= 50 ? 'high' : riskScore >= 25 ? 'medium' : 'low';

    return { level, factors: riskFactors };
  }
}

export { LegalDocumentProcessor };

export type { LegalAnalysisResult };
