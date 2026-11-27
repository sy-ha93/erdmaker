import type { Issue, Position } from '../model/types.js';
import {
  fileIssue,
  type ParsedText,
  parserErrors,
  parserPosition,
  positionIndex,
  readYamlDocument,
  yamlErrorIssues,
} from './yaml.js';

// Only the position suffix the engine appends, not source text it quotes earlier in the message.
const ENGINE_POSITION = / at position \d+ \(line (\d+) column (\d+)\)$/;

/**
 * Reads one layout JSON file. `JSON.parse` decides whether the text is valid;
 * the same text read as YAML gives positions and the nesting limit of every
 * model file. Duplicate keys are found in the text itself.
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
    const yamlAt = engine ? undefined : parserErrors(yaml)[0]?.linePos?.[0];
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

  // The YAML reader's limit, error and position, as for a YAML file.
  if (yaml.tooDeep) {
    return {
      value: undefined,
      issues: yamlErrorIssues(file, yaml),
      positions: new Map(),
    };
  }
  const duplicates = duplicateKeyIssues(file, text);
  if (duplicates.length > 0) {
    return { value: undefined, issues: duplicates, positions: new Map() };
  }
  // Valid JSON is valid YAML 1.2, except a top-level scalar after a tab, which
  // has no positions anyway.
  const composed = yaml.doc.errors.length === 0;
  return {
    value,
    issues: [],
    positions: composed ? positionIndex(yaml) : new Map(),
  };
}

interface OpenObject {
  keys: Set<string>;
  /** The issue of the current key, if it repeats one, until its value ends. */
  duplicate?: Issue;
}

/**
 * Keys that repeat an earlier key of the same object, after unescaping, in
 * text that `JSON.parse` accepted. Worded, placed and ordered like the YAML
 * reader's duplicate key errors, which come after those in the key's value.
 * One pass without recursion, so any depth fits.
 */
function duplicateKeyIssues(file: string, text: string): Issue[] {
  const issues: Issue[] = [];
  // Each open object, or null for an open array.
  const open: (OpenObject | null)[] = [];
  const endValue = () => {
    const object = open.at(-1);
    if (object?.duplicate) {
      issues.push(object.duplicate);
      object.duplicate = undefined;
    }
  };
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
      const object = open.at(-1);
      if (expectKey && object) {
        const key = JSON.parse(text.slice(i, end + 1)) as string;
        if (object.keys.has(key)) {
          const column = i - lineStart + 1;
          object.duplicate = fileIssue(
            'syntax',
            file,
            `Map keys must be unique at line ${line}, column ${column}:`,
            { line, column },
          );
        }
        object.keys.add(key);
        expectKey = false;
      }
      i = end;
    } else if (char === '{') {
      open.push({ keys: new Set() });
      expectKey = true;
    } else if (char === '[') {
      open.push(null);
    } else if (char === '}' || char === ']') {
      endValue();
      open.pop();
    } else if (char === ',') {
      endValue();
      expectKey = Boolean(open.at(-1));
    }
  }
  return issues;
}
