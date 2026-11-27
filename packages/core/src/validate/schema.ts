import type { Issue } from '../model/types.js';
import { escapePointerToken } from '../parse/pointer.js';
import { type SchemaName, schemaValidator } from '../schema/ajv.js';
import { checkJsonValue } from './json-value.js';

/**
 * `data` checked against one file schema, as the old tool reported it:
 * `<instancePath or "/"> <Ajv message>`. `path` is the instance path, except
 * that an unknown key points at the key itself. No positions yet.
 */
export function schemaIssues(
  file: string,
  name: SchemaName,
  data: unknown,
): Issue[] {
  const validate = schemaValidator(name);
  let valid: boolean;
  try {
    valid = validate(data) as boolean;
  } catch {
    // Only data that reads differently from how it looked (a proxy, say) gets here.
    return [
      {
        rule: 'schema',
        severity: 'error',
        file,
        path: '',
        message: '/ must be a JSON value',
      },
    ];
  }
  if (valid) return [];
  return (validate.errors ?? []).map((error) => {
    const unknownKey: unknown =
      error.keyword === 'additionalProperties'
        ? error.params.additionalProperty
        : undefined;
    return {
      rule: 'schema',
      severity: 'error',
      file,
      path:
        typeof unknownKey === 'string'
          ? `${error.instancePath}/${escapePointerToken(unknownKey)}`
          : error.instancePath,
      message: `${error.instancePath || '/'} ${error.message ?? ''}`,
    };
  });
}

/**
 * Everything wrong with one file's data on its own: values that are not JSON
 * data, collections nested deeper than a file may hold (one issue, see
 * `checkJsonValue`) and schema errors. The schema check is left out only for
 * data that is not safe to read as data (see `checkJsonValue`), which data
 * read from a file never is. Never throws.
 */
export function itemIssues(
  file: string,
  name: SchemaName,
  data: unknown,
): Issue[] {
  const { issues, readable, tooDeep } = checkJsonValue(file, data);
  const own = tooDeep ? [...issues, tooDeep] : issues;
  if (!readable) return own;
  return [...own, ...schemaIssues(file, name, data)];
}
