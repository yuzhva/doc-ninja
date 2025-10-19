# NLP (Natural Language Processing) ninja

Examples for documents preparation and procession on local env.

# Table of Contents

- [Quick Start](#quick-start)

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

### Document procession

!IMPORTANT: load models to local first:

```bash
pnpm run nlp:download-models
```

The example of NLP via variable available in `src/nlp-inline-example.mts`, while launching:

```bash
pnpm run nlp:example
```

After `assets/docs-for-nlp` the next command could be executed:

```bash
pnpm run nlp:process-data
```

It will create `assets/nlp-output` folder with \*.xlsx files with matched results.
