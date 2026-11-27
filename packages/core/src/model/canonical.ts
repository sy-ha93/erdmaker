import { MAX_NESTING } from '../parse/yaml.js';
import { escapePointerToken } from '../parse/pointer.js';
import {
  itemSchema,
  objectSchema,
  schemaAt,
  type ValueSchema,
} from '../schema/resolve.js';

export type CanonScalar = null | boolean | number | string;

/** An array in writing order. */
export interface CanonList {
  readonly kind: 'list';
  readonly items: readonly Canon[];
  /** Written on one line in a layout file. */
  readonly oneLine: boolean;
}

/** An object's keys and values in writing order. */
export interface CanonMap {
  readonly kind: 'map';
  readonly entries: readonly (readonly [string, Canon])[];
  /** Written on one line in a layout file. */
  readonly oneLine: boolean;
}

/** A value as it is written: keys in order, defaults left out. */
export type Canon = CanonScalar | CanonList | CanonMap;

export const isCanonContainer = (value: Canon): value is CanonList | CanonMap =>
  typeof value === 'object' && value !== null;

/** Code unit order, as `<` compares strings. */
export const compareCodeUnits = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/** The schema positions the writing rules of spec FR-06 name, found once. */
interface Positions {
  /** Lists sorted by code unit: a subject area's `entities`. */
  readonly sortedItems: ReadonlySet<object>;
  /** Maps whose keys are sorted by code unit: a layout's `nodes` and `edges`. */
  readonly sortedKeys: ReadonlySet<object>;
  /** Values written on one line in a layout: a node, and an edge's `waypoints`. */
  readonly oneLine: ReadonlySet<object>;
}

let positions: Positions | undefined;

function writingPositions(): Positions {
  positions ??= {
    sortedItems: new Set([schemaAt('subject-area', '/properties/entities')]),
    sortedKeys: new Set([
      schemaAt('layout', '/properties/nodes'),
      schemaAt('layout', '/properties/edges'),
    ]),
    oneLine: new Set([
      schemaAt('layout', '/properties/nodes/additionalProperties'),
      schemaAt(
        'layout',
        '/properties/edges/additionalProperties/properties/waypoints',
      ),
    ]),
  };
  return positions;
}

/** Deep equality of JSON data with a schema `default` (recursion bounded by the default). */
function equalsDefault(value: unknown, fallback: unknown): boolean {
  if (typeof fallback !== 'object' || fallback === null) {
    return value === fallback;
  }
  if (Array.isArray(fallback)) {
    return (
      Array.isArray(value) &&
      value.length === fallback.length &&
      fallback.every((item, index) => equalsDefault(value[index], item))
    );
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(fallback);
  return (
    Object.keys(value).length === keys.length &&
    keys.every(
      (key) =>
        Object.hasOwn(value, key) &&
        equalsDefault(
          (value as Record<string, unknown>)[key],
          (fallback as Record<string, unknown>)[key],
        ),
    )
  );
}

/** An own data property (the data passed the JSON value check: there are only those). */
const own = (object: object, key: string): unknown =>
  Object.getOwnPropertyDescriptor(object, key)?.value;

/**
 * The data of one file as it is written (spec FR-06): object keys in the
 * order of the schema's `properties`, then the keys the schema does not have
 * in their order; maps without `properties` in their order; values equal to
 * the key's `default` left out, and an optional key whose object that left
 * empty (an object that was empty already stays, so does `ext`); a subject
 * area's `entities` and a layout's `nodes` and `edges` keys sorted by code
 * unit. Shared objects are expanded at each place. `data` must be JSON data
 * (no cycles), as `serializeModel` checks first. Throws a `TypeError`, and
 * only that, when its collections nest more than `MAX_NESTING` levels deep
 * (`data` itself is level 1, as the readers count a file's root), since such
 * a file would not load back. (`serializeModel` refuses such data earlier,
 * through `checkJsonValue`; this check keeps the recursion bounded.)
 */
export function canonical(
  file: string,
  data: unknown,
  root: ValueSchema,
): Canon {
  const { sortedItems, sortedKeys, oneLine } = writingPositions();
  // The keys from the data down to the current value, for the error message only.
  const trail: string[] = [];

  const walk = (
    value: unknown,
    at: ValueSchema | undefined,
    depth: number,
  ): Canon => {
    if (typeof value !== 'object' || value === null) {
      return value as CanonScalar;
    }
    // Bounded recursion: a deeper value is refused before it is entered.
    if (depth > MAX_NESTING) {
      const path = trail.map(escapePointerToken).join('/');
      throw new TypeError(
        `Cannot write ${file}: /${path} is nested more than ${MAX_NESTING} levels deep`,
      );
    }
    const position = at?.schema;
    const isOneLine = position !== undefined && oneLine.has(position);
    if (Array.isArray(value)) {
      const item = at && itemSchema(at);
      const items: Canon[] = [];
      for (let index = 0; index < value.length; index += 1) {
        trail.push(String(index));
        items.push(walk(value[index], item, depth + 1));
        trail.pop();
      }
      if (
        position !== undefined &&
        sortedItems.has(position) &&
        items.every((entry) => typeof entry === 'string')
      ) {
        (items as string[]).sort(compareCodeUnits);
      }
      return { kind: 'list', items, oneLine: isOneLine };
    }
    const shape = at && objectSchema(at);
    const keys = Object.keys(value);
    let order = keys;
    if (shape) {
      const present = new Set(keys);
      order = [];
      for (const key of shape.properties.keys()) {
        if (present.has(key)) order.push(key);
      }
      for (const key of keys) {
        if (!shape.properties.has(key)) order.push(key);
      }
    }
    if (position !== undefined && sortedKeys.has(position)) {
      order.sort(compareCodeUnits);
    }
    const entries: (readonly [string, Canon])[] = [];
    for (const key of order) {
      const child = own(value, key);
      const property = shape?.properties.get(key);
      if (property?.default && equalsDefault(child, property.default.value)) {
        continue;
      }
      trail.push(key);
      const written = walk(
        child,
        property?.schema ?? shape?.additional,
        depth + 1,
      );
      trail.pop();
      if (
        property &&
        !property.required &&
        isCanonContainer(written) &&
        written.kind === 'map' &&
        written.entries.length === 0 &&
        Object.keys(child as object).length > 0
      ) {
        continue;
      }
      entries.push([key, written]);
    }
    return { kind: 'map', entries, oneLine: isOneLine };
  };

  return walk(data, root, 1);
}
