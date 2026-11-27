import type { Issue, Position } from '../model/types.js';
import {
  type ParsedText,
  positionIndex,
  readYamlDocument,
  yamlErrorIssues,
} from './yaml.js';

const ENGINE_POSITION = /\(line (\d+) column (\d+)\)/;

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
        ? { line: yamlAt.line, column: yamlAt.col }
        : { line: 1, column: 1 };
    const issue: Issue = {
      rule: 'syntax',
      severity: 'error',
      file,
      path: '',
      line: at.line,
      column: at.column,
      message,
    };
    return { value: undefined, issues: [issue], positions: new Map() };
  }

  const duplicates = yamlErrorIssues(
    file,
    yaml.doc.errors.filter((error) => error.code === 'DUPLICATE_KEY'),
  );
  if (duplicates.length > 0) {
    return { value: undefined, issues: duplicates, positions: new Map() };
  }
  // Valid JSON is valid YAML 1.2; if the YAML reader still objects, go without positions.
  const positions =
    yaml.doc.errors.length === 0 ? positionIndex(yaml) : new Map();
  return { value, issues: [], positions };
}
