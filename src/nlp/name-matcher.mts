import { env, pipeline } from '@xenova/transformers';

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
  private embeddingCache = new Map<string, any>();

  async initialize() {
    try {
      console.log('Initializing models locally...');

      // Use a multilingual NER model that supports Ukrainian
      this.tokenClassifier = await pipeline(
        'token-classification',
        'Xenova/bert-base-multilingual-cased',
        {
          aggregation_strategy: 'simple',
          local_files_only: true, // Only use local files
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
              const percent = (
                (progress.loaded / progress.total) *
                100
              ).toFixed(1);
              process.stdout.write(`\r📥 Loading BERT: ${percent}%`);
            } else if (progress.status === 'ready') {
              console.log('\n✓ BERT model loaded');
            }
          },
        }
      );

      this.embedder = await pipeline(
        'feature-extraction',
        'Xenova/multilingual-e5-small',
        {
          progress_callback: (progress: any) => {
            if (progress.status === 'downloading') {
              const percent = (
                (progress.loaded / progress.total) *
                100
              ).toFixed(1);
              process.stdout.write(`\r📥 Loading E5: ${percent}%`);
            } else if (progress.status === 'ready') {
              console.log('\n✓ E5 model loaded');
            }
          },
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
    const personEntities = entities.filter(
      (entity: any) =>
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

        if (similarity > 0.7) {
          // Threshold for match confidence
          matches.push({
            name: baseName,
            declension: entityText,
            position: entity.start,
            confidence: similarity,
          });
        }
      }
    }

    return matches.sort((a, b) => a.position - b.position);
  }

  /**
   * Creates a pre-processed, indexed representation of a document's content.
   */
  async indexDocument(
    content: string
  ): Promise<Array<{ text: string; position: number; embedding: any }>> {
    if (!this.embedder) {
      await this.initialize();
    }
    this.embeddingCache.clear(); // Use a fresh cache for each document

    const capitalizedWords = this.extractCapitalizedWordsWithPositions(content);
    const indexedWords = [];

    for (const word of capitalizedWords) {
      const embedding = await this.getCachedEmbedding(word.text);
      // We need to convert tensor data to a plain array for JSON serialization
      indexedWords.push({
        text: word.text,
        position: word.position,
        embedding: Array.from(embedding.data),
      });
    }

    return indexedWords;
  }

  /**
   * Finds names in a pre-indexed document.
   */
  async findNamesInIndexedDocument(
    indexedWords: Array<{ text: string; position: number; embedding: any }>,
    baseNames: string[]
  ): Promise<NameMatch[]> {
    if (!this.embedder) {
      await this.initialize();
    }

    const matches: NameMatch[] = [];
    this.embeddingCache.clear(); // Use a fresh cache for name parts

    for (const baseName of baseNames) {
      // Filter out potential adjectives or irrelevant short words
      const nameParts = baseName.split(' ').filter((p) => p.length > 2);
      let lastName, firstName, patronymic;

      if (nameParts.length === 3) {
        // Assumes "LastName FirstName Patronymic" for 3 parts
        [lastName, firstName, patronymic] = nameParts;
      } else if (nameParts.length === 2) {
        // Assumes "FirstName LastName" for 2 parts
        [firstName, lastName] = nameParts;
        patronymic = null;
      } else {
        continue; // Skip if we don't have a 2 or 3 part name
      }

      // Get embeddings for the base name parts
      const firstNameEmb = await this.getCachedEmbedding(firstName);
      const lastNameEmb = await this.getCachedEmbedding(lastName);
      const patronymicEmb = patronymic
        ? await this.getCachedEmbedding(patronymic)
        : null;

      // Find matches using semantic similarity
      const nameMatches = await this.findSemanticMatches(
        indexedWords,
        firstName,
        lastName,
        patronymic,
        firstNameEmb,
        lastNameEmb,
        patronymicEmb,
        baseName
      );

      matches.push(...nameMatches);
    }

    return this.deduplicateAndSort(matches);
  }

  /**
   * Advanced semantic approach - finds names by understanding word relationships
   */
  async findNamesWithSimilarity(
    content: string,
    baseNames: string[]
  ): Promise<NameMatch[]> {
    if (!this.embedder) {
      await this.initialize();
    }

    const matches: NameMatch[] = [];
    this.embeddingCache.clear(); // Fresh cache for each document

    // Extract only capitalized words (more likely to be names)
    const words = this.extractCapitalizedWordsWithPositions(content);

    for (const baseName of baseNames) {
      // Filter out potential adjectives or irrelevant short words
      const nameParts = baseName.split(' ').filter((p) => p.length > 2);
      let lastName, firstName, patronymic;

      if (nameParts.length === 3) {
        // Assumes "LastName FirstName Patronymic" for 3 parts
        [lastName, firstName, patronymic] = nameParts;
      } else if (nameParts.length === 2) {
        // Assumes "FirstName LastName" for 2 parts
        [firstName, lastName] = nameParts;
        patronymic = null;
      } else {
        continue; // Skip if we don't have a 2 or 3 part name
      }

      // Get embeddings for the base name parts
      const firstNameEmb = await this.getCachedEmbedding(firstName);
      const lastNameEmb = await this.getCachedEmbedding(lastName);
      const patronymicEmb = patronymic
        ? await this.getCachedEmbedding(patronymic)
        : null;

      // Find matches using semantic similarity
      const nameMatches = await this.findSemanticMatches(
        words,
        firstName,
        lastName,
        patronymic,
        firstNameEmb,
        lastNameEmb,
        patronymicEmb,
        baseName
      );

      matches.push(...nameMatches);
    }

    return this.deduplicateAndSort(matches);
  }

  /**
   * Get embedding for a text, using cache if available.
   */
  private async getCachedEmbedding(text: string): Promise<any> {
    if (this.embeddingCache.has(text)) {
      return this.embeddingCache.get(text);
    }
    // Generate embedding for the text
    const embedding = await this.embedder(text, {
      pooling: 'mean',
      normalize: true,
    });
    this.embeddingCache.set(text, embedding);
    return embedding;
  }

  /**
   * Extract only capitalized Ukrainian words with their positions (more likely to be names)
   */
  private extractCapitalizedWordsWithPositions(
    content: string
  ): Array<{ text: string; position: number }> {
    // Only match capitalized Ukrainian words (proper nouns)
    const ukrainianCapitalizedWordRegex = /[А-ЯІЇЄҐ][а-яіїєґ'ʼ-]+/g;
    const words: Array<{ text: string; position: number }> = [];
    let match;

    while ((match = ukrainianCapitalizedWordRegex.exec(content)) !== null) {
      if (match[0].length > 2) {
        // Skip very short words
        words.push({
          text: match[0],
          position: match.index,
        });
      }
    }

    return words;
  }

  /**
   * Find semantic matches for a name using AI embeddings with stricter criteria
   */
  private async findSemanticMatches(
    words: Array<{ text: string; position: number }>,
    firstName: string,
    lastName: string,
    patronymic: string | null,
    firstNameEmb: any,
    lastNameEmb: any,
    patronymicEmb: any | null,
    baseName: string
  ): Promise<NameMatch[]> {
    const matches: NameMatch[] = [];

    for (let i = 0; i < words.length; i++) {
      // If we have a 3-part name, ONLY look for 3-word matches
      if (patronymic && patronymicEmb && i + 2 < words.length) {
        const word1 = words[i];
        const word2 = words[i + 1];
        const word3 = words[i + 2];

        // Check if words are adjacent
        if (
          word2.position - (word1.position + word1.text.length) < 10 &&
          word3.position - (word2.position + word2.text.length) < 10
        ) {
          const threeWordMatch = await this.checkThreeWordMatch(
            word1,
            word2,
            word3,
            lastNameEmb,
            firstNameEmb,
            patronymicEmb,
            baseName
          );
          if (threeWordMatch) {
            matches.push(threeWordMatch);
            i += 2; // Skip the next two words
          }
        }
      }
      // If we have a 2-part name, ONLY look for 2-word matches
      else if (!patronymic && i + 1 < words.length) {
        const word1 = words[i];
        const word2 = words[i + 1];

        if (word2.position - (word1.position + word1.text.length) < 10) {
          const twoWordMatch = await this.checkTwoWordMatch(
            word1,
            word2,
            lastNameEmb,
            firstNameEmb,
            baseName
          );
          if (twoWordMatch) {
            matches.push(twoWordMatch);
            i += 1; // Skip the next word
          }
        }
      }
    }

    return matches;
  }

  /**
   * Check if two adjacent words form a name match with stricter criteria
   */
  private async checkTwoWordMatch(
    word1: { text: string; position: number; embedding?: any },
    word2: { text: string; position: number; embedding?: any },
    lastNameEmb: any,
    firstNameEmb: any,
    baseName: string
  ): Promise<NameMatch | null> {
    // Use pre-computed embedding if available, otherwise generate it
    const word1Emb = word1.embedding
      ? { data: word1.embedding }
      : await this.getCachedEmbedding(word1.text);
    const word2Emb = word2.embedding
      ? { data: word2.embedding }
      : await this.getCachedEmbedding(word2.text);

    // Order: LastName FirstName
    const normalOrder = {
      last: this.cosineSimilarity(word1Emb.data, lastNameEmb.data),
      first: this.cosineSimilarity(word2Emb.data, firstNameEmb.data),
    };

    // Order: FirstName LastName
    const reversedOrder = {
      first: this.cosineSimilarity(word1Emb.data, firstNameEmb.data),
      last: this.cosineSimilarity(word2Emb.data, lastNameEmb.data),
    };

    const normalConfidence = (normalOrder.first + normalOrder.last) / 2;
    const reversedConfidence = (reversedOrder.first + reversedOrder.last) / 2;

    // A match requires both parts to be reasonably similar
    if (normalConfidence > 0.9 && normalOrder.first > 0.85 && normalOrder.last > 0.85) {
      return {
        name: baseName,
        declension: `${word1.text} ${word2.text}`,
        position: word1.position,
        confidence: normalConfidence,
      };
    }

    if (reversedConfidence > 0.9 && reversedOrder.first > 0.85 && reversedOrder.last > 0.85) {
      return {
        name: baseName,
        declension: `${word1.text} ${word2.text}`,
        position: word1.position,
        confidence: reversedConfidence,
      };
    }

    return null;
  }

  /**
   * Check if three adjacent words form a full name match.
   */
  private async checkThreeWordMatch(
    word1: { text: string; position: number; embedding?: any },
    word2: { text: string; position: number; embedding?: any },
    word3: { text: string; position: number; embedding?: any },
    lastNameEmb: any,
    firstNameEmb: any,
    patronymicEmb: any,
    baseName: string
  ): Promise<NameMatch | null> {
    const word1Emb = word1.embedding
      ? { data: word1.embedding }
      : await this.getCachedEmbedding(word1.text);
    const word2Emb = word2.embedding
      ? { data: word2.embedding }
      : await this.getCachedEmbedding(word2.text);
    const word3Emb = word3.embedding
      ? { data: word3.embedding }
      : await this.getCachedEmbedding(word3.text);

    // Check for LastName + FirstName + Patronymic
    const lastNameSim = this.cosineSimilarity(word1Emb.data, lastNameEmb.data);
    const firstNameSim = this.cosineSimilarity(word2Emb.data, firstNameEmb.data);
    const patronymicSim = this.cosineSimilarity(word3Emb.data, patronymicEmb.data);

    const confidence = (lastNameSim + firstNameSim + patronymicSim) / 3;

    // Require a high similarity for all three parts for a confident match
    if (confidence > 0.92 && lastNameSim > 0.88 && firstNameSim > 0.88 && patronymicSim > 0.88) {
      return {
        name: baseName,
        declension: `${word1.text} ${word2.text} ${word3.text}`,
        position: word1.position,
        confidence: confidence,
      };
    }

    return null;
  }

  /**
   * Remove duplicates and sort matches
   */
  private deduplicateAndSort(matches: NameMatch[]): NameMatch[] {
    const uniqueMatches = new Map<string, NameMatch>();

    matches.forEach((match) => {
      const key = `${match.position}-${match.name}`;
      const existing = uniqueMatches.get(key);

      if (!existing || match.confidence > existing.confidence) {
        uniqueMatches.set(key, match);
      }
    });

    return Array.from(uniqueMatches.values()).sort(
      (a, b) => a.position - b.position
    );
  }

  /**
   * Calculate similarity between entity and target name parts
   */
  private calculateSimilarity(
    entity: string,
    firstName: string,
    lastName?: string
  ): number {
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
          matrix[j - 1][i - 1] + indicator
        );
      }
    }

    return matrix[str2.length][str1.length];
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

  /**
   * Legacy pattern-based method - kept for fallback but not primary
   */
  private createFlexiblePattern(name: string): RegExp {
    // This is now just a fallback - the main matching uses semantic similarity
    const variations = this.getNameVariations(name);
    const escaped = variations.map((v) =>
      v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    );
    return new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
  }

  private getNameVariations(name: string): string[] {
    // Simplified - no longer the primary matching mechanism
    return [name];
  }
}

export { UkrainianNameMatcher };

export type { NameMatch };
