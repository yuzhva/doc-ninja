import { promises as fs } from 'fs';
import path from 'path';

import { UkrainianNameMatcher } from './name-matcher.mjs';
import type { NameMatch } from './name-matcher.mjs';

interface UserFeedback {
  match: NameMatch;
  isCorrect: boolean;
  timestamp: Date;
  userCorrection?: string;
}

interface AdaptiveSettings {
  confidenceThresholds: {
    twoWordMatch: number;
    threeWordMatch: number;
    individualSimilarity: number;
  };
  learningRate: number;
}

class AdaptiveUkrainianNameMatcher extends UkrainianNameMatcher {
  private feedbackHistory: UserFeedback[] = [];
  private adaptiveSettings: AdaptiveSettings;
  private settingsPath: string;

  constructor(settingsPath?: string) {
    super();
    this.settingsPath =
      settingsPath || path.join(process.cwd(), 'assets/adaptive-settings.json');
    this.adaptiveSettings = {
      confidenceThresholds: {
        twoWordMatch: 0.9,
        threeWordMatch: 0.92,
        individualSimilarity: 0.85,
      },
      learningRate: 0.1,
    };
  }

  async initialize() {
    await super.initialize();
    await this.loadAdaptiveSettings();
  }

  /**
   * Add user feedback to improve future matching
   */
  async addFeedback(
    match: NameMatch,
    isCorrect: boolean,
    userCorrection?: string,
  ) {
    const feedback: UserFeedback = {
      match,
      isCorrect,
      timestamp: new Date(),
      userCorrection,
    };

    this.feedbackHistory.push(feedback);
    await this.adaptThresholds(feedback);
    await this.saveAdaptiveSettings();

    console.log(
      `📚 Learning from feedback: ${isCorrect ? '✅ Correct' : '❌ Incorrect'} match for "${match.name}"`,
    );
  }

  /**
   * Override the similarity matching with adaptive thresholds
   */
  async findNamesWithSimilarity(
    content: string,
    baseNames: string[],
  ): Promise<NameMatch[]> {
    if (!this.embedder) {
      await this.initialize();
    }

    const matches: NameMatch[] = [];
    console.log(
      `🧠 Starting adaptive similarity search (thresholds: 2-word=${this.adaptiveSettings.confidenceThresholds.twoWordMatch.toFixed(2)}, 3-word=${this.adaptiveSettings.confidenceThresholds.threeWordMatch.toFixed(2)})`,
    );

    this.embeddingCache.clear();
    const words = this.extractCapitalizedWordsWithPositions(content);

    for (const baseName of baseNames) {
      const nameParts = baseName.split(' ').filter((p) => p.length > 2);
      let lastName, firstName, patronymic;

      if (nameParts.length === 3) {
        [lastName, firstName, patronymic] = nameParts;
      } else if (nameParts.length === 2) {
        [firstName, lastName] = nameParts;
        patronymic = null;
      } else {
        continue;
      }

      const firstNameEmb = await this.getCachedEmbedding(firstName);
      const lastNameEmb = await this.getCachedEmbedding(lastName);
      const patronymicEmb = patronymic
        ? await this.getCachedEmbedding(patronymic)
        : null;

      const nameMatches = await this.findAdaptiveSemanticMatches(
        words,
        firstName,
        lastName,
        patronymic,
        firstNameEmb,
        lastNameEmb,
        patronymicEmb,
        baseName,
      );

      matches.push(...nameMatches);
    }

    return this.deduplicateAndSort(matches);
  }

  private async findAdaptiveSemanticMatches(
    words: Array<{ text: string; position: number }>,
    firstName: string,
    lastName: string,
    patronymic: string | null,
    firstNameEmb: any,
    lastNameEmb: any,
    patronymicEmb: any | null,
    baseName: string,
  ): Promise<NameMatch[]> {
    const matches: NameMatch[] = [];

    for (let i = 0; i < words.length; i++) {
      if (patronymic && patronymicEmb && i + 2 < words.length) {
        const word1 = words[i];
        const word2 = words[i + 1];
        const word3 = words[i + 2];

        if (
          word2.position - (word1.position + word1.text.length) < 10 &&
          word3.position - (word2.position + word2.text.length) < 10
        ) {
          const threeWordMatch = await this.checkAdaptiveThreeWordMatch(
            word1,
            word2,
            word3,
            lastNameEmb,
            firstNameEmb,
            patronymicEmb,
            baseName,
          );
          if (threeWordMatch) {
            matches.push(threeWordMatch);
            i += 2;
          }
        }
      } else if (!patronymic && i + 1 < words.length) {
        const word1 = words[i];
        const word2 = words[i + 1];

        if (word2.position - (word1.position + word1.text.length) < 10) {
          const twoWordMatch = await this.checkAdaptiveTwoWordMatch(
            word1,
            word2,
            lastNameEmb,
            firstNameEmb,
            baseName,
          );
          if (twoWordMatch) {
            matches.push(twoWordMatch);
            i += 1;
          }
        }
      }
    }

    return matches;
  }

  private async checkAdaptiveTwoWordMatch(
    word1: { text: string; position: number },
    word2: { text: string; position: number },
    lastNameEmb: any,
    firstNameEmb: any,
    baseName: string,
  ): Promise<NameMatch | null> {
    const word1Emb = await this.getCachedEmbedding(word1.text);
    const word2Emb = await this.getCachedEmbedding(word2.text);

    const normalOrder = {
      last: this.cosineSimilarity(word1Emb.data, lastNameEmb.data),
      first: this.cosineSimilarity(word2Emb.data, firstNameEmb.data),
    };

    const reversedOrder = {
      first: this.cosineSimilarity(word1Emb.data, firstNameEmb.data),
      last: this.cosineSimilarity(word2Emb.data, lastNameEmb.data),
    };

    // Exclude perfect matches (similarity = 1) from confidence calculation
    const normalScores = Object.values(normalOrder).filter(
      (score) => score < 1,
    );
    const reversedScores = Object.values(reversedOrder).filter(
      (score) => score < 1,
    );

    const normalConfidence =
      normalScores.length > 0
        ? Math.sqrt(normalScores.reduce((a, b) => a * b, 1))
        : 1; // If all scores are 1, confidence is 1
    const reversedConfidence =
      reversedScores.length > 0
        ? Math.sqrt(reversedScores.reduce((a, b) => a * b, 1))
        : 1;

    const thresholds = this.adaptiveSettings.confidenceThresholds;

    if (
      normalConfidence > thresholds.twoWordMatch &&
      Math.min(...normalScores, 1) > thresholds.individualSimilarity
    ) {
      return {
        name: baseName,
        declension: `${word1.text} ${word2.text}`,
        position: word1.position,
        confidence: normalConfidence,
      };
    }

    if (
      reversedConfidence > thresholds.twoWordMatch &&
      Math.min(...reversedScores, 1) > thresholds.individualSimilarity
    ) {
      return {
        name: baseName,
        declension: `${word1.text} ${word2.text}`,
        position: word1.position,
        confidence: reversedConfidence,
      };
    }

    return null;
  }

  private async checkAdaptiveThreeWordMatch(
    word1: { text: string; position: number },
    word2: { text: string; position: number },
    word3: { text: string; position: number },
    lastNameEmb: any,
    firstNameEmb: any,
    patronymicEmb: any,
    baseName: string,
  ): Promise<NameMatch | null> {
    const word1Emb = await this.getCachedEmbedding(word1.text);
    const word2Emb = await this.getCachedEmbedding(word2.text);
    const word3Emb = await this.getCachedEmbedding(word3.text);

    const lastNameSim = this.cosineSimilarity(word1Emb.data, lastNameEmb.data);
    const firstNameSim = this.cosineSimilarity(
      word2Emb.data,
      firstNameEmb.data,
    );
    const patronymicSim = this.cosineSimilarity(
      word3Emb.data,
      patronymicEmb.data,
    );

    /*
      Exclude perfect matches (similarity = 1) from confidence calculation
      to escape cases like:
      {
        lastNameSim: 0.8811389517959278,
        firstNameSim: 1,
        patronymicSim: 0.8863443743434914,
        confidence: 0.9209066962834566
      }
      {
        res: {
          name: 'ГАВРИЛЮК Віталій Леонідович',
          declension: 'Парасюк Віталій Анатолійович',
          position: 7063,
          confidence: 0.9209066962834566
        }
      }

      confidence = (sim(ГАВРИЛЮК,Парасюк) + sim(Віталій,Віталій)+sim(Леонідович,Анатолійович)) / 3;

      Since sim('Сергій', 'Сергій') is 1.0, it significantly pulls up the average, even if the other two parts are not perfect matches.
      The semantic similarity for the other parts is high enough to push the average over the 0.92 threshold.
    */
    const scores = [lastNameSim, firstNameSim, patronymicSim].filter(
      (score) => score < 1,
    );

    const confidence =
      scores.length > 0
        ? Math.pow(
            scores.reduce((a, b) => a * b, 1),
            1 / scores.length,
          )
        : 1; // If all scores are 1, confidence is 1

    const thresholds = this.adaptiveSettings.confidenceThresholds;

    if (
      confidence > thresholds.threeWordMatch &&
      Math.min(...scores, 1) > thresholds.individualSimilarity
    ) {
      return {
        name: baseName,
        declension: `${word1.text} ${word2.text} ${word3.text}`,
        position: word1.position,
        confidence: confidence,
      };
    }

    return null;
  }

  private async adaptThresholds(feedback: UserFeedback) {
    const { match, isCorrect } = feedback;
    const learningRate = this.adaptiveSettings.learningRate;

    // Adjust thresholds based on feedback
    if (isCorrect && match.confidence < 0.95) {
      // If it was correct but barely passed, lower thresholds slightly
      this.adaptiveSettings.confidenceThresholds.twoWordMatch -=
        learningRate * 0.01;
      this.adaptiveSettings.confidenceThresholds.threeWordMatch -=
        learningRate * 0.01;
      this.adaptiveSettings.confidenceThresholds.individualSimilarity -=
        learningRate * 0.005;
    } else if (!isCorrect && match.confidence > 0.7) {
      // If it was incorrect but had high confidence, raise thresholds
      this.adaptiveSettings.confidenceThresholds.twoWordMatch +=
        learningRate * 0.02;
      this.adaptiveSettings.confidenceThresholds.threeWordMatch +=
        learningRate * 0.02;
      this.adaptiveSettings.confidenceThresholds.individualSimilarity +=
        learningRate * 0.01;
    }

    // Keep thresholds within reasonable bounds
    const thresholds = this.adaptiveSettings.confidenceThresholds;
    thresholds.twoWordMatch = Math.max(
      0.7,
      Math.min(0.98, thresholds.twoWordMatch),
    );
    thresholds.threeWordMatch = Math.max(
      0.7,
      Math.min(0.98, thresholds.threeWordMatch),
    );
    thresholds.individualSimilarity = Math.max(
      0.6,
      Math.min(0.95, thresholds.individualSimilarity),
    );

    console.log(
      `🎯 Adapted thresholds: 2-word=${thresholds.twoWordMatch.toFixed(3)}, 3-word=${thresholds.threeWordMatch.toFixed(3)}, individual=${thresholds.individualSimilarity.toFixed(3)}`,
    );
  }

  private async loadAdaptiveSettings() {
    try {
      const data = await fs.readFile(this.settingsPath, 'utf-8');
      const saved = JSON.parse(data);
      this.adaptiveSettings = {
        ...this.adaptiveSettings,
        ...saved.adaptiveSettings,
      };
      this.feedbackHistory = saved.feedbackHistory || [];
      console.log(
        `📂 Loaded adaptive settings with ${this.feedbackHistory.length} feedback entries`,
      );
    } catch (error) {
      console.log('📁 No existing adaptive settings found, using defaults');
    }
  }

  private async saveAdaptiveSettings() {
    const data = {
      adaptiveSettings: this.adaptiveSettings,
      feedbackHistory: this.feedbackHistory.slice(-100), // Keep only last 100 entries
    };
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify(data, null, 2));
  }

  /**
   * Get current performance statistics
   */
  getPerformanceStats() {
    const recentFeedback = this.feedbackHistory.slice(-50);
    const correctCount = recentFeedback.filter((f) => f.isCorrect).length;
    const totalCount = recentFeedback.length;
    const accuracy = totalCount > 0 ? (correctCount / totalCount) * 100 : 0;

    return {
      totalFeedback: this.feedbackHistory.length,
      recentAccuracy: accuracy,
      currentThresholds: this.adaptiveSettings.confidenceThresholds,
    };
  }
}

export { AdaptiveUkrainianNameMatcher };
