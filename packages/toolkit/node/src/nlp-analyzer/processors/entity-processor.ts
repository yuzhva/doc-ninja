import { Pipeline } from '@huggingface/transformers';

import { TaskProcessor } from '../managers/model-manager.ts';
import { AnalysisConfig, DocumentChunk, EntityResult } from '../types.ts';

interface EntityMappingConfig {
  labelMap?: Record<string, string>;
  customEntities?: string[];
  minConfidence?: number;
  mergeStrategy?: 'strict' | 'loose' | 'custom';
}

class EntityProcessor implements TaskProcessor {
  private defaultLabelMap: Record<string, string> = {
    // Standard NER labels
    PER: 'PERSON',
    PERSON: 'PERSON',
    ORG: 'ORGANIZATION',
    ORGANIZATION: 'ORGANIZATION',
    LOC: 'LOCATION',
    LOCATION: 'LOCATION',
    MISC: 'MISCELLANEOUS',

    // Financial entities
    MONEY: 'FINANCIAL',
    PERCENT: 'FINANCIAL',
    CURRENCY: 'FINANCIAL',

    // Temporal entities
    DATE: 'TEMPORAL',
    TIME: 'TEMPORAL',

    // Technical entities
    PRODUCT: 'TECHNOLOGY',
    SOFTWARE: 'TECHNOLOGY',
    BRAND: 'TECHNOLOGY',

    // Legal/Business
    LAW: 'LEGAL',
    CONTRACT: 'LEGAL',
    REGULATION: 'LEGAL',
  };

  private model: Pipeline;
  private entityConfig?: EntityMappingConfig;

  constructor(model: Pipeline, entityConfig?: EntityMappingConfig) {
    this.model = model;
    this.entityConfig = entityConfig;
  }

  async process(
    chunks: DocumentChunk[],
    config: AnalysisConfig & { entityMapping?: EntityMappingConfig },
  ): Promise<EntityResult> {
    const entityMappingConfig = config.entityMapping || this.entityConfig || {};
    const labelMap = {
      ...this.defaultLabelMap,
      ...(entityMappingConfig.labelMap || {}),
    };
    const minConfidence = entityMappingConfig.minConfidence || 0.7;

    const allEntities: Array<{
      text: string;
      label: string;
      confidence: number;
      start: number;
      end: number;
    }> = [];

    let globalOffset = 0;

    for (const chunk of chunks) {
      try {
        const result = (await this.model(chunk.text)) as Array<{
          entity: string;
          score: number;
          word: string;
          start: number;
          end: number;
        }>;

        // Group and merge sub-word tokens
        const mergedEntities = this.mergeSubwordTokens(result);

        // Add to global entities with adjusted positions
        mergedEntities.forEach((entity) => {
          allEntities.push({
            text: entity.word,
            label: this.normalizeEntityLabel(entity.entity, labelMap),
            confidence: entity.score,
            start: globalOffset + entity.start,
            end: globalOffset + entity.end,
          });
        });
      } catch (error) {
        console.warn(`Entity extraction failed for chunk ${chunk.id}:`, error);
      }

      globalOffset += chunk.text.length;
    }

    // Remove duplicates and low-confidence entities
    const filteredEntities = this.filterAndDeduplicateEntities(
      allEntities,
      minConfidence,
    );

    // Generate summary statistics
    const summary = this.generateEntitySummary(filteredEntities);

    return {
      entities: filteredEntities,
      summary,
    };
  }

  private mergeSubwordTokens(
    tokens: Array<{
      entity: string;
      score: number;
      word: string;
      start: number;
      end: number;
    }>,
  ): Array<{
    entity: string;
    score: number;
    word: string;
    start: number;
    end: number;
  }> {
    if (tokens.length === 0) return [];

    const merged: Array<{
      entity: string;
      score: number;
      word: string;
      start: number;
      end: number;
    }> = [];

    let currentEntity = tokens[0];

    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];

      // Check if this token continues the current entity
      if (
        token.entity === currentEntity.entity &&
        token.start <= currentEntity.end + 1 && // Allow for small gaps
        token.entity !== 'O' // Not an "Outside" tag
      ) {
        // Merge tokens
        currentEntity = {
          entity: currentEntity.entity,
          score: Math.max(currentEntity.score, token.score), // Take highest confidence
          word: currentEntity.word + token.word.replace(/^##/, ''), // Remove BERT subword prefix
          start: currentEntity.start,
          end: token.end,
        };
      } else {
        // Save current entity and start new one
        if (currentEntity.entity !== 'O') {
          merged.push(currentEntity);
        }
        currentEntity = token;
      }
    }

    // Don't forget the last entity
    if (currentEntity.entity !== 'O') {
      merged.push(currentEntity);
    }

    return merged;
  }

  private normalizeEntityLabel(
    label: string,
    labelMap?: Record<string, string>,
  ): string {
    // Remove B- and I- prefixes from BIO tagging
    const normalized = label.replace(/^[BI]-/, '');

    const mappingToUse = labelMap || this.defaultLabelMap;
    return mappingToUse[normalized.toUpperCase()] || normalized.toUpperCase();
  }

  private filterAndDeduplicateEntities(
    entities: Array<{
      text: string;
      label: string;
      confidence: number;
      start: number;
      end: number;
    }>,
    minConfidence: number,
  ): Array<{
    text: string;
    label: string;
    confidence: number;
    start: number;
    end: number;
  }> {
    // Filter by confidence
    const filtered = entities.filter(
      (entity) => entity.confidence >= minConfidence,
    );

    // Remove duplicates (same text and label)
    const seen = new Set<string>();
    const deduplicated = filtered.filter((entity) => {
      const key = `${entity.text.toLowerCase()}_${entity.label}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    return deduplicated.sort((a, b) => a.start - b.start);
  }

  private generateEntitySummary(
    entities: Array<{
      text: string;
      label: string;
      confidence: number;
      start: number;
      end: number;
    }>,
  ): Record<string, number> {
    const summary: Record<string, number> = {};

    entities.forEach((entity) => {
      summary[entity.label] = (summary[entity.label] || 0) + 1;
    });

    return summary;
  }
}

export { EntityProcessor };
export type { EntityMappingConfig };
