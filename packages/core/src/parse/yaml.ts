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
  visit,
  type YAMLError,
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
}

export function readYamlDocument(text: string): YamlDocument {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, {
    version: '1.2',
    schema: 'core',
    uniqueKeys: true,
    lineCounter,
    logLevel: 'error',
  });
  return { doc, lineCounter };
}

function positionAt(lineCounter: LineCounter, offset: number): Position {
  const { line, col } = lineCounter.linePos(offset);
  return { line, column: col };
}

function syntaxIssue(file: string, message: string, at: Position): Issue {
  return {
    rule: 'syntax',
    severity: 'error',
    file,
    path: '',
    line: at.line,
    column: at.column,
    message,
  };
}

/** The parser's errors as `syntax` issues: first message line, parser position or 1:1. */
export function yamlErrorIssues(
  file: string,
  errors: readonly YAMLError[],
): Issue[] {
  return errors.map((error) => {
    const at = error.linePos?.[0];
    return syntaxIssue(
      file,
      error.message.split('\n')[0] ?? '',
      at ? { line: at.line, column: at.col } : { line: 1, column: 1 },
    );
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
function sourceTokens(text: string): SourceToken[] {
  const found: SourceToken[] = [];
  const scan = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    if (Array.isArray(node)) {
      for (const item of node) scan(item);
      return;
    }
    const record = node as Record<string, unknown>;
    if (
      typeof record.type === 'string' &&
      TRACKED.has(record.type) &&
      typeof record.source === 'string' &&
      typeof record.offset === 'number'
    ) {
      found.push(record as unknown as SourceToken);
    }
    for (const value of Object.values(record)) {
      if (typeof value === 'object') scan(value);
    }
  };
  for (const token of new Parser().parse(text)) scan(token);
  return found.sort((a, b) => a.offset - b.offset);
}

function featureIssues(
  file: string,
  { doc, lineCounter }: YamlDocument,
  tokens: SourceToken[],
): Issue[] {
  const issues: Issue[] = [];
  for (const token of tokens) {
    let message: string;
    if (token.type === 'anchor') message = 'YAML anchors are not allowed';
    else if (token.type === 'alias') message = 'YAML aliases are not allowed';
    else if (token.type === 'tag') {
      const tag =
        doc.directives.tagName(token.source, () => {}) ?? token.source;
      message = `YAML tag ${tag} is not allowed`;
    } else continue;
    const at = positionAt(lineCounter, token.offset);
    issues.push({
      rule: 'yaml-feature',
      severity: 'error',
      file,
      path: '',
      line: at.line,
      column: at.column,
      message,
    });
  }
  return issues;
}

/** Map keys that are collections, or that turn into the same object key as an earlier one. */
function keyIssues(file: string, { doc, lineCounter }: YamlDocument): Issue[] {
  const issues: Issue[] = [];
  const keyStart = (key: unknown) =>
    isNode(key) && key.range ? key.range[0] : 0;
  visit(doc, {
    Pair(_, pair) {
      if (isCollection(pair.key)) {
        issues.push(
          syntaxIssue(
            file,
            'Map keys must be scalars',
            positionAt(lineCounter, keyStart(pair.key)),
          ),
        );
      }
    },
    Map(_, map) {
      const seen = new Set<string>();
      for (const pair of map.items) {
        if (!isScalar(pair.key)) continue;
        const key = keyString(pair.key.value);
        if (seen.has(key)) {
          issues.push(
            syntaxIssue(
              file,
              `Map keys collide as "${key}"`,
              positionAt(lineCounter, keyStart(pair.key)),
            ),
          );
        }
        seen.add(key);
      }
    },
  });
  return issues;
}

/** JSON Pointer → position: a map entry points at its key, a sequence item at its value. */
export function positionIndex({
  doc,
  lineCounter,
}: YamlDocument): Map<string, Position> {
  const index = new Map<string, Position>();
  const add = (path: string, node: unknown) => {
    if (isNode(node) && node.range) {
      index.set(path, positionAt(lineCounter, node.range[0]));
    }
  };
  const walk = (node: unknown, path: string): void => {
    if (isMap(node)) {
      for (const pair of node.items) {
        if (!isScalar(pair.key)) continue;
        const childPath = `${path}/${escapePointerToken(keyString(pair.key.value))}`;
        add(childPath, pair.key);
        walk(pair.value, childPath);
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, i) => {
        const childPath = `${path}/${i}`;
        add(childPath, item);
        walk(item, childPath);
      });
    }
  };
  walk(doc.contents, '');
  return index;
}

/**
 * Reads one YAML file. Parser errors, colliding or collection keys are
 * `syntax` issues; tags, anchors and aliases are `yaml-feature` issues. Either
 * kind leaves the file without a value.
 */
export function parseYaml(file: string, text: string): ParsedText {
  const yaml = readYamlDocument(text);
  const tokens = sourceTokens(text);
  const comment = tokens.find((token) => token.type === 'comment');
  const result: ParsedText = {
    value: undefined,
    issues: [],
    positions: new Map(),
  };
  if (comment) {
    result.firstComment = positionAt(yaml.lineCounter, comment.offset);
  }

  result.issues = yamlErrorIssues(file, yaml.doc.errors);
  if (result.issues.length > 0) return result;

  // Features first: an alias that resolves to nothing would make `toJS` throw.
  result.issues = [
    ...featureIssues(file, yaml, tokens),
    ...keyIssues(file, yaml),
  ];
  if (result.issues.length > 0) return result;

  result.value = yaml.doc.toJS();
  result.positions = positionIndex(yaml);
  return result;
}
