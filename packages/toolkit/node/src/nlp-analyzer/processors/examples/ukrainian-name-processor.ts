import {
  AnalysisConfig,
  AnalysisResult,
  PostProcessor,
  TextMetadata,
} from '../../types';

interface UkrainianNameMatch {
  originalName: string;
  declension: string;
  confidence: number;
  position: number;
  context: string;
  sectionTitle?: string;
  actionDate?: string;
  reason?: string;
}

interface UkrainianAnalysisResult {
  matches: UkrainianNameMatch[];
  totalMatches: number;
  documentInfo: {
    documentDate?: string;
    documentType?: string;
    sections: string[];
  };
}

/**
 * Post-processor for Ukrainian name matching and contextual information extraction
 */
const UkrainianNameProcessor: PostProcessor = async (
  result: AnalysisResult,
  document: { content: string; metadata: TextMetadata },
  config: AnalysisConfig,
): Promise<AnalysisResult> => {
  // Example Ukrainian names to search for (would be configurable in real use)
  const targetNames = config.targetNames || [];

  if (targetNames.length === 0) {
    // No names to search for, return original result
    return result;
  }

  const ukrainianMatches = findUkrainianNames(document.content, targetNames);

  // Add Ukrainian analysis to the result
  const enhancedResult = {
    ...result,
    tasks: {
      ...result.tasks,
      'ukrainian-names': ukrainianMatches,
    },
  };

  return enhancedResult;
};

/**
 * Enhanced context extractor post-processor
 */
const ContextEnricher: PostProcessor = (
  result: AnalysisResult,
  document: { content: string; metadata: TextMetadata },
  config: AnalysisConfig,
): AnalysisResult => {
  // Extract document metadata
  const documentInfo = extractDocumentInfo(document.content);

  // Enhance existing results with context
  const enhancedTasks = { ...result.tasks };

  // Add context to Ukrainian names if present
  if (enhancedTasks['ukrainian-names']) {
    enhancedTasks['ukrainian-names'] = {
      ...enhancedTasks['ukrainian-names'],
      documentInfo,
    };
  }

  // Add general context information
  enhancedTasks['document-context'] = {
    documentDate: documentInfo.documentDate,
    documentType: documentInfo.documentType,
    sections: documentInfo.sections,
    wordCount: document.content.split(/\s+/).length,
    extractedAt: new Date().toISOString(),
  };

  return {
    ...result,
    tasks: enhancedTasks,
  };
};

/**
 * Information extractor post-processor
 */
const InformationExtractor: PostProcessor = (
  result: AnalysisResult,
  document: { content: string; metadata: TextMetadata },
  config: AnalysisConfig,
): AnalysisResult => {
  const extractedInfo = {
    keyDates: extractDates(document.content),
    importantSections: extractImportantSections(document.content),
    actionItems: extractActionItems(document.content),
    financialAmounts: extractFinancialAmounts(document.content),
  };

  return {
    ...result,
    tasks: {
      ...result.tasks,
      'extracted-info': extractedInfo,
    },
  };
};

// Helper functions (simplified versions of your existing logic)
function findUkrainianNames(
  content: string,
  targetNames: string[],
): UkrainianAnalysisResult {
  const matches: UkrainianNameMatch[] = [];

  targetNames.forEach((name) => {
    // Simple name matching (would use your adaptive matcher in real implementation)
    const nameVariations = generateNameVariations(name);

    nameVariations.forEach((variation) => {
      const regex = new RegExp(`\\b${variation}\\b`, 'gi');
      let match;

      while ((match = regex.exec(content)) !== null) {
        matches.push({
          originalName: name,
          declension: variation,
          confidence: calculateSimilarity(name, variation),
          position: match.index,
          context: extractContext(content, match.index, 200),
        });
      }
    });
  });

  return {
    matches,
    totalMatches: matches.length,
    documentInfo: extractDocumentInfo(content),
  };
}

function generateNameVariations(name: string): string[] {
  // Simplified - would use your Ukrainian declension logic
  const variations = [name];

  // Add some common Ukrainian declensions
  const lastChar = name.slice(-1).toLowerCase();
  if (lastChar === 'а' || lastChar === 'я') {
    variations.push(name.slice(0, -1) + 'и'); // Genitive
    variations.push(name.slice(0, -1) + 'у'); // Dative
  }

  return variations;
}

function calculateSimilarity(original: string, variation: string): number {
  // Simplified similarity calculation
  if (original === variation) return 1.0;

  const distance = levenshteinDistance(
    original.toLowerCase(),
    variation.toLowerCase(),
  );
  const maxLen = Math.max(original.length, variation.length);
  return 1 - distance / maxLen;
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

function extractContext(
  text: string,
  position: number,
  contextLength: number,
): string {
  const start = Math.max(0, position - contextLength / 2);
  const end = Math.min(text.length, position + contextLength / 2);
  return text.slice(start, end).trim();
}

function extractDocumentInfo(content: string): {
  documentDate?: string;
  documentType?: string;
  sections: string[];
} {
  return {
    documentDate: extractDocumentDate(content),
    documentType: determineDocumentType(content),
    sections: extractSections(content),
  };
}

function extractDocumentDate(content: string): string | undefined {
  // Simple date extraction
  const datePattern = /(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/;
  const match = content.match(datePattern);
  return match ? match[0] : undefined;
}

function determineDocumentType(content: string): string {
  const contentLower = content.toLowerCase();

  if (
    contentLower.includes('наказ') ||
    contentLower.includes('розпорядження')
  ) {
    return 'order';
  } else if (contentLower.includes('рішення')) {
    return 'decision';
  } else if (contentLower.includes('протокол')) {
    return 'protocol';
  }

  return 'document';
}

function extractSections(content: string): string[] {
  // Simple section extraction based on numbered items or capitalized text
  const sections = content.match(/^\d+\.\s*[А-ЯІЇЄ][^.]*$/gm) || [];
  return sections.slice(0, 10); // Limit to first 10 sections
}

function extractDates(content: string): string[] {
  const datePattern = /\b\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}\b/g;
  return content.match(datePattern) || [];
}

function extractImportantSections(content: string): string[] {
  // Extract sections that might contain important information
  const importantKeywords = [
    'призначити',
    'звільнити',
    'затвердити',
    'встановити',
  ];
  const sections: string[] = [];

  importantKeywords.forEach((keyword) => {
    const regex = new RegExp(`[^.]*${keyword}[^.]*\\.`, 'gi');
    const matches = content.match(regex);
    if (matches) {
      sections.push(...matches);
    }
  });

  return sections.slice(0, 5); // Limit results
}

function extractActionItems(content: string): string[] {
  // Extract sentences that contain action verbs
  const actionVerbs = [
    'призначити',
    'звільнити',
    'затвердити',
    'виконати',
    'надати',
  ];
  const actionItems: string[] = [];

  actionVerbs.forEach((verb) => {
    const regex = new RegExp(`[^.]*\\b${verb}\\b[^.]*\\.`, 'gi');
    const matches = content.match(regex);
    if (matches) {
      actionItems.push(...matches);
    }
  });

  return actionItems.slice(0, 10);
}

function extractFinancialAmounts(
  content: string,
): Array<{ amount: string; context: string }> {
  const moneyPattern = /(\d+(?:[.,]\d+)?)\s*(?:грн|гривень?|доларів?|євро)/gi;
  const results: Array<{ amount: string; context: string }> = [];
  let match;

  while ((match = moneyPattern.exec(content)) !== null) {
    results.push({
      amount: match[0],
      context: extractContext(content, match.index, 100),
    });
  }

  return results;
}

export { ContextEnricher, InformationExtractor };
export type {
  UkrainianNameMatch,
  UkrainianAnalysisResult,
  UkrainianNameProcessor,
};
