import { type Canon, isCanonContainer } from './canonical.js';

/** A JSON scalar; `-0` keeps its sign, as `JSON.parse` reads it. */
const scalar = (value: Canon): string =>
  typeof value === 'number' && Object.is(value, -0)
    ? '-0'
    : JSON.stringify(value);

/**
 * A layout file's text (spec FR-06): expanded with two-space indents, except
 * that a node's value and an edge's `waypoints` take one line each
 * (`{ "x": 40, "y": 320 }`, `[{ "x": 520, "y": 380 }]`) and every empty
 * object or array is `{}` or `[]`. LF line ends, one at the end. The text is
 * printed directly, never through a rebuilt object, so all-digit keys and
 * `__proto__` keep their place.
 */
export function layoutJson(data: Canon): string {
  const out: string[] = [];
  // Recursion is bounded: `canonical` refused data nested deeper than a file may.
  const write = (value: Canon, indent: string, inline: boolean): void => {
    if (!isCanonContainer(value)) {
      out.push(scalar(value));
      return;
    }
    const [open, close] = value.kind === 'map' ? ['{', '}'] : ['[', ']'];
    const children: readonly (readonly [string | undefined, Canon])[] =
      value.kind === 'map'
        ? value.entries
        : value.items.map((item) => [undefined, item] as const);
    if (children.length === 0) {
      out.push(open, close);
      return;
    }
    const oneLine = inline || value.oneLine;
    const inner = `${indent}  `;
    const padded = oneLine && value.kind === 'map';
    out.push(open, oneLine ? (padded ? ' ' : '') : '\n');
    children.forEach(([key, child], index) => {
      if (index > 0) out.push(oneLine ? ', ' : ',\n');
      if (!oneLine) out.push(inner);
      if (key !== undefined) out.push(JSON.stringify(key), ': ');
      write(child, inner, oneLine);
    });
    out.push(oneLine ? (padded ? ' ' : '') : `\n${indent}`, close);
  };
  write(data, '', false);
  out.push('\n');
  return out.join('');
}
