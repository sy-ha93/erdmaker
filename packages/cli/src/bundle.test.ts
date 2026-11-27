import { readdir, readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build, type Plugin, type Rolldown } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const CORE_DIR = fileURLToPath(new URL('../../core/', import.meta.url));
const EXAMPLE_DIR = fileURLToPath(
  new URL('../../../format/v0/examples/shop/', import.meta.url),
);

/** Fails the build on any import of a Node built-in module, with or without `node:`. */
const blockNodeBuiltins = (): Plugin => ({
  name: 'block-node-builtins',
  enforce: 'pre',
  resolveId(id) {
    const name = id.startsWith('node:') ? id : id.split('/')[0];
    if (id.startsWith('node:') || builtinModules.includes(name ?? id)) {
      this.error(`Node built-in imported: ${id}`);
    }
    return null;
  },
});

/** `entry` and what it imports as one IIFE that sets the global `erdcore`. */
async function bundle(root: string, entry: string): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    root,
    publicDir: false,
    plugins: [blockNodeBuiltins()],
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['iife'], name: 'erdcore', fileName: 'core' },
    },
  });
  const outputs = (
    Array.isArray(result) ? result : [result]
  ) as Rolldown.RolldownOutput[];
  const chunks = outputs.flatMap((out) =>
    out.output.filter((item) => item.type === 'chunk'),
  );
  expect(chunks).toHaveLength(1);
  return chunks[0]!.code;
}

/** Every file of the example, `path → text`, paths relative to the model folder. */
async function exampleFiles(): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(EXAMPLE_DIR, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files[path.slice(EXAMPLE_DIR.length)] = await readFile(path, 'utf8');
  }
  return files;
}

let base = '';

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'erdmaker-bundle-'));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('브라우저 번들', () => {
  test(
    'the built core runs as one bundle where only console is global',
    { timeout: 60_000 },
    async () => {
      const code = await bundle(CORE_DIR, join(CORE_DIR, 'dist/index.js'));
      const files = await exampleFiles();
      expect(Object.keys(files)).toHaveLength(29);

      const context = vm.createContext({ console });
      vm.runInContext(code, context);
      expect(
        vm.runInContext(
          '[typeof process, typeof require, typeof Buffer, typeof erdcore.validateProject]',
          context,
        ),
      ).toEqual(['undefined', 'undefined', 'undefined', 'function']);

      context.filesJson = JSON.stringify(files);
      // Results are objects of the context's realm: they come out as JSON text.
      const result = (await vm.runInContext(
        `(async () => {
          const fs = erdcore.createMemoryFileSystem(JSON.parse(filesJson));
          return JSON.stringify(await erdcore.validateProject(fs, ''));
        })()`,
        context,
      )) as string;
      expect(JSON.parse(result)).toEqual({
        issues: [],
        models: [
          {
            dir: '',
            issues: [],
            counts: {
              entities: 10,
              relationships: 11,
              subtypes: 1,
              subjectAreas: 3,
              layouts: 2,
              words: 5,
              terms: 4,
              domains: 8,
            },
          },
        ],
      });
    },
  );

  test.each([
    ['node:fs', "export { readFileSync } from 'node:fs';"],
    ['path', "export { join } from 'path';"],
    ['fs/promises', "export { readFile } from 'fs/promises';"],
  ])(
    'the plugin fails the build of an entry that imports %s',
    { timeout: 60_000 },
    async (module, line) => {
      const dir = await mkdtemp(join(base, 'entry-'));
      const entry = join(dir, 'entry.js');
      await writeFile(entry, `${line}\n`);
      await expect(bundle(dir, entry)).rejects.toThrow(
        `Node built-in imported: ${module}`,
      );
    },
  );
});
