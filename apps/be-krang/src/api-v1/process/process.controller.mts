import type { Request, Response } from 'express';
import { ReasonPhrases, StatusCodes } from 'http-status-codes';
import path from 'path';

import { DocumentIntelligenceService } from '../../features/document-intelligence-service/document-intelligence-service';
import { runtimePathById } from '../../supplement/index.mts';

interface BatchRequest {
  batchIndex?: number;
  totalBatches?: number;
  structure: any;
  files: Array<{
    path: string;
    name: string;
    content: string;
    size: number;
    modifiedAt: string;
  }>;
}

const postProcessDocuments = async (req: Request, res: Response) => {
  // Add timeout for the entire operation
  const PROCESSING_TIMEOUT = 10 * 60 * 1000; // 10 minutes
  let timeoutHandle: NodeJS.Timeout;
  let documentIntelligenceService: DocumentIntelligenceService | null = null;

  try {
    console.log('🚀 Starting intelligent document processing...');

    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error('Document processing timeout after 10 minutes'));
      }, PROCESSING_TIMEOUT);
    });

    // Create processing promise
    const processingPromise = async () => {
      // Initialize Document Intelligence Service with configuration
      documentIntelligenceService = new DocumentIntelligenceService({
        sourcePath: path.join(runtimePathById.assets, 'docs-for-nlp'),
        outputPath: path.join(runtimePathById.assets, 'nlp-output'),
        inputPath: path.join(runtimePathById.assets, 'nlp-input/data.xlsx'),
        batchSize: 10,
        concurrency: 2, // Reduced from 4 to 2 for better stability
        cacheEnabled: true,
        enableMonitoring: true,
        extensions: ['.doc', '.docx', '.txt'],
        maxFileSize: 50 * 1024 * 1024, // 50MB
        ukrainianStemming: true,
        useBM25: true,
        confidence: {
          entityThreshold: 0.7,
          nameMatchThreshold: 0.75,
          contextThreshold: 0.6,
        },
      });

      // Initialize the service
      await documentIntelligenceService.initialize();

      // Process documents using the new intelligent service
      const result = await documentIntelligenceService.processDocuments();

      // Get comprehensive statistics
      const stats = documentIntelligenceService.getStats();

      return { result, stats };
    };

    // Race between processing and timeout
    const { result, stats } = await Promise.race([
      processingPromise(),
      timeoutPromise,
    ]);

    // Clear timeout
    clearTimeout(timeoutHandle);

    // Dispose of resources
    if (documentIntelligenceService) {
      await documentIntelligenceService.dispose();
    }

    console.log('✅ Document processing completed successfully');

    res.status(StatusCodes.OK).json({
      message: ReasonPhrases.OK,
      result: {
        matches: result.matches.length,
        processingTime: result.totalProcessingTime,
        documentsProcessed: result.documentsProcessed,
        namesSearched: result.namesSearched,
        outputFile: result.outputFile,
        successRate:
          result.matches.length > 0
            ? ((result.matches.length / result.namesSearched) * 100).toFixed(
                1,
              ) + '%'
            : '0%',
      },
      stats: {
        megaSearch: stats.megaSearch,
        nlpAnalyzer: stats.nlpAnalyzer,
        ukrainianProcessor: stats.processor,
        contextExtractor: stats.extractor,
      },
      timing: {
        totalTime: result.totalProcessingTime,
        averagePerDocument:
          result.documentsProcessed > 0
            ? (result.totalProcessingTime / result.documentsProcessed).toFixed(
                0,
              ) + 'ms'
            : 'N/A',
        averagePerName:
          result.namesSearched > 0
            ? (result.totalProcessingTime / result.namesSearched).toFixed(0) +
              'ms'
            : 'N/A',
      },
    });

    /*
    // Legacy batch processing code (commented out for reference)
    const { batchIndex = 1, totalBatches = 1, files }: BatchRequest = req.body;

    console.log(
      `Processing documents batch ${batchIndex}/${totalBatches} with ${files.length} files`,
    );

    const processedFiles = [];
    const failedFiles = [];

    for (const fileData of files) {
      try {
        // Convert base64 content back to text/buffer depending on file type
        const isTextFile =
          fileData.name.endsWith('.txt') || fileData.name.endsWith('.json');
        const content = isTextFile
          ? Buffer.from(fileData.content, 'base64').toString('utf-8')
          : Buffer.from(fileData.content, 'base64');

        // Process the document (extract information using NLP)
        // For now, we'll create a simple processed result
        const processedResult = {
          originalFile: fileData.name,
          path: fileData.path,
          size: fileData.size,
          modifiedAt: fileData.modifiedAt,
          processedAt: new Date().toISOString(),
          content: isTextFile ? content : '[Binary file processed]',
          // Add any extracted information here
          extractedInfo: {
            // This would be populated by the actual NLP extraction
            processed: true,
            status: 'completed',
          },
        };

        processedFiles.push({
          name: appendExtension(fileData.name, '_processed.json'),
          content: JSON.stringify(processedResult, null, 2),
          relativePath: appendExtension(fileData.path, '_processed.json'),
          originalPath: fileData.path,
        });
      } catch (error) {
        failedFiles.push({
          fileName: fileData.name,
          path: fileData.path,
          error: error.message,
        });
      }
    }

    res.status(StatusCodes.OK).json({
      batchIndex,
      totalBatches,
      processedFiles,
      failedFiles,
      summary: {
        processed: processedFiles.length,
        failed: failedFiles.length,
      },
    });
    */
  } catch (error) {
    console.error('❌ Document processing error:', error);

    // Clear timeout if it exists
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    // Dispose of resources in case of error
    if (documentIntelligenceService) {
      try {
        await documentIntelligenceService.dispose();
      } catch (disposeError) {
        console.warn('⚠️ Error disposing service after error:', disposeError);
      }
    }

    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'DOCUMENT_PROCESSING_FAILED',
        message:
          error instanceof Error ? error.message : 'Document processing failed',
        details: ReasonPhrases.INTERNAL_SERVER_ERROR,
      },
    });
  }
};

export { postProcessDocuments };
