import type { Issue, Position } from '../model/types.js';
import {
  fileIssue,
  type ParsedText,
  parserPosition,
  positionIndex,
  readYamlDocument,
  yamlErrorIssues,
} from './yaml.js';

// Only the position suffix the engine appends, not source text it quotes earlier in the message.
const ENGINE_POSITION = / at position \d+ \(line (\d+) column (\d+)\)$/;

/**
 * Reads one layout JSON file. `JSON.parse` decides whether the text is valid;
 * the same text read as YAML gives positions and finds duplicate keys.
 */
export function parseJson(file: string, text: string): ParsedText {
  const yaml = readYamlDocument(text);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    // The engine quotes the source in some messages; keep the message on one line.
    const message = (error instanceof Error ? error.message : String(error))
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n');
    const engine = ENGINE_POSITION.exec(message);
    const yamlAt = yaml.doc.errors[0]?.linePos?.[0];
    const at: Position = engine
      ? { line: Number(engine[1]), column: Number(engine[2]) }
      : yamlAt
        ? parserPosition(yaml, yamlAt)
        : { line: 1, column: 1 };
    return {
      value: undefined,
      issues: [fileIssue('syntax', file, message, at)],
      positions: new Map(),
    };
  }

  // Valid JSON is valid YAML 1.2. If the YAML reader still objects (it does not
  // compose deeply nested text), look for duplicate keys here and go without positions.
  const composed = yaml.doc.errors.every(
    (error) => error.code === 'DUPLICATE_KEY',
  );
  const duplicates = composed
    ? yamlErrorIssues(file, yaml)
    : duplicateKeyIssues(file, text);
  if (duplicates.length > 0) {
    return { value: undefined, issues: duplicates, positions: new Map() };
  }
  const positions = composed ? positionIndex(yaml) : new Map();
  return { value, issues: [], positions };
}

/**
 * Keys that repeat an earlier key of the same object, after unescaping, in
 * text that `JSON.parse` accepted. Worded and placed like the YAML reader's
 * duplicate key errors. One pass without recursion, so any depth fits.
 */
function duplicateKeyIssues(file: string, text: string): Issue[] {
  const issues: Issue[] = [];
  // The keys of each open object, or null for an open array.
  const open: (Set<string> | null)[] = [];
  let expectKey = false;
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\n') {
      line += 1;
      lineStart = i + 1;
    } else if (char === '"') {
      let end = i + 1;
      while (text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      const keys = open.at(-1);
      if (expectKey && keys) {
        const key = JSON.parse(text.slice(i, end + 1)) as string;
        if (keys.has(key)) {
          const column = i - lineStart + 1;
          issues.push(
            fileIssue(
              'syntax',
              file,
              `Map keys must be unique at line ${line}, column ${column}:`,
              { line, column },
            ),
          );
        }
        keys.add(key);
        expectKey = false;
      }
      i = end;
    } else if (char === '{') {
      open.push(new Set());
      expectKey = true;
    } else if (char === '[') {
      open.push(null);
    } else if (char === '}' || char === ']') {
      open.pop();
    } else if (char === ',') {
      expectKey = open.at(-1) instanceof Set;
    }
  }
  return issues;
}
