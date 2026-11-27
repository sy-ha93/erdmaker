import {
  type Document,
  isCollection,
  isMap,
  isNode,
  isScalar,
  isSeq,
  Lexer,
  LineCounter,
  parseDocument,
  Parser,
  type Pair,
  type YAMLError,
  type YAMLMap,
  YAMLParseError,
  type YAMLSeq,
} from 'yaml';
import type { Issue, Position, PositionIndex } from '../model/types.js';
import { escapePointerToken } from './pointer.js';

/** One file's text turned into data. `value` and `positions` are only filled when `issues` is empty. */
export interface ParsedText {
  value: unknown;
  issues: Issue[];
  positions: PositionIndex;
  firstComment?: Position;
}

export interface YamlDocument {
  doc: Document.Parsed;
  lineCounter: LineCounter;
  /** The concrete syntax tree's top-level tokens. */
  cst: unknown[];
  /** The text starts with a byte order mark, which the parser counts as a column. */
  bom: boolean;
  /** Nested past `MAX_NESTING`: `doc` is empty and carries only that error. */
  tooDeep: boolean;
  /** The text that was read. */
  text: string;
}

/**
 * Deepest nesting of collections the reader composes. The `yaml` composer
 * recurses once per level: far deeper input would overflow the call stack,
 * and Node 22 can abort the process (a fatal V8 error, not an exception) when
 * that happens twice. No model or layout file comes near this depth.
 */
export const MAX_NESTING = 256;

const CST_COLLECTIONS = new Set(['block-map', 'block-seq', 'flow-collection']);

const isCstCollection = (token: unknown) =>
  typeof token === 'object' &&
  token !== null &&
  CST_COLLECTIONS.has(String((token as { type?: unknown }).type));

/**
 * Calls `visit` on every object of the concrete syntax tree with the number of
 * collections it is in (a collection counts itself), starting each token at
 * the depth given with it (0 for a top-level token). Walks with an explicit
 * stack, so any nesting depth fits. The order is not file order.
 */
function walkCst(
  tokens: readonly (readonly [unknown, number])[],
  visit: (record: Record<string, unknown>, depth: number) => void,
): void {
  const pending: [unknown, number][] = tokens.map(([token, depth]) => [
    token,
    depth,
  ]);
  for (let next = pending.pop(); next; next = pending.pop()) {
    const [node, outer] = next;
    if (typeof node !== 'object' || node === null) continue;
    if (Array.isArray(node)) {
      for (const item of node as unknown[]) pending.push([item, outer]);
      continue;
    }
    const record = node as Record<string, unknown>;
    const depth =
      typeof record.type === 'string' && CST_COLLECTIONS.has(record.type)
        ? outer + 1
        : outer;
    visit(record, depth);
    for (const value of Object.values(record)) {
      if (typeof value === 'object') pending.push([value, depth]);
    }
  }
}

/**
 * The composer's own duplicate key check compares each key with every earlier
 * key of its map, which takes quadratic time; `scanKeys` finds duplicates instead.
 */
const OPTIONS = {
  version: '1.2',
  schema: 'core',
  uniqueKeys: false,
  logLevel: 'error',
  // Formatting an error copies and scans its whole line: once per error, so
  // many errors on one long line would take quadratic time. Formatted here
  // instead, from offsets and one index of the lines (`errorAt`).
  prettyErrors: false,
} as const;

/**
 * The concrete syntax tree of `text`, read one lexical token at a time. The
 * parser closes collections by recursion, one call per collection closed at
 * once, so input nested far deeper than the limit (`- - - … x` and then a
 * line at the left margin) would overflow the call stack inside it. Reading
 * stops as soon as the parser holds more collections open than the limit;
 * besides them it holds at most the document and the value being read. Then
 * `open` holds what it had open, outermost first.
 */
function parseCst(
  text: string,
  lines: LineCounter,
): { cst: unknown[]; open?: readonly unknown[] } {
  const parser = new Parser(lines.addNewLine);
  lines.addNewLine(0);
  const cst: unknown[] = [];
  for (const lexeme of new Lexer().lex(text)) {
    for (const token of parser.next(lexeme)) cst.push(token);
    if (parser.stack.length > MAX_NESTING + 2) {
      return { cst, open: parser.stack };
    }
  }
  for (const token of parser.end()) cst.push(token);
  return { cst };
}

/** The offset of the earliest collection more than `MAX_NESTING` deep, in the tree and what the parser still holds open. */
function tooDeepOffset(
  cst: readonly unknown[],
  open: readonly unknown[] = [],
): number | undefined {
  // An open token is in the open collections before it, and not yet in their items.
  const tokens: [unknown, number][] = cst.map((token) => [token, 0]);
  let outer = 0;
  for (const token of open) {
    tokens.push([token, outer]);
    if (isCstCollection(token)) outer += 1;
  }
  let found: number | undefined;
  walkCst(tokens, (record, depth) => {
    if (depth > MAX_NESTING && typeof record.offset === 'number') {
      found = Math.min(found ?? record.offset, record.offset);
    }
  });
  return found;
}

export function readYamlDocument(text: string): YamlDocument {
  const bom = text.startsWith('\uFEFF');
  const cstLines = new LineCounter();
  const { cst, open } = parseCst(text, cstLines);
  // The earliest collection past the limit in the file.
  const tooDeep = tooDeepOffset(cst, open);
  if (tooDeep === undefined) {
    const lineCounter = new LineCounter();
    const doc = parseDocument(text, { ...OPTIONS, lineCounter });
    return { doc, lineCounter, cst, bom, tooDeep: false, text };
  }
  // Too deep to compose: an empty document that carries the error instead.
  const doc = parseDocument('', OPTIONS);
  const at = cstLines.linePos(tooDeep);
  // Worded like the parser's own errors, position included.
  const error = new YAMLParseError(
    [tooDeep, tooDeep + 1],
    'RESOURCE_EXHAUSTION',
    `Collections are nested more than ${MAX_NESTING} levels deep at line ${at.line}, column ${at.col}:`,
  );
  error.linePos = [at];
  doc.errors.push(error);
  return { doc, lineCounter: cstLines, cst, bom, tooDeep: true, text };
}

/** A parser line and column as a position; a byte order mark is not a column. */
export function parserPosition(
  { bom }: YamlDocument,
  { line, col }: { line: number; col: number },
): Position {
  return { line, column: bom && line === 1 ? Math.max(1, col - 1) : col };
}

function positionAt(yaml: YamlDocument, offset: number): Position {
  return parserPosition(yaml, yaml.lineCounter.linePos(offset));
}

/** What the parser's error formatting looks at on each line, without the line break. */
interface SourceLines {
  /** Characters on the line. */
  length: number[];
  /** Spaces it starts with. */
  indent: number[];
  /** Whether it shows anything other than spaces. */
  shows: boolean[];
}

const sourceLines = new WeakMap<YamlDocument, SourceLines>();

/** The lines of the text, indexed once per document and only when an error needs them. */
function linesOf(yaml: YamlDocument): SourceLines {
  let lines = sourceLines.get(yaml);
  if (lines) return lines;
  const { text } = yaml;
  const starts = yaml.lineCounter.lineStarts;
  lines = { length: [], indent: [], shows: [] };
  for (let line = 0; line < starts.length; line += 1) {
    const start = starts[line] ?? 0;
    let end = starts[line + 1] ?? text.length;
    while (end > start && (text[end - 1] === '\n' || text[end - 1] === '\r')) {
      end -= 1;
    }
    let indent = 0;
    while (start + indent < end && text[start + indent] === ' ') indent += 1;
    lines.length.push(end - start);
    lines.indent.push(indent);
    lines.shows.push(indent < end - start);
  }
  sourceLines.set(yaml, lines);
  return lines;
}

/**
 * Whether the parser follows an error message at `line`, `col` with the
 * source line, and so with a colon: a line longer than 80 characters is
 * shown cut with an ellipsis; at the line's start (only spaces before the
 * column) the line before is shown with it, line break included; otherwise
 * the line shows something but spaces.
 */
function hasSourceLine(yaml: YamlDocument, line: number, col: number): boolean {
  const { length, indent, shows } = linesOf(yaml);
  const chars = length[line - 1] ?? 0;
  if (chars > 80) return true;
  if (line > 1 && (indent[line - 1] ?? 0) >= Math.min(col - 1, chars)) {
    return true;
  }
  return shows[line - 1] ?? false;
}

/**
 * The first line of the message the parser gives an error when it formats
 * errors (`prettyErrors`, off here), and the position it gives it: `at line
 * L, column C`, a colon when it shows the source line. An error without an
 * offset keeps its message and has no position. Errors made here are
 * formatted already.
 */
export function errorAt(
  yaml: YamlDocument,
  error: YAMLError,
): { message: string; at?: { line: number; col: number } } {
  const firstLine = (message: string) => message.split('\n')[0] ?? '';
  const given = error.linePos?.[0];
  if (given) return { message: firstLine(error.message), at: given };
  if (error.pos[0] === -1) return { message: firstLine(error.message) };
  const at = yaml.lineCounter.linePos(error.pos[0]);
  const colon = hasSourceLine(yaml, at.line, at.col) ? ':' : '';
  return {
    message: firstLine(
      `${error.message} at line ${at.line}, column ${at.col}${colon}`,
    ),
    at,
  };
}

/** A whole-file (`path` `""`) error at a position the parser or the engine gave. */
export function fileIssue(
  rule: 'syntax' | 'yaml-feature',
  file: string,
  message: string,
  at: Position,
): Issue {
  return {
    rule,
    severity: 'error',
    file,
    path: '',
    line: at.line,
    column: at.column,
    message,
  };
}

/**
 * The parser's errors as `syntax` issues: first message line, parser position
 * or 1:1. The position the message ends with is corrected like the issue's.
 */
export function yamlErrorIssues(
  file: string,
  yaml: YamlDocument,
  errors: readonly YAMLError[] = yaml.doc.errors,
): Issue[] {
  return errors.map((error) => {
    const formatted = errorAt(yaml, error);
    let { message } = formatted;
    const parser = formatted.at;
    if (!parser)
      return fileIssue('syntax', file, message, { line: 1, column: 1 });
    const at = parserPosition(yaml, parser);
    const said = ` at line ${parser.line}, column ${parser.col}:`;
    if (at.column !== parser.col && message.endsWith(said)) {
      message = `${message.slice(0, -said.length)} at line ${at.line}, column ${at.column}:`;
    }
    return fileIssue('syntax', file, message, at);
  });
}

// Same conversion the `yaml` package applies when it turns a scalar key into an object key.
function keyString(value: unknown): string {
  return value === null ? '' : String(value);
}

interface SourceToken {
  type: 'tag' | 'anchor' | 'alias' | 'comment';
  source: string;
  offset: number;
}

const TRACKED = new Set(['tag', 'anchor', 'alias', 'comment']);

/** Tags, anchors, aliases and comments, from the concrete syntax tree, in file order. */
function sourceTokens({ cst }: YamlDocument): SourceToken[] {
  const found: SourceToken[] = [];
  walkCst(
    cst.map((token) => [token, 0]),
    (record) => {
      if (
        typeof record.type === 'string' &&
        TRACKED.has(record.type) &&
        typeof record.source === 'string' &&
        typeof record.offset === 'number'
      ) {
        found.push(record as unknown as SourceToken);
      }
    },
  );
  return found.sort((a, b) => a.offset - b.offset);
}

function featureIssues(
  file: string,
  yaml: YamlDocument,
  tokens: SourceToken[],
): Issue[] {
  const issues: Issue[] = [];
  for (const token of tokens) {
    let message: string;
    if (token.type === 'anchor') message = 'YAML anchors are not allowed';
    else if (token.type === 'alias') message = 'YAML aliases are not allowed';
    else if (token.type === 'tag') {
      const tag =
        yaml.doc.directives.tagName(token.source, () => {}) ?? token.source;
      message = `YAML tag ${tag} is not allowed`;
    } else continue;
    issues.push(
      fileIssue('yaml-feature', file, message, positionAt(yaml, token.offset)),
    );
  }
  return issues;
}

interface CollectionVisitor {
  map?: (map: YAMLMap, path: string | undefined) => void;
  pair?: (pair: Pair) => void;
  seq?: (seq: YAMLSeq, path: string | undefined) => void;
}

/**
 * Visits the document's collections in the order of the `yaml` package's
 * `visit`: a map, then for each pair the pair, its key and its value; a
 * sequence, then its items. `path` is the node's JSON Pointer, or undefined
 * under a key that is not a scalar. Walks with an explicit stack, so any
 * nesting depth fits.
 */
function walkCollections({ doc }: YamlDocument, visitor: CollectionVisitor) {
  type Task = { pair: Pair } | { node: unknown; path: string | undefined };
  const pending: Task[] = [{ node: doc.contents, path: '' }];
  for (let task = pending.pop(); task; task = pending.pop()) {
    if ('pair' in task) {
      visitor.pair?.(task.pair);
      continue;
    }
    const { node, path } = task;
    const next: Task[] = [];
    if (isMap(node)) {
      visitor.map?.(node, path);
      for (const pair of node.items) {
        const valuePath =
          path !== undefined && isScalar(pair.key)
            ? `${path}/${escapePointerToken(keyString(pair.key.value))}`
            : undefined;
        next.push(
          { pair },
          { node: pair.key, path: undefined },
          { node: pair.value, path: valuePath },
        );
      }
    } else if (isSeq(node)) {
      visitor.seq?.(node, path);
      node.items.forEach((item, i) =>
        next.push({
          node: item,
          path: path === undefined ? path : `${path}/${i}`,
        }),
      );
    }
    // Reversed onto the stack, so they come off it in document order.
    for (let i = next.length - 1; i >= 0; i -= 1) {
      const item = next[i];
      if (item) pending.push(item);
    }
  }
}

const keyStart = (key: unknown) =>
  isNode(key) && key.range ? key.range[0] : 0;

const INCOMPARABLE = Symbol('incomparable');

/**
 * What the parser compares to find duplicate keys: a scalar key's value, by
 * `===`. So `a` and `"a"` are the same key, `1` and `"1"` are not, and NaN
 * matches nothing.
 */
function comparableKey(key: unknown): unknown {
  return isScalar(key) && !Number.isNaN(key.value) ? key.value : INCOMPARABLE;
}

export interface KeyScan {
  /** How many keys repeat an earlier key of their map exactly (parser errors). */
  duplicates: number;
  /** Where those keys start, in the order found. */
  duplicateOffsets: number[];
  /** Collection keys, and keys that turn into the same object key as an earlier one. */
  problems: { message: string; offset: number }[];
}

/** One pass over every map's keys, in document order. */
export function scanKeys(yaml: YamlDocument): KeyScan {
  const scan: KeyScan = { duplicates: 0, duplicateOffsets: [], problems: [] };
  walkCollections(yaml, {
    pair(pair) {
      if (isCollection(pair.key)) {
        scan.problems.push({
          message: 'Map keys must be scalars',
          offset: keyStart(pair.key),
        });
      }
    },
    map(map) {
      const exact = new Set<unknown>();
      const seen = new Set<string>();
      for (const pair of map.items) {
        if (!isScalar(pair.key)) continue;
        const comparable = comparableKey(pair.key);
        if (exact.has(comparable)) {
          scan.duplicates += 1;
          scan.duplicateOffsets.push(keyStart(pair.key));
        }
        if (comparable !== INCOMPARABLE) exact.add(comparable);
        const key = keyString(pair.key.value);
        if (seen.has(key)) {
          scan.problems.push({
            message: `Map keys collide as "${key}"`,
            offset: keyStart(pair.key),
          });
        }
        seen.add(key);
      }
    },
  });
  return scan;
}

/** A duplicate key error at `offset`, worded and placed like the parser's own. */
function duplicateKeyError(yaml: YamlDocument, offset: number): YAMLError {
  const at = yaml.lineCounter.linePos(offset);
  const colon = hasSourceLine(yaml, at.line, at.col) ? ':' : '';
  const error = new YAMLParseError(
    [offset, offset + 1],
    'DUPLICATE_KEY',
    `Map keys must be unique at line ${at.line}, column ${at.col}${colon}`,
  );
  error.linePos = [at, yaml.lineCounter.linePos(offset + 1)];
  return error;
}

/**
 * The parser's errors as they would be with its own duplicate key check on.
 * Only for text with a duplicate key, the text is composed again with a
 * `uniqueKeys` function that ends the composer's scan of earlier keys at the
 * first one, so it costs one call per key. The composer then reports an error
 * at every key after a map's first, in its own order and at its own offsets;
 * the errors at keys that are no exact duplicate are dropped. Should the kept
 * errors not match the `duplicates` found by `scanKeys`, an error at each
 * duplicate `scanKeys` found is put among the other errors by offset
 * instead (the parser's own check would take quadratic time).
 */
export function parserErrors(
  yaml: YamlDocument,
  scan: KeyScan = scanKeys(yaml),
): YAMLError[] {
  const { duplicates } = scan;
  if (duplicates === 0) return yaml.doc.errors;
  const exact: boolean[] = [];
  // Earlier keys of each map, by the map's first key.
  const earlier = new WeakMap<object, Set<unknown>>();
  const uniqueKeys = (first: object, key: object) => {
    let keys = earlier.get(first);
    if (!keys) {
      keys = new Set([comparableKey(first)]);
      earlier.set(first, keys);
    }
    const comparable = comparableKey(key);
    exact.push(comparable !== INCOMPARABLE && keys.has(comparable));
    keys.add(comparable);
    return true;
  };
  const checked = parseDocument(yaml.text, { ...OPTIONS, uniqueKeys });
  // The other errors are the same, in the same order.
  const others = yaml.doc.errors;
  const errors: YAMLError[] = [];
  let other = 0;
  let key = 0;
  let kept = 0;
  for (const error of checked.errors) {
    if (error.code !== 'DUPLICATE_KEY') {
      const same = others[other++];
      if (same) errors.push(same);
    } else if (exact[key++]) {
      errors.push(duplicateKeyError(yaml, error.pos[0]));
      kept += 1;
    }
  }
  if (kept !== duplicates) {
    // The parser did not call `uniqueKeys` as expected (another `yaml` version,
    // say): the duplicates found here, in offset order with the others.
    return [
      ...others,
      ...scan.duplicateOffsets.map((offset) => duplicateKeyError(yaml, offset)),
    ].sort((a, b) => a.pos[0] - b.pos[0]);
  }
  return errors;
}

/** JSON Pointer → position: a map entry points at its key, a sequence item at its value. */
export function positionIndex(yaml: YamlDocument): Map<string, Position> {
  const index = new Map<string, Position>();
  const add = (path: string, node: unknown) => {
    if (isNode(node) && node.range) {
      index.set(path, positionAt(yaml, node.range[0]));
    }
  };
  walkCollections(yaml, {
    map(map, path) {
      if (path === undefined) return;
      for (const pair of map.items) {
        if (!isScalar(pair.key)) continue;
        add(
          `${path}/${escapePointerToken(keyString(pair.key.value))}`,
          pair.key,
        );
      }
    },
    seq(seq, path) {
      if (path === undefined) return;
      seq.items.forEach((item, i) => add(`${path}/${i}`, item));
    },
  });
  return index;
}

/**
 * Reads one YAML file. Parser errors, colliding or collection keys are
 * `syntax` issues; tags, anchors and aliases are `yaml-feature` issues. Either
 * kind leaves the file without a value. `firstComment` is only looked for in
 * a file without parser errors. Returns issues, never throws, for any text.
 */
export function parseYaml(file: string, text: string): ParsedText {
  const yaml = readYamlDocument(text);
  const keys = scanKeys(yaml);
  const result: ParsedText = {
    value: undefined,
    issues: yamlErrorIssues(file, yaml, parserErrors(yaml, keys)),
    positions: new Map(),
  };
  if (result.issues.length > 0) return result;

  const tokens = sourceTokens(yaml);
  const comment = tokens.find((token) => token.type === 'comment');
  if (comment) result.firstComment = positionAt(yaml, comment.offset);

  // Features first: an alias that resolves to nothing would make `toJS` throw.
  result.issues = [
    ...featureIssues(file, yaml, tokens),
    ...keys.problems.map(({ message, offset }) =>
      fileIssue('syntax', file, message, positionAt(yaml, offset)),
    ),
  ];
  if (result.issues.length > 0) return result;

  result.value = yaml.doc.toJS();
  result.positions = positionIndex(yaml);
  return result;
}
