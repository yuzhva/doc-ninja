import fs from 'fs/promises';
import path from 'path';
import * as XLSX from 'xlsx';

import type { DocumentIntelligenceConfig, NameMatch } from '../types';

/**
 * Excel Reporter for Document Intelligence results
 */
export class ExcelReporter {
  private config: DocumentIntelligenceConfig;

  constructor(config: DocumentIntelligenceConfig) {
    this.config = config;
  }

  /**
   * Generate comprehensive Excel report
   */
  async generateReport(
    matches: NameMatch[],
    options: {
      filename?: string;
      includeStats?: boolean;
      includeLearning?: boolean;
    } = {},
  ): Promise<string> {
    const {
      filename = 'document_intelligence_report.xlsx',
      includeStats = true,
      includeLearning = true,
    } = options;

    const outputPath = path.join(this.config.outputPath!, filename);

    try {
      // Ensure output directory exists
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      // Create workbook with multiple sheets
      const workbook = XLSX.utils.book_new();

      // Main results sheet
      this.addMainResultsSheet(workbook, matches);

      // Statistics sheet
      if (includeStats) {
        this.addStatisticsSheet(workbook, matches);
      }

      // Processing details sheet
      this.addProcessingDetailsSheet(workbook, matches);

      // Summary dashboard sheet
      this.addSummarySheet(workbook, matches);

      // Write the workbook
      XLSX.writeFile(workbook, outputPath);

      console.log(`📊 Excel report generated: ${outputPath}`);
      return outputPath;
    } catch (error) {
      console.error('Failed to generate Excel report:', error);
      throw error;
    }
  }

  /**
   * Add main results sheet
   */
  private addMainResultsSheet(
    workbook: XLSX.WorkBook,
    matches: NameMatch[],
  ): void {
    const data = [
      [
        'Input Name',
        'Found In Document',
        'Document Date',
        'Found Variant',
        'Processing Method',
        'Section Title',
        'Content',
        'Action Date Content',
        'Reason',
        'Summary',
        'Action Date',
        'Confidence (%)',
        'NLP Sentiment',
        'Context Type',
        'Entity Context',
      ],
    ];

    for (const match of matches) {
      const summaryParts: string[] = [];

      if (match.extractedInfo?.sectionTitle) {
        summaryParts.push(match.extractedInfo.sectionTitle);
      }
      if (match.extractedInfo?.content) {
        if (summaryParts.length > 0) summaryParts.push('');
        summaryParts.push(match.extractedInfo.content);
      }
      if (match.extractedInfo?.actionDateContent) {
        summaryParts.push(match.extractedInfo.actionDateContent);
      }
      if (match.extractedInfo?.reason) {
        summaryParts.push(match.extractedInfo.reason);
      }

      const summary = summaryParts.join('\n');
      const sentimentLabel = match.nlpContext?.sentimentScore
        ? `${(match.nlpContext.sentimentScore * 100).toFixed(1)}%`
        : 'N/A';

      const processingMethodLabel = this.getProcessingMethodLabel(
        match.processingMethod,
      );

      data.push([
        match.name,
        path.basename(match.documentPath || 'N/A'),
        match.extractedInfo?.documentDate || 'N/A',
        match.declension,
        processingMethodLabel,
        match.extractedInfo?.sectionTitle || 'N/A',
        match.extractedInfo?.content || 'N/A',
        match.extractedInfo?.actionDateContent || 'N/A',
        match.extractedInfo?.reason || 'N/A',
        summary,
        match.extractedInfo?.actionDate || 'N/A',
        `${(match.confidence * 100).toFixed(2)}%`,
        sentimentLabel,
        this.getContextTypeLabel(match.nlpContext),
        match.nlpContext?.entityContext || 'N/A',
      ]);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    worksheet['!cols'] = [
      { wch: 25 }, // Input Name
      { wch: 40 }, // Found In Document
      { wch: 15 }, // Document Date
      { wch: 30 }, // Found Variant
      { wch: 15 }, // Processing Method
      { wch: 40 }, // Section Title
      { wch: 50 }, // Content
      { wch: 30 }, // Action Date Content
      { wch: 40 }, // Reason
      { wch: 60 }, // Summary
      { wch: 15 }, // Action Date
      { wch: 12 }, // Confidence
      { wch: 12 }, // NLP Sentiment
      { wch: 20 }, // Context Type
      { wch: 40 }, // Entity Context
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Main Results');
  }

  /**
   * Add statistics sheet
   */
  private addStatisticsSheet(
    workbook: XLSX.WorkBook,
    matches: NameMatch[],
  ): void {
    const data = [
      ['=== DOCUMENT INTELLIGENCE STATISTICS ==='],
      [''],
      ['Processing Summary'],
      ['Total Matches Found:', matches.length],
      ['Unique Names Found:', new Set(matches.map((m) => m.name)).size],
      ['Unique Documents:', new Set(matches.map((m) => m.documentPath)).size],
      [''],
      ['Processing Methods'],
      [
        'Intelligent Processing:',
        matches.filter((m) => m.processingMethod === 'intelligent').length,
      ],
      [
        'Fallback Processing:',
        matches.filter((m) => m.processingMethod === 'fallback').length,
      ],
      [
        'Search-Based Processing:',
        matches.filter((m) => m.processingMethod === 'search').length,
      ],
      [''],
      ['Confidence Distribution'],
      [
        'High Confidence (>90%):',
        matches.filter((m) => m.confidence > 0.9).length,
      ],
      [
        'Medium Confidence (70-90%):',
        matches.filter((m) => m.confidence > 0.7 && m.confidence <= 0.9).length,
      ],
      [
        'Low Confidence (<70%):',
        matches.filter((m) => m.confidence <= 0.7).length,
      ],
      [''],
      [
        'Average Confidence:',
        `${((matches.reduce((sum, m) => sum + m.confidence, 0) / Math.max(1, matches.length)) * 100).toFixed(1)}%`,
      ],
      [''],
      ['Context Analysis'],
      [
        'With Date Context:',
        matches.filter((m) => m.nlpContext?.hasDateContext).length,
      ],
      [
        'With Action Context:',
        matches.filter((m) => m.nlpContext?.hasActionContext).length,
      ],
      [
        'With Position Context:',
        matches.filter((m) => m.nlpContext?.hasPositionContext).length,
      ],
      [
        'With Reason Context:',
        matches.filter((m) => m.nlpContext?.hasReasonContext).length,
      ],
      [''],
      ['Sentiment Distribution'],
    ];

    // Add sentiment statistics if available
    const sentimentCounts = {
      positive: 0,
      negative: 0,
      neutral: 0,
      unknown: 0,
    };
    matches.forEach((match) => {
      if (match.nlpContext?.sentimentScore) {
        if (match.nlpContext.sentimentScore > 0.6) sentimentCounts.positive++;
        else if (match.nlpContext.sentimentScore < 0.4)
          sentimentCounts.negative++;
        else sentimentCounts.neutral++;
      } else {
        sentimentCounts.unknown++;
      }
    });

    data.push(
      ['Positive Sentiment:', sentimentCounts.positive],
      ['Negative Sentiment:', sentimentCounts.negative],
      ['Neutral Sentiment:', sentimentCounts.neutral],
      ['Unknown Sentiment:', sentimentCounts.unknown],
    );

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    worksheet['!cols'] = [{ wch: 40 }, { wch: 20 }];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Statistics');
  }

  /**
   * Add processing details sheet
   */
  private addProcessingDetailsSheet(
    workbook: XLSX.WorkBook,
    matches: NameMatch[],
  ): void {
    const data = [
      [
        'Name',
        'Document',
        'Position',
        'Processing Method',
        'Confidence',
        'Processing Time (ms)',
        'Context Confidence',
        'Has Date Context',
        'Has Action Context',
        'Context Type',
      ],
    ];

    for (const match of matches) {
      data.push([
        match.name,
        path.basename(match.documentPath || 'N/A'),
        match.position,
        this.getProcessingMethodLabel(match.processingMethod),
        (match.confidence * 100).toFixed(2) + '%',
        match.nlpContext?.processingTime || 'N/A',
        match.nlpContext?.confidence
          ? (match.nlpContext.confidence * 100).toFixed(1) + '%'
          : 'N/A',
        match.nlpContext?.hasDateContext ? 'Yes' : 'No',
        match.nlpContext?.hasActionContext ? 'Yes' : 'No',
        this.getContextTypeLabel(match.nlpContext) || 'N/A',
      ]);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    worksheet['!cols'] = [
      { wch: 25 }, // Name
      { wch: 30 }, // Document
      { wch: 10 }, // Position
      { wch: 18 }, // Processing Method
      { wch: 12 }, // Confidence
      { wch: 15 }, // Processing Time
      { wch: 15 }, // Context Confidence
      { wch: 15 }, // Has Date Context
      { wch: 15 }, // Has Action Context
      { wch: 15 }, // Context Type
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Processing Details');
  }

  /**
   * Add summary dashboard sheet
   */
  private addSummarySheet(workbook: XLSX.WorkBook, matches: NameMatch[]): void {
    const data = [
      ['=== DOCUMENT INTELLIGENCE SUMMARY DASHBOARD ==='],
      [''],
      ['📊 QUICK STATS'],
      ['Total Matches:', matches.length],
      [
        'Success Rate:',
        `${((matches.length / Math.max(1, matches.length)) * 100).toFixed(1)}%`,
      ],
      [
        'Average Confidence:',
        `${((matches.reduce((sum, m) => sum + m.confidence, 0) / Math.max(1, matches.length)) * 100).toFixed(1)}%`,
      ],
      [''],
      ['🎯 TOP PERFORMING METHODS'],
    ];

    // Calculate method performance
    const methodStats = new Map<
      string,
      { count: number; avgConfidence: number }
    >();
    matches.forEach((match) => {
      const method = match.processingMethod || 'unknown';
      const existing = methodStats.get(method) || {
        count: 0,
        avgConfidence: 0,
      };
      existing.count++;
      existing.avgConfidence =
        (existing.avgConfidence * (existing.count - 1) + match.confidence) /
        existing.count;
      methodStats.set(method, existing);
    });

    Array.from(methodStats.entries())
      .sort((a, b) => b[1].avgConfidence - a[1].avgConfidence)
      .forEach(([method, stats]) => {
        data.push([
          `${this.getProcessingMethodLabel(method)}:`,
          `${stats.count} matches (${(stats.avgConfidence * 100).toFixed(1)}% avg confidence)`,
        ]);
      });

    data.push(
      [''],
      ['📈 CONFIDENCE BREAKDOWN'],
      ['Excellent (>95%):', matches.filter((m) => m.confidence > 0.95).length],
      [
        'Good (85-95%):',
        matches.filter((m) => m.confidence > 0.85 && m.confidence <= 0.95)
          .length,
      ],
      [
        'Fair (70-85%):',
        matches.filter((m) => m.confidence > 0.7 && m.confidence <= 0.85)
          .length,
      ],
      ['Poor (<70%):', matches.filter((m) => m.confidence <= 0.7).length],
      [''],
      ['🔍 CONTEXT ANALYSIS'],
      [
        'Rich Context (4+ features):',
        matches.filter((m) => this.countContextFeatures(m.nlpContext) >= 4)
          .length,
      ],
      [
        'Good Context (2-3 features):',
        matches.filter(
          (m) =>
            this.countContextFeatures(m.nlpContext) >= 2 &&
            this.countContextFeatures(m.nlpContext) < 4,
        ).length,
      ],
      [
        'Limited Context (1 feature):',
        matches.filter((m) => this.countContextFeatures(m.nlpContext) === 1)
          .length,
      ],
      [
        'No Context:',
        matches.filter((m) => this.countContextFeatures(m.nlpContext) === 0)
          .length,
      ],
      [''],
      ['📄 DOCUMENT COVERAGE'],
      [
        'Documents Processed:',
        new Set(matches.map((m) => m.documentPath)).size,
      ],
      [
        'Names per Document (avg):',
        (
          matches.length /
          Math.max(1, new Set(matches.map((m) => m.documentPath)).size)
        ).toFixed(1),
      ],
    );

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    worksheet['!cols'] = [{ wch: 35 }, { wch: 50 }];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Summary Dashboard');
  }

  /**
   * Get processing method label
   */
  private getProcessingMethodLabel(method?: string): string {
    switch (method) {
      case 'intelligent':
        return '🧠 Intelligent NLP';
      case 'fallback':
        return '🔧 Fallback Processing';
      case 'search':
        return '🔍 Search-Based';
      case 'adaptive':
        return '🎯 Adaptive Learning';
      default:
        return '❓ Unknown';
    }
  }

  /**
   * Get context type label
   */
  private getContextTypeLabel(nlpContext?: any): string {
    if (!nlpContext) return 'No Context';

    const features = [];
    if (nlpContext.hasDateContext) features.push('Date');
    if (nlpContext.hasActionContext) features.push('Action');
    if (nlpContext.hasPositionContext) features.push('Position');
    if (nlpContext.hasReasonContext) features.push('Reason');
    if (nlpContext.sentimentScore !== undefined) features.push('Sentiment');

    return features.length > 0 ? features.join(', ') : 'Basic';
  }

  /**
   * Count context features
   */
  private countContextFeatures(nlpContext?: any): number {
    if (!nlpContext) return 0;

    let count = 0;
    if (nlpContext.hasDateContext) count++;
    if (nlpContext.hasActionContext) count++;
    if (nlpContext.hasPositionContext) count++;
    if (nlpContext.hasReasonContext) count++;
    if (nlpContext.sentimentScore !== undefined) count++;
    if (nlpContext.entityContext) count++;

    return count;
  }

  /**
   * Generate quick summary report (lightweight version)
   */
  async generateQuickReport(
    matches: NameMatch[],
    filename = 'quick_report.xlsx',
  ): Promise<string> {
    const outputPath = path.join(this.config.outputPath!, filename);

    try {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      const workbook = XLSX.utils.book_new();

      // Only main results sheet for quick report
      this.addMainResultsSheet(workbook, matches);

      XLSX.writeFile(workbook, outputPath);

      console.log(`📋 Quick report generated: ${outputPath}`);
      return outputPath;
    } catch (error) {
      console.error('Failed to generate quick report:', error);
      throw error;
    }
  }
}
