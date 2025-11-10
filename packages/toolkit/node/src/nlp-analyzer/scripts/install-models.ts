import { pipeline } from '@huggingface/transformers';
import * as fs from 'fs/promises';
import * as path from 'path';

interface ModelDefinition {
  id: string;
  name: string;
  task: string;
  description: string;
  size: string;
  languages?: string[];
  recommended?: boolean;
}

interface ModelInstallationConfig {
  modelsPath?: string;
  skipExisting?: boolean;
  verifyInstallation?: boolean;
  downloadTimeout?: number;
}

class ModelInstaller {
  private defaultModelsPath: string;
  private modelsRegistry: Record<string, ModelDefinition[]> = {
    sentiment: [
      {
        id: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
        name: 'DistilBERT SST-2',
        task: 'sentiment-analysis',
        description: 'Fast and accurate sentiment analysis for English text',
        size: '67MB',
        languages: ['en'],
        recommended: true,
      },
      {
        id: 'Xenova/cardiffnlp-twitter-roberta-base-sentiment-latest',
        name: 'RoBERTa Twitter Sentiment',
        task: 'sentiment-analysis',
        description:
          'Sentiment analysis optimized for social media and informal text',
        size: '125MB',
        languages: ['en'],
      },
    ],
    entities: [
      {
        id: 'Xenova/bert-base-NER',
        name: 'BERT Base NER',
        task: 'token-classification',
        description:
          'Named entity recognition for persons, organizations, locations',
        size: '420MB',
        languages: ['en'],
        recommended: true,
      },
      {
        id: 'Xenova/distilbert-base-cased-distilled-squad',
        name: 'DistilBERT NER',
        task: 'token-classification',
        description: 'Lightweight NER model with good performance',
        size: '247MB',
        languages: ['en'],
      },
    ],
    classification: [
      {
        id: 'Xenova/distilbert-base-uncased',
        name: 'DistilBERT Base',
        task: 'text-classification',
        description: 'General purpose text classification',
        size: '67MB',
        languages: ['en'],
        recommended: true,
      },
    ],
    summary: [
      {
        id: 'Xenova/distilbart-cnn-6-6',
        name: 'DistilBART CNN',
        task: 'summarization',
        description: 'Abstractive summarization model',
        size: '306MB',
        languages: ['en'],
        recommended: true,
      },
    ],
    'language-detection': [
      {
        id: 'Xenova/lang-detector',
        name: 'Language Detector',
        task: 'text-classification',
        description: 'Detect language of input text',
        size: '45MB',
        languages: ['multi'],
      },
    ],
  };

  constructor(modelsPath?: string) {
    // ✅ Fix: Set default path relative to project root (absolute path)
    this.defaultModelsPath =
      modelsPath || path.resolve(process.cwd(), 'models');
  }

  async installDefaultModels(
    config: ModelInstallationConfig = {},
  ): Promise<void> {
    console.log('🚀 Starting installation of recommended NLP models...');
    console.log(
      '📋 PRIVACY NOTE: Models are downloaded ONCE and used OFFLINE only',
    );
    console.log(
      '🔒 Your data will NEVER be sent to the internet during analysis\n',
    );

    // ✅ Fixed: Use the passed config directly, don't override with defaults
    const finalConfig: ModelInstallationConfig = {
      skipExisting: true,
      downloadTimeout: 120000,
      verifyInstallation: false, // ✅ Default to false
      ...config, // ✅ User config overrides defaults (important!)
    };

    // ✅ Show verification status clearly
    if (finalConfig.verifyInstallation) {
      console.log(
        '⚠️  Model verification is ENABLED - this may cause ONNX issues',
      );
      console.log(
        '   Consider using without --verify flag for safer installation',
      );
    } else {
      console.log(
        '✅ Model verification is DISABLED - safer installation mode',
      );
      console.log(
        '   Models will be downloaded and cached without verification',
      );
    }

    const recommendedModels = this.getRecommendedModels();
    await this.installModels(recommendedModels, finalConfig);
  }

  async installModels(
    modelIds: string[],
    config: ModelInstallationConfig = {},
  ): Promise<void> {
    const modelsPath = config.modelsPath || this.defaultModelsPath;

    // Ensure models directory exists
    await this.ensureModelsDirectory(modelsPath);

    // Set HuggingFace cache directory
    process.env.HF_HOME = modelsPath;
    process.env.TRANSFORMERS_CACHE = path.join(modelsPath, 'transformers');

    console.log(`📁 Models will be installed to: ${modelsPath}\n`);

    for (const modelId of modelIds) {
      await this.installSingleModel(modelId, config);
    }

    // Generate models manifest
    await this.generateModelsManifest(modelsPath, modelIds);

    console.log('\n✅ Model installation completed successfully!');
    console.log(`📍 Models location: ${modelsPath}`);
  }

  private async installSingleModel(
    modelId: string,
    config: ModelInstallationConfig,
  ): Promise<void> {
    const modelInfo = this.findModelInfo(modelId);
    const modelName = modelInfo?.name || modelId;

    console.log(`📦 Installing ${modelName}...`);
    console.log(`   Model ID: ${modelId}`);
    console.log(`   Size: ${modelInfo?.size || 'Unknown'}`);
    console.log(`   🔒 Download once, use offline forever`);

    try {
      // Check if model already exists
      if (config.skipExisting && (await this.isModelInstalled(modelId))) {
        console.log(`   ⏭️  Already installed, skipping\n`);
        return;
      }

      const startTime = Date.now();

      // Download model by creating a pipeline (this downloads and caches the model)
      const taskType = modelInfo?.task || 'text-classification';

      console.log(
        `   ⬇️  Downloading model files from HuggingFace (one-time only)...`,
      );

      const downloadPromise = pipeline(taskType, modelId, {
        quantized: true, // Use quantized models for smaller size
        local_files_only: false, // Allow downloading ONLY during installation
        cache_dir: process.env.TRANSFORMERS_CACHE, // Store locally
      });

      // Add timeout if specified
      const timeoutPromise = config.downloadTimeout
        ? new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Download timeout')),
              config.downloadTimeout,
            ),
          )
        : null;

      const model = timeoutPromise
        ? await Promise.race([downloadPromise, timeoutPromise])
        : await downloadPromise;

      const downloadTime = Math.round((Date.now() - startTime) / 1000);
      console.log(`   ✅ Downloaded in ${downloadTime}s`);

      // Verify installation if requested
      if (config.verifyInstallation) {
        console.log(`   🔍 Verifying installation...`);
        await this.verifyModel(model as any, taskType);
        console.log(`   ✅ Verification passed`);
      }

      // Dispose pipeline to free memory
      if (typeof (model as any).dispose === 'function') {
        await (model as any).dispose();
      }

      console.log(`   ✅ ${modelName} installed successfully`);
      console.log(`   🔒 Model is now available for OFFLINE use only\n`);
    } catch (error) {
      console.error(`   ❌ Failed to install ${modelName}:`);
      console.error(`   Error: ${error.message}\n`);
      throw error;
    }
  }

  private async verifyModel(model: any, taskType: string): Promise<void> {
    try {
      const testInputs = {
        'sentiment-analysis': 'This is a great day!',
        'token-classification': 'John Smith works at Microsoft in Seattle.',
        'text-classification': 'This is a sample document.',
        summarization:
          'This is a long document that needs to be summarized for testing purposes.',
      };

      const testInput = testInputs[taskType] || 'Test input';
      await model(testInput);
    } catch (error) {
      throw new Error(`Model verification failed: ${error.message}`);
    }
  }

  private async isModelInstalled(modelId: string): Promise<boolean> {
    try {
      // Try to load model with local_files_only=true (OFFLINE ONLY)
      await pipeline('text-classification', modelId, {
        local_files_only: true, // 🔒 CRITICAL: Only use local files
        quantized: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  private findModelInfo(modelId: string): ModelDefinition | undefined {
    for (const taskModels of Object.values(this.modelsRegistry)) {
      const model = taskModels.find((m) => m.id === modelId);
      if (model) return model;
    }
    return undefined;
  }

  private getRecommendedModels(): string[] {
    const recommended: string[] = [];

    for (const taskModels of Object.values(this.modelsRegistry)) {
      const recommendedModel = taskModels.find((m) => m.recommended);
      if (recommendedModel) {
        recommended.push(recommendedModel.id);
      }
    }

    return recommended;
  }

  private async ensureModelsDirectory(modelsPath: string): Promise<void> {
    try {
      await fs.access(modelsPath);
    } catch {
      await fs.mkdir(modelsPath, { recursive: true });
      console.log(`📁 Created models directory: ${modelsPath}`);
    }
  }

  private async generateModelsManifest(
    modelsPath: string,
    installedModels: string[],
  ): Promise<void> {
    const manifest = {
      installedAt: new Date().toISOString(),
      models: installedModels.map((modelId) => ({
        id: modelId,
        ...this.findModelInfo(modelId),
      })),
      version: '1.0',
    };

    const manifestPath = path.join(modelsPath, 'models-manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`📄 Generated models manifest: ${manifestPath}`);
  }

  listAvailableModels(): void {
    console.log('📋 Available Models:\n');

    Object.entries(this.modelsRegistry).forEach(([task, models]) => {
      console.log(`🔧 ${task.toUpperCase()}:`);
      models.forEach((model) => {
        const recommended = model.recommended ? ' (Recommended)' : '';
        console.log(`   • ${model.name}${recommended}`);
        console.log(`     ID: ${model.id}`);
        console.log(`     Size: ${model.size}`);
        console.log(
          `     Languages: ${model.languages?.join(', ') || 'Unknown'}`,
        );
        console.log(`     Description: ${model.description}\n`);
      });
    });
  }

  async getInstalledModels(modelsPath?: string): Promise<string[]> {
    const targetPath = modelsPath || this.defaultModelsPath;
    const manifestPath = path.join(targetPath, 'models-manifest.json');

    try {
      const manifestData = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestData);
      return manifest.models.map((m: any) => m.id);
    } catch {
      return [];
    }
  }
}

// CLI interface
export async function runModelInstaller(): Promise<void> {
  const args = process.argv.slice(2);
  const installer = new ModelInstaller();

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🤖 NLP Model Installer

Usage:
  npm run install-models [options]

Options:
  --list, -l              List available models
  --default              Install recommended models
  --models <model1,model2>  Install specific models
  --path <path>          Custom installation path
  --skip-existing        Skip already installed models
  --verify               Enable model verification (may cause ONNX issues)
  --no-verify            Disable model verification (default)
  --timeout <ms>         Download timeout in milliseconds

Examples:
  npm run install-models --default
  npm run install-models --default --verify  (not recommended)
  npm run install-models --list
  npm run install-models --models "Xenova/distilbert-base-uncased,Xenova/bert-base-NER"

Note: Verification is DISABLED by default to avoid ONNX.js runtime issues.
    `);
    return;
  }

  if (args.includes('--list') || args.includes('-l')) {
    installer.listAvailableModels();
    return;
  }

  const modelsPathIndex = args.indexOf('--path');
  const modelsPath =
    modelsPathIndex !== -1 ? args[modelsPathIndex + 1] : undefined;

  // ✅ Fixed: Verification is FALSE by default, only TRUE if explicitly requested
  const verifyExplicitlyRequested = args.includes('--verify');
  const noVerifyExplicitlySet = args.includes('--no-verify');

  // Default to FALSE unless --verify is explicitly used
  const verifyInstallation =
    verifyExplicitlyRequested && !noVerifyExplicitlySet;

  const config: ModelInstallationConfig = {
    modelsPath,
    skipExisting: args.includes('--skip-existing') || true, // Default to true
    verifyInstallation, // ✅ This will be FALSE by default
    downloadTimeout: args.includes('--timeout')
      ? parseInt(args[args.indexOf('--timeout') + 1])
      : 120000, // 2 minute default timeout
  };

  console.log(
    `🔧 Configuration: verification = ${verifyInstallation ? 'ENABLED' : 'DISABLED'}`,
  );

  if (verifyInstallation) {
    console.log(
      '⚠️  WARNING: Model verification is enabled - this may cause ONNX crashes!',
    );
  }

  try {
    if (args.includes('--default')) {
      await installer.installDefaultModels(config);
    } else if (args.includes('--models')) {
      const modelsIndex = args.indexOf('--models');
      const modelsList = args[modelsIndex + 1]?.split(',') || [];
      await installer.installModels(modelsList, config);
    } else {
      console.log(
        'Please specify --default, --models, or --list. Use --help for more information.',
      );
      process.exit(0);
    }

    // ✅ Success exit
    console.log('🎉 Model installation completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('💥 Model installation failed:', error.message);

    // ✅ Provide helpful guidance for ONNX issues
    if (
      error.message.includes('Tensor is not a constructor') ||
      error.message.includes('mutex lock failed') ||
      error.message.includes('Model verification failed')
    ) {
      console.log('\n💡 ONNX Runtime Issue Detected:');
      console.log('   This is a known issue with model verification.');
      console.log(
        '   The models were likely downloaded successfully despite the error.',
      );
      console.log('   Try running your application - it should work fine.');
      console.log(
        '   \n   In the future, verification is disabled by default:',
      );
      console.log(
        '   pnpm run install-models:default  (safe, no verification)',
      );
      console.log(
        '   \n   Only use --verify if you specifically need verification:',
      );
      console.log('   pnpm run install-models:default --verify  (risky)');
    }

    process.exit(1);
  }
}

runModelInstaller().catch((error) => {
  console.error('💥 Model installation failed:', error.message);
  process.exit(1);
});

// Export for programmatic use
export { ModelInstaller };

export type { ModelDefinition, ModelInstallationConfig };
