import { pipeline, env } from '@xenova/transformers';

// Configure to run locally and set cache directory
env.allowRemoteModels = false; // Only use locally cached models
env.cacheDir = './models'; // Set custom cache directory

type NameMatch = {
  name: string;
  declension: string;
  position: number;
  confidence: number;
};

class UkrainianNameMatcher {
  private tokenClassifier: any = null;
  private embedder: any = null;

  async initialize() {
    try {
      console.log('Initializing models locally...');

      // Use a multilingual NER model that supports Ukrainian
      this.tokenClassifier = await pipeline(
        'token-classification',
        'Xenova/bert-base-multilingual-cased',
        {
          aggregation_strategy: 'simple',
          local_files_only: true // Only use local files
        }
      );

      // Initialize embedder for similarity search
      this.embedder = await pipeline(
        'feature-extraction',
        'Xenova/multilingual-e5-small',
        { local_files_only: true }
      );

      console.log('Models initialized successfully!');
    } catch (error) {
      console.log('Models not found locally, downloading...');

      // Download models if not available locally with progress tracking
      this.tokenClassifier = await pipeline(
        'token-classification',
        'Xenova/bert-base-multilingual-cased',
        {
          aggregation_strategy: 'simple',
          progress_callback: (progress: any) => {
            if (progress.status === 'downloading') {
              const percent = ((progress.loaded / progress.total) * 100).toFixed(1);
              process.stdout.write(`\r📥 Loading BERT: ${percent}%`);
            } else if (progress.status === 'ready') {
              console.log('\n✓ BERT model loaded');
            }
          }
        }
      );

      this.embedder = await pipeline(
        'feature-extraction',
        'Xenova/multilingual-e5-small',
        {
          progress_callback: (progress: any) => {
            if (progress.status === 'downloading') {
              const percent = ((progress.loaded / progress.total) * 100).toFixed(1);
              process.stdout.write(`\r📥 Loading E5: ${percent}%`);
            } else if (progress.status === 'ready') {
              console.log('\n✓ E5 model loaded');
            }
          }
        }
      );

      console.log('Models downloaded and cached locally!');
    }
  }

  /**
   * Find names and their declensions in Ukrainian text
   */
  async findNames(content: string, baseNames: string[]): Promise<NameMatch[]> {
    if (!this.tokenClassifier) {
      await this.initialize();
    }

    const matches: NameMatch[] = [];

    // Use NER to find all person entities
    const entities = await this.tokenClassifier(content);
    const personEntities = entities.filter((entity: any) =>
      entity.entity_group === 'PER' || entity.entity_group === 'PERSON'
    );

    // For each base name, try to match it with found entities
    for (const baseName of baseNames) {
      const [firstName, lastName] = baseName.split(' ');

      for (const entity of personEntities) {
        const entityText = entity.word.replace(/##/g, ''); // Remove BERT subword tokens

        // Check if the entity contains parts of our target name
        const similarity = this.calculateSimilarity(
          entityText.toLowerCase(),
          firstName.toLowerCase(),
          lastName?.toLowerCase()
        );

        if (similarity > 0.7) { // Threshold for match confidence
          matches.push({
            name: baseName,
            declension: entityText,
            position: entity.start,
            confidence: similarity
          });
        }
      }
    }

    return matches.sort((a, b) => a.position - b.position);
  }

  /**
   * Alternative approach using semantic similarity
   */
  async findNamesWithSimilarity(content: string, baseNames: string[]): Promise<NameMatch[]> {
    if (!this.embedder) {
      await this.initialize();
    }

    const matches: NameMatch[] = [];

    // Create embeddings for base names
    const baseNameEmbeddings = await Promise.all(
      baseNames.map(name => this.embedder(name, { pooling: 'mean', normalize: true }))
    );

    // Split content into sentences and check each
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i].trim();
      const sentenceEmbedding = await this.embedder(sentence, { pooling: 'mean', normalize: true });

      for (let j = 0; j < baseNames.length; j++) {
        const similarity = this.cosineSimilarity(
          baseNameEmbeddings[j].data,
          sentenceEmbedding.data
        );

        if (similarity > 0.3) { // Lower threshold for sentence-level similarity
          // Try to extract the actual name mention from the sentence
          const namePattern = this.createFlexiblePattern(baseNames[j]);
          const match = sentence.match(namePattern);

          if (match) {
            matches.push({
              name: baseNames[j],
              declension: match[0],
              position: content.indexOf(sentence) + sentence.indexOf(match[0]),
              confidence: similarity
            });
          }
        }
      }
    }

    return matches;
  }

  /**
   * Calculate similarity between entity and target name parts
   */
  private calculateSimilarity(entity: string, firstName: string, lastName?: string): number {
    const entityParts = entity.split(/\s+/);
    let maxSimilarity = 0;

    for (const part of entityParts) {
      // Check similarity with first name
      const firstNameSim = this.stringSimilarity(part, firstName);
      maxSimilarity = Math.max(maxSimilarity, firstNameSim);

      // Check similarity with last name if provided
      if (lastName) {
        const lastNameSim = this.stringSimilarity(part, lastName);
        maxSimilarity = Math.max(maxSimilarity, lastNameSim);
      }
    }

    return maxSimilarity;
  }

  /**
   * Simple string similarity using Levenshtein distance
   */
  private stringSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Create a flexible regex pattern for Ukrainian name declensions
   */
  private createFlexiblePattern(name: string): RegExp {
    const [firstName, lastName] = name.split(' ');

    // Common Ukrainian name ending variations
    const firstNameVariations = this.getNameVariations(firstName);
    const lastNameVariations = lastName ? this.getNameVariations(lastName) : [];

    const firstNamePattern = firstNameVariations.join('|');
    const lastNamePattern = lastNameVariations.length > 0 ? lastNameVariations.join('|') : '';

    if (lastNamePattern) {
      return new RegExp(`(${firstNamePattern})\\s+(${lastNamePattern})`, 'gi');
    } else {
      return new RegExp(`(${firstNamePattern})`, 'gi');
    }
  }

  /**
   * Generate common Ukrainian declension variations
   */
  private getNameVariations(name: string): string[] {
    const variations = [name];

    // Common Ukrainian declension patterns
    const patterns = [
      { from: /а$/, to: ['и', 'у', 'ою', 'і'] },
      { from: /о$/, to: ['а', 'у', 'ом', 'і'] },
      { from: /й$/, to: ['я', 'ю', 'єм', 'ї'] },
      { from: /ь$/, to: ['я', 'ю', 'ем', 'і'] },
      // Add more patterns as needed
    ];

    for (const pattern of patterns) {
      if (pattern.from.test(name)) {
        const stem = name.replace(pattern.from, '');
        pattern.to.forEach(ending => {
          variations.push(stem + ending);
        });
      }
    }

    return variations;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));

    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    return dotProduct / (magnitudeA * magnitudeB);
  }
}

export { UkrainianNameMatcher };
export type { NameMatch };
