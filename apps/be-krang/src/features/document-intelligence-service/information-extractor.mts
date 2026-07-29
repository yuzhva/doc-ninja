import fs from 'fs/promises';

import type { SearchResult } from './index.mjs';

// Base type representing the search match context
type ExtractionInput = {
  searchQuery: string;
  foundInDocument: string;
  originalFilePath?: string;
  matchedText: string;
  position?: number;
};

// Config-driven extraction produces a dynamic set of fields (one per pipeline
// rule + one per compound), kept separate from the base match fields so
// consumers can tell "structural search info" and "schema-defined data"
// apart without guessing by key name.
type ExtractedFields = {
  [fieldId: string]: string | number | null | undefined;
};

type ExtractedInfo = ExtractionInput & {
  extractedFieldById: ExtractedFields;
};

type ExtractorStartFrom = 'DOC__START' | 'DOC__CONTENT' | 'DOC__END';
type ExtractorDirection = 'DIRECTION__TOP' | 'DIRECTION__BOTTOM';
type ExtractorUnit = 'PARAGRAPH' | 'LINE';
type ExtractorLimit = number | 'ULTIMATE';

// Only TABLE/SPREADSHEET are listed here because they're the only
// destinations WE render, so a flag can meaningfully gate them. A field's
// availability in a .docx template isn't ours to gate — every field is
// unconditionally insertable there as "{{<id>}}", the template file itself
// decides what actually gets used, so there's nothing to opt into.
type ExtractorOutputDestinationType = 'TABLE' | 'SPREADSHEET';

// One destination this field's value is surfaced in.
type ExtractorOutputDestination = {
  type: ExtractorOutputDestinationType;
};

// Presentation metadata only — never read by the extraction engine itself.
// Tells a consumer (table, spreadsheet export, ...) whether and how to
// surface this field, without needing a separate id-keyed lookup list to
// stay in sync.
type ExtractorOutput = {
  label: string;
  useIn: ExtractorOutputDestination[];
  // Marks this as the canonical text shown as a search result's body (e.g.
  // the expandable row content). At most one field/compound per schema
  // should set this.
  isPrimarySearchResponseText?: boolean;
};

type ExtractorRule = {
  id: string;
  startFrom?: ExtractorStartFrom;
  direction?: ExtractorDirection;
  unit?: ExtractorUnit;
  limit?: ExtractorLimit;
  // Regex source. When omitted, the rule just grabs the scanned unit(s) verbatim
  // (used to seed the base "content" field).
  pattern?: string;
  // Only meaningful together with `pattern`. Switches the rule from "find the
  // first match and stop" into "collect matches while walking, stop once a
  // collected unit also satisfies this pattern" (used for hierarchical titles).
  stopAt?: string;
  // When true, this rule's resolved value is stripped out of the `content`
  // field's value after extraction (e.g. reason / action period clauses that
  // are physically part of the same paragraph as the content).
  consume?: boolean;
  // Only meaningful for a verbatim rule (no `pattern`) anchored on the match.
  // Instead of returning the whole anchor unit, starts the returned text at
  // the beginning of the line containing the match — so a match buried deep
  // in a long paragraph doesn't force scrolling past unrelated leading text.
  clipToMatchLine?: boolean;
  output?: ExtractorOutput;
};

// A compound joins already-resolved fields (pipeline outputs, or earlier
// compounds in the same array) into one combined field.
type ExtractorCompound = {
  id: string;
  // Array of lines. A line that is exactly "{{fieldId}}" — same delimiter as
  // the .docx placeholder convention — is only included when that field has
  // a truthy value (no stray blank lines for missing fields). Any other line
  // has "{{fieldId}}" occurrences replaced inline (missing/falsy fields
  // become "", the rest of the line is kept as-is).
  value: string[];
  output?: ExtractorOutput;
};

type ExtractorConfig = {
  pipelines: ExtractorRule[];
  compounds?: ExtractorCompound[];
};

type ExtractorSchema = {
  name: string;
  config: ExtractorConfig;
};

type UnitSpan = { text: string; start: number; end: number };

// Greedily consumes an entire run of consecutive blank lines as ONE
// separator (2 blank lines and 5 blank lines both just mean "next
// paragraph") — otherwise a run of N newlines produces N-2 empty "phantom"
// paragraph units between real ones.
const PARAGRAPH_SEPARATOR = /(?:\n[ \t\r]*){2,}/g;

// Per-rule fallbacks when a config omits a field — owned by the engine, not
// by every config file, so schemas only ever state what's non-default.
const RULE_DEFAULTS: Required<
  Pick<ExtractorRule, 'startFrom' | 'direction' | 'unit' | 'limit' | 'consume'>
> = {
  startFrom: 'DOC__CONTENT',
  direction: 'DIRECTION__BOTTOM',
  unit: 'PARAGRAPH',
  limit: 'ULTIMATE',
  consume: false,
};

// Used whenever no schema is supplied (e.g. a brand-new install before the
// user has configured anything): just the paragraph surrounding the match.
const DEFAULT_EXTRACTOR_SCHEMA: ExtractorSchema = {
  name: 'DEFAULT_EXTRACTOR',
  config: {
    pipelines: [
      { id: 'content', unit: 'PARAGRAPH', limit: 1, clipToMatchLine: true },
    ],
    compounds: [{ id: 'summary', value: ['{{content}}'] }],
  },
};

class InformationExtractor {
  /**
   * Splits the whole document into blank-line-separated paragraph blocks,
   * keeping absolute character offsets so later steps can slice back into
   * the original content.
   */
  private static splitParagraphs(content: string): UnitSpan[] {
    const units: UnitSpan[] = [];
    let cursor = 0;
    let match: RegExpExecArray | null;

    PARAGRAPH_SEPARATOR.lastIndex = 0;
    while ((match = PARAGRAPH_SEPARATOR.exec(content))) {
      units.push({
        text: content.slice(cursor, match.index),
        start: cursor,
        end: match.index,
      });
      cursor = match.index + match[0].length;
    }
    units.push({
      text: content.slice(cursor),
      start: cursor,
      end: content.length,
    });

    return units;
  }

  /** Splits the whole document into newline-separated lines. */
  private static splitLines(content: string): UnitSpan[] {
    const units: UnitSpan[] = [];
    let cursor = 0;

    for (let i = 0; i <= content.length; i++) {
      if (i === content.length || content[i] === '\n') {
        units.push({ text: content.slice(cursor, i), start: cursor, end: i });
        cursor = i + 1;
      }
    }

    return units;
  }

  private static resolveUnits(
    content: string,
    unit: ExtractorUnit,
  ): UnitSpan[] {
    return unit === 'LINE'
      ? this.splitLines(content)
      : this.splitParagraphs(content);
  }

  private static findUnitIndexAt(units: UnitSpan[], position: number): number {
    for (let i = 0; i < units.length; i++) {
      if (position >= units[i].start && position <= units[i].end) return i;
    }
    return Math.max(0, units.length - 1);
  }

  private static resolveAnchorIndex(
    units: UnitSpan[],
    startFrom: ExtractorStartFrom,
    matchPosition: number,
  ): number {
    if (startFrom === 'DOC__START') return 0;
    if (startFrom === 'DOC__END') return units.length - 1;
    return this.findUnitIndexAt(units, matchPosition);
  }

  private static compilePattern(pattern: string): RegExp {
    // 'm' lets user patterns anchor on line boundaries with ^ / $.
    return new RegExp(pattern, 'm');
  }

  private static extractValue(text: string, pattern: string): string | null {
    const match = this.compilePattern(pattern).exec(text);
    if (!match) return null;

    const raw = match[1] !== undefined ? match[1] : match[0];
    return raw.replace(/\s+/g, ' ').trim() || null;
  }

  /**
   * Start of the line containing `position`, clamped to `boundStart` so it
   * never escapes the unit the caller is slicing within.
   */
  private static findLineStart(
    content: string,
    boundStart: number,
    position: number,
  ): number {
    const lastNewline = content.lastIndexOf('\n', position);
    return lastNewline < boundStart ? boundStart : lastNewline + 1;
  }

  /**
   * "Find first match and stop" rule: grows a text window unit-by-unit from
   * the anchor in `direction`, testing `pattern` after each expansion. When
   * `pattern` is omitted, just returns the verbatim text of the window once
   * it reaches its final size (used to seed the base `content` field).
   */
  private static runSingleValueRule(
    content: string,
    units: UnitSpan[],
    anchorIndex: number,
    direction: ExtractorDirection,
    limit: ExtractorLimit,
    pattern?: string,
    position?: number,
    clipToMatchLine?: boolean,
  ): string | null {
    if (anchorIndex < 0 || anchorIndex >= units.length) return null;

    let low = anchorIndex;
    let high = anchorIndex;
    const maxSteps = limit === 'ULTIMATE' ? units.length : Math.max(1, limit);
    // Blank units (e.g. documents with several consecutive blank lines
    // between clauses) don't count against `limit` — only units that
    // actually contain text do, so `limit` means "N real paragraphs"
    // regardless of how many stray blank lines separate them in the source.
    let nonEmptyUnitsSeen = units[anchorIndex].text.trim() ? 1 : 0;

    while (true) {
      // Only clip while the window's low edge is still the anchor unit
      // itself — once expansion walks past it (extra units above the match),
      // those units should be returned in full.
      const windowStart =
        clipToMatchLine && position !== undefined && low === anchorIndex
          ? this.findLineStart(content, units[low].start, position)
          : units[low].start;
      const windowText = content.slice(windowStart, units[high].end);

      if (!pattern) {
        const isFinalStep =
          nonEmptyUnitsSeen >= maxSteps ||
          (direction === 'DIRECTION__BOTTOM' && high === units.length - 1) ||
          (direction === 'DIRECTION__TOP' && low === 0);
        if (isFinalStep)
          return windowText.replace(/[ \t]+/g, ' ').trim() || null;
      } else {
        const value = this.extractValue(windowText, pattern);
        if (value) return value;
        if (nonEmptyUnitsSeen >= maxSteps) break;
      }

      if (direction === 'DIRECTION__BOTTOM') {
        if (high + 1 >= units.length) break;
        high++;
        if (units[high].text.trim()) nonEmptyUnitsSeen++;
      } else {
        if (low - 1 < 0) break;
        low--;
        if (units[low].text.trim()) nonEmptyUnitsSeen++;
      }
    }

    return null;
  }

  /**
   * "Collect while walking" rule (used for hierarchical section titles):
   * walks unit-by-unit strictly away from the anchor, collecting every unit
   * whose text matches `pattern`, and stops once a collected unit also
   * matches `stopAt`. If the anchor's own unit already matches `pattern`, it
   * is considered self-titled and no title is produced.
   *
   * When `pattern`'s first capture group looks like a dot-separated numeric
   * hierarchy (e.g. "18.1.6"), only strict ancestors of what's already been
   * collected are kept — same/deeper-level siblings (e.g. "18.1.5") are
   * skipped instead of polluting the collected chain.
   */
  private static runCollectRule(
    units: UnitSpan[],
    anchorIndex: number,
    direction: ExtractorDirection,
    limit: ExtractorLimit,
    pattern?: string,
    stopAt?: string,
  ): string | null {
    if (!pattern || anchorIndex < 0 || anchorIndex >= units.length) return null;

    const patternRegex = this.compilePattern(pattern);
    const stopRegex = stopAt ? this.compilePattern(stopAt) : null;

    // Only skip title lookup when the anchor unit itself STARTS with the
    // pattern (index 0) — not merely contains it somewhere further in, which
    // 'm' mode would otherwise allow to match mid-unit.
    const anchorMatch = patternRegex.exec(units[anchorIndex].text.trim());
    if (anchorMatch && anchorMatch.index === 0) return null;

    const collected: string[] = [];
    let lastLevels: number[] | null = null;
    const maxSteps = limit === 'ULTIMATE' ? units.length : Math.max(1, limit);
    let index = anchorIndex;
    // Blank units don't count against `limit` — same reasoning as
    // runSingleValueRule (see comment there).
    let stepsUsed = 0;

    while (stepsUsed < maxSteps) {
      index += direction === 'DIRECTION__BOTTOM' ? 1 : -1;
      if (index < 0 || index >= units.length) break;

      const text = units[index].text.trim();
      if (!text) continue;
      stepsUsed++;

      const match = patternRegex.exec(text);
      if (!match) continue;

      if (match[1] !== undefined) {
        const levels = match[1].split('.').map(Number);
        const isAncestorOfLast =
          lastLevels === null ||
          (levels.length < lastLevels.length &&
            levels.every(
              (level, levelIndex) => level === lastLevels![levelIndex],
            ));

        if (!isAncestorOfLast) continue;
        lastLevels = levels;
      }

      // Push only what the pattern actually matched, not the whole scanned
      // unit — a unit can contain trailing unrelated text (e.g. two headers
      // sharing one paragraph because the source document is missing a
      // blank line between them).
      const matchedLine = match[0].trim();
      collected.push(matchedLine);
      if (stopRegex && stopRegex.test(matchedLine)) break;
    }

    if (collected.length === 0) return null;
    return collected.reverse().join('\n\n');
  }

  /** Joins previously resolved field values into a single compound field. */
  private static buildCompoundValue(
    lines: string[],
    extractedFieldById: Record<string, string | null>,
  ): string {
    const wholeLinePattern = /^\{\{(\w+)\}\}$/;
    const inlinePattern = /\{\{(\w+)\}\}/g;
    const parts: string[] = [];

    for (const line of lines) {
      const wholeLineMatch = line.match(wholeLinePattern);
      if (wholeLineMatch) {
        const value = extractedFieldById[wholeLineMatch[1]];
        if (value) parts.push(value);
        continue;
      }

      parts.push(
        line.replace(inlinePattern, (_, id) => extractedFieldById[id] ?? ''),
      );
    }

    return parts.join('\n').trim();
  }

  /**
   * Core extraction logic for a single match, driven entirely by `schemaConfig`.
   */
  static extract(
    schemaConfig: ExtractorConfig,
    content: string,
    match: ExtractionInput,
  ): ExtractedInfo {
    const position = match.position ?? 0;
    const extractedFieldById: Record<string, string | null> = {};
    const unitsCache = new Map<ExtractorUnit, UnitSpan[]>();

    const getUnits = (unit: ExtractorUnit): UnitSpan[] => {
      let units = unitsCache.get(unit);
      if (!units) {
        units = this.resolveUnits(content, unit);
        unitsCache.set(unit, units);
      }
      return units;
    };

    for (const rule of schemaConfig.pipelines) {
      const startFrom = rule.startFrom ?? RULE_DEFAULTS.startFrom;
      const direction = rule.direction ?? RULE_DEFAULTS.direction;
      const unit = rule.unit ?? RULE_DEFAULTS.unit;
      const limit = rule.limit ?? RULE_DEFAULTS.limit;
      const consume = rule.consume ?? RULE_DEFAULTS.consume;

      const units = getUnits(unit);
      const anchorIndex = this.resolveAnchorIndex(units, startFrom, position);

      const value = rule.stopAt
        ? this.runCollectRule(
            units,
            anchorIndex,
            direction,
            limit,
            rule.pattern,
            rule.stopAt,
          )
        : this.runSingleValueRule(
            content,
            units,
            anchorIndex,
            direction,
            limit,
            rule.pattern,
            position,
            rule.clipToMatchLine,
          );

      extractedFieldById[rule.id] = value;

      if (
        consume &&
        value &&
        typeof extractedFieldById.content === 'string' &&
        extractedFieldById.content.includes(value)
      ) {
        extractedFieldById.content = extractedFieldById.content
          .replace(value, '')
          .trim();
      }
    }

    for (const compound of schemaConfig.compounds ?? []) {
      extractedFieldById[compound.id] = this.buildCompoundValue(
        compound.value,
        extractedFieldById,
      );
    }

    // Guaranteed fallback: whatever the schema does or doesn't define, the FE
    // needs *something* to show as a result's body text. Any schema that
    // opts a field into isPrimarySearchResponseText overrides this on the FE
    // side, but schemas that define no such field (or no compounds at all)
    // would otherwise leave callers with nothing — so always resolve the
    // plain surrounding paragraph here, the same rule DEFAULT_EXTRACTOR_SCHEMA
    // uses for its own 'summary' compound.
    if (extractedFieldById.summary === undefined) {
      const paragraphUnits = getUnits('PARAGRAPH');
      const anchorIndex = this.resolveAnchorIndex(
        paragraphUnits,
        'DOC__CONTENT',
        position,
      );
      extractedFieldById.summary = this.runSingleValueRule(
        content,
        paragraphUnits,
        anchorIndex,
        'DIRECTION__BOTTOM',
        1,
        undefined,
        position,
        true,
      );
    }

    return { ...match, extractedFieldById };
  }

  static async extractSearchResults(
    schema: ExtractorSchema = DEFAULT_EXTRACTOR_SCHEMA,
    searchResults: SearchResult[],
  ): Promise<ExtractedInfo[]> {
    const schemaConfig = schema?.config ?? DEFAULT_EXTRACTOR_SCHEMA.config;
    const extractedResults: ExtractedInfo[] = [];

    const fileContentCache = new Map<string, string>();

    for (const searchResult of searchResults) {
      const searchMatches = searchResult.results;

      for (const searchMatch of searchMatches) {
        const docPath = searchMatch.doc.textFilePath;
        const docName = searchMatch.doc.fileName;
        const originalFilePath =
          (searchMatch.doc as any).originalFilePath || docPath;

        try {
          let content = fileContentCache.get(docPath);
          if (!content) {
            content = await fs.readFile(docPath, 'utf-8');
            fileContentCache.set(docPath, content);
          }

          for (const matchedSnippet of searchMatch.snippets) {
            const input: ExtractionInput = {
              searchQuery: searchResult.query,
              foundInDocument: docName,
              originalFilePath,
              matchedText: matchedSnippet.match || '',
              position: matchedSnippet.matchCharStart || 0,
            };

            const extractedResult = this.extract(schemaConfig, content, input);
            extractedResults.push(extractedResult);
          }
        } catch (error) {
          console.error(`Failed to read file ${docPath}:`, error);
        }
      }
    }

    return extractedResults;
  }
}

export { DEFAULT_EXTRACTOR_SCHEMA, InformationExtractor };
export type { ExtractedInfo, ExtractorSchema, ExtractorConfig };
