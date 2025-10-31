# NLP (Natural Language Processing) ninja

Examples for documents preparation and procession on local env.

# Table of Contents

- [Quick Start](#quick-start)
- [Running out of Docker](#running-out-of-docker)
- [Read MORE about NLP](./docs/about.md)

## Quick Start

```bash
pnpm i
```

### Document preparation

1. Process documents: put .doc / .docx into `assets/docs-to-convert` folder (sub-folders are supported) and run:

```bash
pnpm run doc:to-text
```

It will create `assets/docs-for-nlp` folder with \*.txt files - which are suitable for NLP procession.
NOTE: Setting-up the input / output folders available in `src/doc-to-text.mts` file.

2. Then, build the search index from your .txt files. This is a one-time step you only need to re-run if your documents change.

```bash
pnpm run doc:build-index
```

It will create `assets/nlp-index` folder with \*.json files - which are suitable for NLP procession.

### Document procession

!IMPORTANT: load models to local first:

```bash
pnpm run nlp:download-models
```

The example of NLP via variable available in `src/nlp-inline-example.mts`, while launching:

```bash
pnpm run nlp:demo--inline
```

When the indexes are created in `assets/nlp-index` folder, the next command could be executed:

```bash
pnpm run nlp:process-data
```

It will create `assets/nlp-output` folder with \*.xlsx file with matched results.

## Run from under Docker

1. Install dependencies:

```bash
# If you're using cmd.exe
docker run --rm -it -v "%cd%":/app -w /app node:22 bash -c "corepack enable && pnpm i"

# If you're using PowerShell
docker run --rm -it -v "${PWD}:/app" -w /app node:22 bash -c "corepack enable && pnpm i"
```

2. Run preffered pnpm script:

```bash
# If you're using cmd.exe
docker run --rm -v "%cd%":/app -w /app node:22 bash -c "npm run doc:to-text"

# If you're using PowerShell
docker run --rm -v "${PWD}:/app" -w /app node:22 bash -c "npm run doc:to-text"
```

OR - Build once, then reuse:

```bash
docker run -it -p 3000:3000 -v "${PWD}:/app" -w /app node:22 bash

# then inside
apt-get update && apt-get install -y antiword # required for `textract` to convert .doc to .txt
corepack enable
pnpm install
pnpm run doc:to-text
```

If you want to save that container state, you can commit it:

```bash
docker commit <container_id> node-with-antiword

# Then later just run:
docker run --rm -v "${PWD}:/app" -w /app node-with-antiword bash -c "pnpm run doc:to-text"
```

### Advanced Information Extraction

To extract detailed information (like the section, reason, and dates) for each found name, run the following command. This assumes you have already prepared the documents and built the index.

```bash
# to process documents
pnpm run nlp:extract-info --source=documents

# to process indexed files
pnpm run nlp:extract-info --source=index
```

This will create a new file `assets/nlp-output/extracted_info_adaptive.xlsx` with the detailed results and adaptive learning statistics.

### Adaptive Learning

The system now includes adaptive learning capabilities that improve matching accuracy over time without modifying the underlying AI models. The adaptive system:

- **Learns from feedback** to adjust matching thresholds
- **Persists learning** across sessions in `assets/adaptive-settings.json`
- **Provides performance metrics** showing accuracy improvements
- **Maintains model integrity** while optimizing application-level decisions

Run the adaptive demo:

```bash
pnpm run nlp:demo--adaptive
```

The transformer models themselves never change, but the system learns better ways to interpret their outputs for your specific use case.
