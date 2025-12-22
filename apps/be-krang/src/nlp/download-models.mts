import { env, pipeline } from '@huggingface/transformers';

// Set cache directory
env.cacheDir = './models';

// Configure progress callback
env.allowLocalModels = false;
env.allowRemoteModels = true;

async function downloadModels() {
  console.log('Starting model download...');

  try {
    console.log('Downloading BERT multilingual model...');
    const tokenClassifier = await pipeline(
      'token-classification',
      'Xenova/bert-base-multilingual-cased',
      {
        // aggregation_strategy: 'simple',
        progress_callback: (progress: any) => {
          if (progress.status === 'downloading') {
            const percent = ((progress.loaded / progress.total) * 100).toFixed(
              1,
            );
            process.stdout.write(
              `\r📥 BERT Model: ${percent}% (${(progress.loaded / 1024 / 1024).toFixed(1)}MB / ${(progress.total / 1024 / 1024).toFixed(1)}MB)`,
            );
          } else if (progress.status === 'done') {
            console.log(`\n✓ ${progress.file} downloaded`);
          } else if (progress.status === 'ready') {
            console.log('\n✓ BERT model ready');
          }
        },
      },
    );
    console.log('✓ BERT model downloaded');

    console.log('\nDownloading multilingual embedding model...');
    const embedder = await pipeline(
      'feature-extraction',
      'Xenova/multilingual-e5-small',
      {
        progress_callback: (progress: any) => {
          if (progress.status === 'downloading') {
            const percent = ((progress.loaded / progress.total) * 100).toFixed(
              1,
            );
            process.stdout.write(
              `\r📥 E5 Model: ${percent}% (${(progress.loaded / 1024 / 1024).toFixed(1)}MB / ${(progress.total / 1024 / 1024).toFixed(1)}MB)`,
            );
          } else if (progress.status === 'done') {
            console.log(`\n✓ ${progress.file} downloaded`);
          } else if (progress.status === 'ready') {
            console.log('\n✓ E5 model ready');
          }
        },
      },
    );
    console.log('✓ Embedding model downloaded');

    console.log('\nAll models downloaded successfully!');
    console.log('Models are cached in:', env.cacheDir);

    // Test the models
    console.log('\nTesting models...');
    const testText = 'Іван Петренко працює в офісі.';
    const entities = await tokenClassifier(testText);
    console.log('Test entities found:', entities.length);

    const embedding = await embedder('Тест', {
      pooling: 'mean',
      normalize: true,
    });
    console.log('Test embedding dimensions:', embedding.data.length);
  } catch (error) {
    console.error('Error downloading models:', error);
  }
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  downloadModels();
}

export { downloadModels };
