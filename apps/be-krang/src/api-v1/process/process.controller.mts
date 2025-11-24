import type { Request, Response } from 'express';
import { ReasonPhrases, StatusCodes } from 'http-status-codes';

import {
  DocumentIntelligenceService,
  ExcelReportGenerator,
} from '../../features/document-intelligence-service/index.mts';
import { InformationExtractor } from '../../nlp/information-extractor.mts';

const postProcessDocuments = async (req: Request, res: Response) => {
  try {
    // Get queries from bulkNames payload
    const bulkNames = req.body.bulkNames || '';
    const queries = bulkNames
      .split(/[,\n]/)
      .map((name) => name.trim())
      .filter((name) => name.length > 0);

    if (queries.length === 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        error: { message: 'No queries provided in bulkNames' },
      });
    }

    // Use DocumentIntelligenceService for search
    const documentIntelligenceService = new DocumentIntelligenceService();
    const excelReportGenerator = new ExcelReportGenerator();

    const searchResults =
      await documentIntelligenceService.searchDocuments(queries);

    const extractedResults =
      await InformationExtractor.extractSearchResults(searchResults);

    // Generate Excel report
    const reportFilename = `document-intelligence-report-${new Date().toISOString().split('T')[0]}.xlsx`;
    const reportRows = extractedResults.map((extractedResult) => ({
      inputName: extractedResult.searchQuery,
      foundInDocument: extractedResult.foundInDocument,
      documentDate: extractedResult.documentDate,
      foundDeclension: extractedResult.matchedText,
      sectionTitle: extractedResult.sectionTitle,
      content: extractedResult.content,
      actionDateContent: extractedResult.actionDateContent,
      reason: extractedResult.reason,
      summary: extractedResult.summary,
      actionDate: extractedResult.actionDate,
      status: extractedResult.status,
      commandType: extractedResult.commandType,

      // TODO:
      confidence: '',
    }));
    const reportPath = await excelReportGenerator.generateReport(
      reportRows,
      reportFilename,
    );

    res.status(StatusCodes.OK).json({
      success: true,
      totalQueries: queries.length,
      results: searchResults,
      extractedResults,
      reportPath,
      reportFilename,
    });
  } catch (error) {
    console.error('Process documents error:', error);

    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: ReasonPhrases.INTERNAL_SERVER_ERROR,
      },
    });
  }
};

export { postProcessDocuments };
