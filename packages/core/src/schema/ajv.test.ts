import { describe, expect, test } from 'vitest';
import { prepareSchema, schemaAjv } from './ajv.js';

/** A schema whose property `x` is `$ref` to a string, with `beside` next to the `$ref`. */
const withRef = (beside: Record<string, unknown>) => ({
  $id: 'urn:test:ref',
  $defs: { text: { type: 'string' } },
  type: 'object',
  properties: { x: { $ref: '#/$defs/text', ...beside } },
});

describe('prepareSchema: keywords beside a $ref', () => {
  test('the format schemas have only annotations beside their $refs', () => {
    expect(() => schemaAjv()).not.toThrow();
  });

  test('annotations are kept with the inlined target', () => {
    const prepared = prepareSchema(
      withRef({
        description: 'd',
        title: 't',
        default: 'x',
        examples: ['x'],
        $comment: 'c',
      }),
      withRef({}),
    );
    expect(prepared).toMatchObject({
      properties: {
        x: {
          description: 'd',
          title: 't',
          default: 'x',
          examples: ['x'],
          $comment: 'c',
          allOf: [{ type: 'string' }],
        },
      },
    });
    expect(prepareSchema(withRef({}), withRef({}))).toMatchObject({
      properties: { x: { type: 'string' } },
    });
  });

  test.each([
    [{ minLength: 2 }, 'minLength'],
    [{ allOf: [{ maxLength: 3 }] }, 'allOf'],
    [{ description: 'd', type: 'string', enum: ['a'] }, 'type, enum'],
  ])('%o beside a $ref throws, naming %s', (beside, named) => {
    const schema = withRef(beside);
    expect(() => prepareSchema(schema, schema)).toThrow(
      `$ref #/$defs/text has keywords beside it other than annotations: ${named}`,
    );
  });
});
