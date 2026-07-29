import { unzip, zip } from './zip';

interface DocxTemplateSource {
  file: File | Blob | ArrayBuffer | Uint8Array;
  fileName?: string;
}

interface DocxTag {
  // Accepts either "{{NAME}}" or bare "NAME" — normalized internally before matching.
  tag: string;
  value: string;
}

interface DocxTemplateJob {
  // Echoed back on the matching output file(s); defaults to the job's index in the batch.
  id?: string;
  tags: DocxTag[];
  // Caller-supplied output filename for this job (without extension) —
  // falls back to `${templateBaseName}_${id}` when omitted. Only meaningful
  // in 'separate' layout, where each job maps to its own file.
  fileName?: string;
}

type DocxBatchLayout =
  | { mode: 'separate' }
  | {
      mode: 'merged';
      jobBreak: 'page' | 'paragraph';
      // Caller-supplied output filename for the merged file (without
      // extension) — falls back to the single job's own fileName when there's
      // only one job, else `${templateBaseName}_merged`.
      fileName?: string;
    };

interface GenerateDocxBatchParams {
  template: DocxTemplateSource;
  jobs: DocxTemplateJob[];
  layout?: DocxBatchLayout;
}

interface GenerateDocxBatchFile {
  // Ids of the jobs represented in this file — length 1 unless layout.mode is 'merged'.
  jobIds: string[];
  blob: Blob;
  fileName: string;
}

interface GenerateDocxBatchResult {
  files: GenerateDocxBatchFile[];
}

interface ParsedDocxTemplate {
  entries: Map<string, Uint8Array>;
  documentXmlText: string;
  // Headers/footers are separate OOXML parts (word/header1.xml, etc.),
  // scanned unconditionally — filling one that isn't actually referenced by
  // the template's section properties is harmless.
  headerFooterXmlByPath: Map<string, string>;
  isMacroEnabled: boolean;
  baseFileName: string;
}

const WORD_NAMESPACE =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DOCUMENT_XML_PATH = 'word/document.xml';
const HEADER_FOOTER_PATH_PATTERN = /^word\/(header|footer)\d*\.xml$/;
const TAG_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

const parseXmlOrThrow = (xml: string, partPath: string): Document => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`DocxTemplateEngine: failed to parse ${partPath} as XML`);
  }
  return doc;
};

// A run's only substantive child besides <w:rPr> must be a single <w:t> for
// it to be safe to merge/replace as plain text — runs containing breaks,
// tabs, drawings, fields, etc. are left untouched.
const getSoleTextElement = (run: Element): Element | null => {
  const contentChildren = Array.from(run.children).filter(
    (child) => child.localName !== 'rPr',
  );
  if (contentChildren.length !== 1) return null;
  const [only] = contentChildren;
  return only.localName === 't' && only.namespaceURI === WORD_NAMESPACE
    ? only
    : null;
};

const serializeRunProperties = (run: Element): string => {
  const rPr = Array.from(run.children).find(
    (child) => child.localName === 'rPr',
  );
  return rPr ? new XMLSerializer().serializeToString(rPr) : '';
};

// Every distinct parent that directly holds one or more <w:r> runs — a
// paragraph, but also a hyperlink, tracked-change (ins/del), smartTag, sdt
// content wrapper, etc. Runs are only ever merged among their own direct
// siblings within ONE such container, never across a container boundary
// (e.g. never merging a run inside a hyperlink with one outside it).
const findRunContainers = (doc: Document): Element[] => {
  const containers = new Set<Element>();
  Array.from(doc.getElementsByTagNameNS(WORD_NAMESPACE, 'r')).forEach((run) => {
    if (run.parentElement) containers.add(run.parentElement);
  });
  return Array.from(containers);
};

// Word frequently splits one visibly-continuous string (e.g. "{{DATE}}")
// across multiple <w:r> runs with identical formatting (spellcheck/autocorrect
// boundaries). Merging adjacent same-formatted text-only runs within a
// container is a lossless no-op visually, and lets the later tag-replace
// pass see the whole tag in one run's text.
const mergeSiblingRunsInContainer = (container: Element) => {
  const directRuns = Array.from(container.children).filter(
    (child) => child.localName === 'r' && child.namespaceURI === WORD_NAMESPACE,
  );

  for (let i = 0; i < directRuns.length - 1;) {
    const current = directRuns[i];
    const next = directRuns[i + 1];
    const currentText = getSoleTextElement(current);
    const nextText = getSoleTextElement(next);

    if (
      currentText &&
      nextText &&
      serializeRunProperties(current) === serializeRunProperties(next)
    ) {
      currentText.textContent =
        (currentText.textContent ?? '') + (nextText.textContent ?? '');
      currentText.setAttribute('xml:space', 'preserve');
      next.remove();
      directRuns.splice(i + 1, 1);
      continue;
    }
    i++;
  }
};

const replaceTagsInRun = (run: Element, tagValues: Map<string, string>) => {
  const textEl = getSoleTextElement(run);
  if (!textEl) return;

  const original = textEl.textContent ?? '';
  const replaced = original.replace(TAG_PATTERN, (match, tagName) =>
    tagValues.has(tagName) ? tagValues.get(tagName)! : match,
  );

  if (replaced !== original) {
    textEl.textContent = replaced;
    textEl.setAttribute('xml:space', 'preserve');
  }
};

// Fills any WordprocessingML part's XML — word/document.xml, or a
// word/header*.xml / word/footer*.xml part, they're all the same shape.
const fillOoxmlPart = (
  partPath: string,
  xmlText: string,
  tags: DocxTag[],
): string => {
  const tagValues = new Map<string, string>();
  tags.forEach(({ tag, value }) => {
    tagValues.set(tag.replace(/^\{\{|\}\}$/g, '').trim(), value);
  });

  const doc = parseXmlOrThrow(xmlText, partPath);

  findRunContainers(doc).forEach((container) =>
    mergeSiblingRunsInContainer(container),
  );

  Array.from(doc.getElementsByTagNameNS(WORD_NAMESPACE, 'r')).forEach((run) =>
    replaceTagsInRun(run, tagValues),
  );

  return new XMLSerializer().serializeToString(doc);
};

const buildPageBreakParagraph = (doc: Document): Element => {
  const p = doc.createElementNS(WORD_NAMESPACE, 'w:p');
  const r = doc.createElementNS(WORD_NAMESPACE, 'w:r');
  const br = doc.createElementNS(WORD_NAMESPACE, 'w:br');
  br.setAttribute('w:type', 'page');
  r.appendChild(br);
  p.appendChild(r);
  return p;
};

// Splices multiple already-filled document.xml bodies into one, in order,
// keeping exactly one <w:sectPr> (they're all identical copies of the same
// template's section properties) at the very end of the merged body.
const mergeFilledDocuments = (
  filledXmlStrings: string[],
  jobBreak: 'page' | 'paragraph',
): string => {
  const documents = filledXmlStrings.map((xml) =>
    parseXmlOrThrow(xml, DOCUMENT_XML_PATH),
  );
  const targetDoc = documents[0];
  const targetBody = targetDoc.getElementsByTagNameNS(
    WORD_NAMESPACE,
    'body',
  )[0];

  let sharedSectPr: Element | null = null;
  const bodyChildSets = documents.map((doc) => {
    const body = doc.getElementsByTagNameNS(WORD_NAMESPACE, 'body')[0];
    const children = Array.from(body.children);
    const sectPr = children.find(
      (child) =>
        child.localName === 'sectPr' && child.namespaceURI === WORD_NAMESPACE,
    );
    if (sectPr && !sharedSectPr) sharedSectPr = sectPr;
    return sectPr ? children.filter((child) => child !== sectPr) : children;
  });

  while (targetBody.firstChild) targetBody.removeChild(targetBody.firstChild);

  bodyChildSets.forEach((children, index) => {
    children.forEach((child) => {
      targetBody.appendChild(targetDoc.importNode(child, true));
    });
    if (index < bodyChildSets.length - 1 && jobBreak === 'page') {
      targetBody.appendChild(buildPageBreakParagraph(targetDoc));
    }
  });

  if (sharedSectPr) {
    targetBody.appendChild(targetDoc.importNode(sharedSectPr, true));
  }

  return new XMLSerializer().serializeToString(targetDoc);
};

class DocxTemplateEngine {
  static async generateBatch(
    params: GenerateDocxBatchParams,
  ): Promise<GenerateDocxBatchResult> {
    const { template, jobs, layout = { mode: 'separate' } } = params;

    if (jobs.length === 0) {
      throw new Error(
        'DocxTemplateEngine.generateBatch: jobs must contain at least one entry',
      );
    }

    const parsed = await this.parseTemplate(template);

    if (layout.mode === 'merged') {
      const blob = await this.buildDocument(
        parsed,
        jobs.map((job) => job.tags),
        layout.jobBreak,
      );
      // A "merged" batch of exactly one job is functionally the same as
      // 'separate' mode with one job — reuse that job's own fileName too.
      const fileNameOverride =
        layout.fileName ?? (jobs.length === 1 ? jobs[0].fileName : undefined);
      return {
        files: [
          {
            jobIds: jobs.map((job, index) => job.id ?? String(index)),
            blob,
            fileName: this.buildFileName(parsed, 'merged', fileNameOverride),
          },
        ],
      };
    }

    const blobs = await Promise.all(
      jobs.map((job) => this.buildDocument(parsed, [job.tags], null)),
    );

    const usedFileNameCounts = new Map<string, number>();
    const files = jobs.map((job, index) => {
      const jobId = job.id ?? String(index);
      return {
        jobIds: [jobId],
        blob: blobs[index],
        fileName: this.buildFileName(
          parsed,
          jobId,
          job.fileName,
          usedFileNameCounts,
        ),
      };
    });

    return { files };
  }

  private static async parseTemplate(
    source: DocxTemplateSource,
  ): Promise<ParsedDocxTemplate> {
    const bytes = await this.readSourceBytes(source.file);
    const baseFileName = this.resolveBaseFileName(source);
    const isMacroEnabled = this.resolveIsMacroEnabled(source);

    const entries = await unzip(bytes);
    const documentXmlBytes = entries.get(DOCUMENT_XML_PATH);
    if (!documentXmlBytes) {
      throw new Error(
        `DocxTemplateEngine.parseTemplate: template is missing ${DOCUMENT_XML_PATH} — not a valid .docx/.docm file`,
      );
    }

    const decoder = new TextDecoder('utf-8');
    const headerFooterXmlByPath = new Map<string, string>();
    entries.forEach((data, path) => {
      if (HEADER_FOOTER_PATH_PATTERN.test(path)) {
        headerFooterXmlByPath.set(path, decoder.decode(data));
      }
    });

    return {
      entries,
      documentXmlText: decoder.decode(documentXmlBytes),
      headerFooterXmlByPath,
      isMacroEnabled,
      baseFileName,
    };
  }

  // Handles both layouts: one job's tags -> single doc, N jobs' tags + a
  // break -> merged doc built from N independently-filled copies. Headers
  // and footers are section-wide (not per-job), so for merged output there's
  // no single "correct" job to source their tag values from — the first
  // job's tags are used as a deterministic default.
  private static async buildDocument(
    parsed: ParsedDocxTemplate,
    jobsTagSets: DocxTag[][],
    jobBreak: 'page' | 'paragraph' | null,
  ): Promise<Blob> {
    const filledXmlStrings = jobsTagSets.map((tags) =>
      fillOoxmlPart(DOCUMENT_XML_PATH, parsed.documentXmlText, tags),
    );

    const finalXml =
      filledXmlStrings.length === 1
        ? filledXmlStrings[0]
        : mergeFilledDocuments(filledXmlStrings, jobBreak ?? 'page');

    const outputEntries = new Map(parsed.entries);
    outputEntries.set(DOCUMENT_XML_PATH, new TextEncoder().encode(finalXml));

    const headerFooterTags = jobsTagSets[0];
    parsed.headerFooterXmlByPath.forEach((originalXml, path) => {
      const filledPartXml = fillOoxmlPart(path, originalXml, headerFooterTags);
      outputEntries.set(path, new TextEncoder().encode(filledPartXml));
    });

    const zippedBytes = await zip(
      Array.from(outputEntries.entries()).map(([name, data]) => ({
        name,
        data,
      })),
    );

    // Same TS DOM-lib Uint8Array<ArrayBuffer> vs ArrayBufferLike friction as zip.ts.
    return new Blob([zippedBytes as any], {
      type: parsed.isMacroEnabled
        ? 'application/vnd.ms-word.document.macroEnabled.12'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  }

  private static async readSourceBytes(
    file: File | Blob | ArrayBuffer | Uint8Array,
  ): Promise<Uint8Array> {
    if (file instanceof Uint8Array) return file;
    if (file instanceof ArrayBuffer) return new Uint8Array(file);
    return new Uint8Array(await file.arrayBuffer());
  }

  private static resolveBaseFileName(source: DocxTemplateSource): string {
    const name =
      source.fileName ?? (source.file instanceof File ? source.file.name : '');
    if (!name) return 'document';
    const dotIndex = name.lastIndexOf('.');
    return dotIndex > 0 ? name.slice(0, dotIndex) : name;
  }

  private static resolveIsMacroEnabled(source: DocxTemplateSource): boolean {
    const name =
      source.fileName ?? (source.file instanceof File ? source.file.name : '');
    return name.toLowerCase().endsWith('.docm');
  }

  private static buildFileName(
    parsed: ParsedDocxTemplate,
    fallbackSuffix: string,
    overrideName?: string,
    usedFileNameCounts: Map<string, number> = new Map(),
  ): string {
    const ext = parsed.isMacroEnabled ? 'docm' : 'docx';
    const base = overrideName
      ? this.sanitizeFileNameSegment(overrideName)
      : `${parsed.baseFileName}_${fallbackSuffix}`;

    // Disambiguate within this batch — e.g. two jobs whose caller-supplied
    // fileName collide (same document, same matched text at two positions)
    // would otherwise silently overwrite each other on write.
    const seenCount = usedFileNameCounts.get(base) ?? 0;
    usedFileNameCounts.set(base, seenCount + 1);
    const disambiguatedBase =
      seenCount === 0 ? base : `${base} (${seenCount + 1})`;

    return `${disambiguatedBase}.${ext}`;
  }

  private static sanitizeFileNameSegment(name: string): string {
    return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'document';
  }
}

export { DocxTemplateEngine };
export type {
  DocxTemplateSource,
  DocxTag,
  DocxTemplateJob,
  DocxBatchLayout,
  GenerateDocxBatchParams,
  GenerateDocxBatchFile,
  GenerateDocxBatchResult,
};
