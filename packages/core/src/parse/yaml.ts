import {
  type Document,
  isCollection,
  isMap,
  isNode,
  isScalar,
  isSeq,
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

/**
 * Calls `visit` on every object of the concrete syntax tree with the number of
 * collections it is in (a collection counts itself). Walks with an explicit
 * stack, so any nesting depth fits. The order is not file order.
 */
function walkCst(
  cst: readonly unknown[],
  visit: (record: Record<string, unknown>, depth: number) => void,
): void {
  const pending: [unknown, number][] = cst.map((token) => [token, 0]);
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
} as const;

export function readYamlDocument(text: string): YamlDocument {
  const bom = text.startsWith('\uFEFF');
  const cstLines = new LineCounter();
  const cst = Array.from(new Parser(cstLines.addNewLine).parse(text));
  // The earliest collection past the limit in the file.
  let tooDeep: number | undefined;
  walkCst(cst, (record, depth) => {
    if (depth > MAX_NESTING && typeof record.offset === 'number') {
      tooDeep = Math.min(tooDeep ?? record.offset, record.offset);
    }
  });
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
    let message = error.message.split('\n')[0] ?? '';
    const parser = error.linePos?.[0];
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
  walkCst(cst, (record) => {
    if (
      typeof record.type === 'string' &&
      TRACKED.has(record.type) &&
      typeof record.source === 'string' &&
      typeof record.offset === 'number'
    ) {
      found.push(record as unknown as SourceToken);
    }
  });
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

interface KeyScan {
  /** How many keys repeat an earlier key of their map exactly (parser errors). */
  duplicates: number;
  /** Collection keys, and keys that turn into the same object key as an earlier one. */
  problems: { message: string; offset: number }[];
}

/** One pass over every map's keys, in document order. */
function scanKeys(yaml: YamlDocument): KeyScan {
  const scan: KeyScan = { duplicates: 0, problems: [] };
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
        if (exact.has(comparable)) scan.duplicates += 1;
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

/**
 * Whether the parser follows an error message with the source line, and so
 * with a colon: the line (or, at its start, the line before) shows something.
 */
function hasSourceLine(
  { text, lineCounter }: YamlDocument,
  line: number,
  col: number,
): boolean {
  const start = lineCounter.lineStarts[line - 1] ?? 0;
  let end = lineCounter.lineStarts[line] ?? text.length;
  while (end > start && /[\n\r]/.test(text.charAt(end - 1))) end -= 1;
  // A longer line is shortened with an ellipsis.
  if (end - start > 80) return true;
  const shown = text.slice(start, end);
  return (
    /[^ ]/.test(shown) || (line > 1 && /^ *$/.test(shown.slice(0, col - 1)))
  );
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
 * errors not match the `duplicates` found by `scanKeys`, the parser's own
 * check is used instead.
 */
export function parserErrors(
  yaml: YamlDocument,
  duplicates = scanKeys(yaml).duplicates,
): YAMLError[] {
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
  // Unformatted: formatting an error copies and scans its whole line, once per key.
  const checked = parseDocument(yaml.text, {
    ...OPTIONS,
    uniqueKeys,
    prettyErrors: false,
  });
  // The other errors are the same, in the same order, and already formatted.
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
    // say): fall back to its own check, which is right, if slow.
    return parseDocument(yaml.text, { ...OPTIONS, uniqueKeys: true }).errors;
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
    issues: yamlErrorIssues(file, yaml, parserErrors(yaml, keys.duplicates)),
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
