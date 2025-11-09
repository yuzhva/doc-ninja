import { Pipeline } from '@huggingface/transformers';

import { AnalysisConfig, DocumentChunk } from '../../types';
import { BaseProcessor } from '../base-processor';

interface MedicalAnalysisResult {
  symptoms: Array<{
    text: string;
    severity: 'mild' | 'moderate' | 'severe';
    confidence: number;
  }>;
  medications: Array<{
    name: string;
    dosage?: string;
    confidence: number;
  }>;
  conditions: Array<{
    name: string;
    confidence: number;
  }>;
  sentiment: {
    overall: 'positive' | 'negative' | 'neutral';
    concern_level: 'low' | 'medium' | 'high';
  };
  summary: {
    patient_status: string;
    key_findings: string[];
  };
}

class MedicalDocumentProcessor extends BaseProcessor {
  private medicalTerms = {
    symptoms: [
      'fever',
      'headache',
      'nausea',
      'fatigue',
      'dizziness',
      'pain',
      'shortness of breath',
      'chest pain',
      'abdominal pain',
      'vomiting',
    ],
    medications: [
      'aspirin',
      'ibuprofen',
      'acetaminophen',
      'morphine',
      'insulin',
      'antibiotics',
      'steroids',
      'beta blockers',
      'ace inhibitors',
    ],
    conditions: [
      'diabetes',
      'hypertension',
      'pneumonia',
      'asthma',
      'depression',
      'anxiety',
      'arthritis',
      'migraine',
      'covid-19',
      'influenza',
    ],
    severityKeywords: {
      mild: ['slight', 'minor', 'mild', 'light', 'low-grade'],
      moderate: ['moderate', 'noticeable', 'significant', 'considerable'],
      severe: ['severe', 'intense', 'acute', 'critical', 'emergency', 'urgent'],
    },
  };

  constructor(model?: Pipeline, config?: any) {
    super(model, config);
  }

  async process(
    chunks: DocumentChunk[],
    config: AnalysisConfig,
  ): Promise<MedicalAnalysisResult> {
    const fullText = chunks.map((chunk) => chunk.text).join(' ');
    const processedText = this.preprocessText(fullText);

    // Extract medical entities
    const symptoms = await this.extractSymptoms(processedText, chunks);
    const medications = await this.extractMedications(processedText, chunks);
    const conditions = await this.extractConditions(processedText, chunks);

    // Analyze medical sentiment (concern level)
    const sentiment = await this.analyzeMedicalSentiment(processedText);

    // Generate medical summary
    const summary = this.generateMedicalSummary(
      symptoms,
      medications,
      conditions,
    );

    return {
      symptoms,
      medications,
      conditions,
      sentiment,
      summary,
    };
  }

  protected preprocessText(text: string): string {
    // Medical-specific preprocessing
    return (
      super
        .preprocessText(text)
        .toLowerCase()
        // Normalize medical abbreviations
        .replace(/\bb\.p\./g, 'blood pressure')
        .replace(/\bh\.r\./g, 'heart rate')
        .replace(/\btemp\./g, 'temperature')
        .replace(/\bmg\b/g, 'milligrams')
        .replace(/\bml\b/g, 'milliliters')
    );
  }

  private async extractSymptoms(
    text: string,
    chunks: DocumentChunk[],
  ): Promise<
    Array<{
      text: string;
      severity: 'mild' | 'moderate' | 'severe';
      confidence: number;
    }>
  > {
    const symptoms: Array<{
      text: string;
      severity: 'mild' | 'moderate' | 'severe';
      confidence: number;
    }> = [];

    // Use AI model if available, otherwise use rule-based extraction
    if (this.model) {
      return this.processWithFallback(
        () => this.extractSymptomsWithAI(chunks),
        () => this.extractSymptomsWithRules(text),
        'AI symptom extraction',
      );
    }

    return this.extractSymptomsWithRules(text);
  }

  private async extractSymptomsWithAI(chunks: DocumentChunk[]): Promise<
    Array<{
      text: string;
      severity: 'mild' | 'moderate' | 'severe';
      confidence: number;
    }>
  > {
    if (!this.model) throw new Error('No model available');

    const symptoms: Array<{
      text: string;
      severity: 'mild' | 'moderate' | 'severe';
      confidence: number;
    }> = [];

    for (const chunk of chunks) {
      try {
        // Use NER model to extract entities
        const entities = (await this.model(chunk.text)) as Array<{
          entity: string;
          word: string;
          score: number;
        }>;

        entities.forEach((entity) => {
          if (
            entity.entity.includes('SYMPTOM') ||
            this.medicalTerms.symptoms.some((s) =>
              entity.word.toLowerCase().includes(s),
            )
          ) {
            const severity = this.determineSeverity(chunk.text, entity.word);
            symptoms.push({
              text: entity.word,
              severity,
              confidence: entity.score,
            });
          }
        });
      } catch (error) {
        console.warn(`AI symptom extraction failed for chunk:`, error);
      }
    }

    return symptoms;
  }

  private extractSymptomsWithRules(text: string): Array<{
    text: string;
    severity: 'mild' | 'moderate' | 'severe';
    confidence: number;
  }> {
    const symptoms: Array<{
      text: string;
      severity: 'mild' | 'moderate' | 'severe';
      confidence: number;
    }> = [];

    this.medicalTerms.symptoms.forEach((symptom) => {
      const regex = new RegExp(`\\b${symptom}\\b`, 'gi');
      const matches = text.match(regex);

      if (matches) {
        matches.forEach(() => {
          const severity = this.determineSeverity(text, symptom);
          symptoms.push({
            text: symptom,
            severity,
            confidence: 0.7, // Rule-based confidence
          });
        });
      }
    });

    return symptoms;
  }

  private determineSeverity(
    context: string,
    symptom: string,
  ): 'mild' | 'moderate' | 'severe' {
    const contextLower = context.toLowerCase();
    const symptomIndex = contextLower.indexOf(symptom.toLowerCase());

    if (symptomIndex === -1) return 'mild';

    // Check surrounding words for severity indicators
    const surroundingText = contextLower.slice(
      Math.max(0, symptomIndex - 50),
      symptomIndex + symptom.length + 50,
    );

    for (const [severity, keywords] of Object.entries(
      this.medicalTerms.severityKeywords,
    )) {
      if (keywords.some((keyword) => surroundingText.includes(keyword))) {
        return severity as 'mild' | 'moderate' | 'severe';
      }
    }

    return 'moderate'; // Default
  }

  private async extractMedications(
    text: string,
    chunks: DocumentChunk[],
  ): Promise<
    Array<{
      name: string;
      dosage?: string;
      confidence: number;
    }>
  > {
    const medications: Array<{
      name: string;
      dosage?: string;
      confidence: number;
    }> = [];

    this.medicalTerms.medications.forEach((medication) => {
      const regex = new RegExp(
        `\\b${medication}\\b(?:\\s+(\\d+\\s*(?:mg|ml|tablets?|pills?)))?`,
        'gi',
      );
      let match;

      while ((match = regex.exec(text)) !== null) {
        medications.push({
          name: medication,
          dosage: match[1] || undefined,
          confidence: 0.8,
        });
      }
    });

    return medications;
  }

  private async extractConditions(
    text: string,
    chunks: DocumentChunk[],
  ): Promise<
    Array<{
      name: string;
      confidence: number;
    }>
  > {
    const conditions: Array<{ name: string; confidence: number }> = [];

    this.medicalTerms.conditions.forEach((condition) => {
      const regex = new RegExp(`\\b${condition}\\b`, 'gi');
      if (regex.test(text)) {
        conditions.push({
          name: condition,
          confidence: 0.75,
        });
      }
    });

    return conditions;
  }

  private async analyzeMedicalSentiment(text: string): Promise<{
    overall: 'positive' | 'negative' | 'neutral';
    concern_level: 'low' | 'medium' | 'high';
  }> {
    const concernWords = {
      high: [
        'critical',
        'emergency',
        'urgent',
        'severe',
        'acute',
        'deteriorating',
      ],
      medium: [
        'concerning',
        'moderate',
        'significant',
        'noticeable',
        'worrying',
      ],
      low: ['stable', 'improving', 'mild', 'normal', 'good'],
    };

    let concernLevel: 'low' | 'medium' | 'high' = 'low';
    let sentiment: 'positive' | 'negative' | 'neutral' = 'neutral';

    const textLower = text.toLowerCase();

    // Determine concern level
    if (concernWords.high.some((word) => textLower.includes(word))) {
      concernLevel = 'high';
      sentiment = 'negative';
    } else if (concernWords.medium.some((word) => textLower.includes(word))) {
      concernLevel = 'medium';
      sentiment = 'negative';
    } else if (concernWords.low.some((word) => textLower.includes(word))) {
      concernLevel = 'low';
      sentiment = 'positive';
    }

    return {
      overall: sentiment,
      concern_level: concernLevel,
    };
  }

  private generateMedicalSummary(
    symptoms: Array<{
      text: string;
      severity: 'mild' | 'moderate' | 'severe';
      confidence: number;
    }>,
    medications: Array<{ name: string; dosage?: string; confidence: number }>,
    conditions: Array<{ name: string; confidence: number }>,
  ): { patient_status: string; key_findings: string[] } {
    const keyFindings: string[] = [];

    if (symptoms.length > 0) {
      const severeSymptoms = symptoms.filter((s) => s.severity === 'severe');
      if (severeSymptoms.length > 0) {
        keyFindings.push(
          `Severe symptoms detected: ${severeSymptoms.map((s) => s.text).join(', ')}`,
        );
      }
    }

    if (medications.length > 0) {
      keyFindings.push(
        `Medications mentioned: ${medications.map((m) => m.name).join(', ')}`,
      );
    }

    if (conditions.length > 0) {
      keyFindings.push(
        `Conditions identified: ${conditions.map((c) => c.name).join(', ')}`,
      );
    }

    const patientStatus = symptoms.some((s) => s.severity === 'severe')
      ? 'Requires immediate attention'
      : symptoms.some((s) => s.severity === 'moderate')
        ? 'Stable but monitoring required'
        : 'Stable condition';

    return {
      patient_status: patientStatus,
      key_findings: keyFindings,
    };
  }
}

export { MedicalDocumentProcessor };

export type { MedicalAnalysisResult };
