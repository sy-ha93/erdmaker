#!/usr/bin/env node
// Conformance check for model format v0: JSON Schema per file, then cross-file rules.
// Usage: node tools/validate-format.mjs <model directory>
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { parseDocument, visit } from 'yaml';

const URN = 'urn:erdmaker:format:0.1:';
const schemaDir = join(dirname(fileURLToPath(import.meta.url)), '../format/v0/schema');
const root = resolve(process.argv[2] ?? '.');
const errors = [];
const err = (file, msg) => errors.push(`${relative(root, file) || file}: ${msg}`);

const ajv = new Ajv2020({ allErrors: true, strict: false, strictSchema: true });
for (const f of readdirSync(schemaDir)) {
  if (f.endsWith('.schema.json')) ajv.addSchema(JSON.parse(readFileSync(join(schemaDir, f), 'utf8')));
}

function walk(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p, ext) : n.endsWith(ext) ? [p] : [];
    });
}

function load(file, schema) {
  const text = readFileSync(file, 'utf8');
  let data;
  if (file.endsWith('.json')) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      return err(file, e.message);
    }
  } else {
    // YAML 1.2 core schema only: `NO` stays a string. Anchors, aliases and tags are not part of the format.
    const doc = parseDocument(text, { version: '1.2', schema: 'core', uniqueKeys: true });
    for (const e of doc.errors) err(file, e.message);
    if (doc.errors.length) return;
    visit(doc, {
      Alias: () => void err(file, 'YAML aliases are not allowed'),
      Node: (_, n) => {
        if (n.anchor) err(file, 'YAML anchors are not allowed');
        if (n.tag && n.tag.startsWith('!') && !n.tag.startsWith('tag:yaml.org')) err(file, `YAML tag ${n.tag} is not allowed`);
      },
    });
    data = doc.toJS();
  }
  const validate = ajv.getSchema(URN + schema);
  if (!validate(data)) {
    for (const e of validate.errors) err(file, `${e.instancePath || '/'} ${e.message}`);
    return;
  }
  return { file, data };
}

const loadAll = (dir, ext, schema) => walk(join(root, dir), ext).map((f) => load(f, schema)).filter(Boolean);

function index(items, what, map = new Map()) {
  for (const { file, data } of items) {
    if (map.has(data.id)) err(file, `duplicate ${what} id "${data.id}" (also in ${relative(root, map.get(data.id).file)})`);
    else map.set(data.id, { file, data });
  }
  return map;
}

const manifestFile = join(root, 'model.yaml');
if (!existsSync(manifestFile)) {
  console.error(`No model.yaml in ${root}`);
  process.exit(2);
}
const manifest = load(manifestFile, 'model');

// Dictionaries
const words = new Map();
const terms = new Map();
const domains = new Map();
for (const d of manifest?.data.dictionaries ?? ['dictionary']) {
  for (const f of walk(resolve(root, d), '.yaml')) {
    const loaded = load(f, 'dictionary');
    if (!loaded) continue;
    for (const [list, map, what] of [['words', words, 'word'], ['terms', terms, 'term'], ['domains', domains, 'domain']]) {
      index((loaded.data[list] ?? []).map((data) => ({ file: f, data })), what, map);
    }
  }
}
for (const { file, data } of terms.values()) {
  for (const w of data.words ?? []) if (!words.has(w)) err(file, `term "${data.id}": unknown word "${w}"`);
  if (data.domain && !domains.has(data.domain)) err(file, `term "${data.id}": unknown domain "${data.domain}"`);
}

// Model objects
const entities = index(loadAll('entities', '.yaml', 'entity'), 'entity');
const relationships = index(loadAll('relationships', '.yaml', 'relationship'), 'relationship');
const subtypes = index(loadAll('subtypes', '.yaml', 'subtype'), 'subtype');
const areas = index(loadAll('subject-areas', '.yaml', 'subject-area'), 'subject area');
const layouts = loadAll('layouts', '.json', 'layout');

// A "link" is anything that migrates a key: a relationship or a subtype member.
const links = new Map();
for (const { file, data } of relationships.values()) {
  links.set(data.id, { file, id: data.id, parent: data.parent, child: data.child, kind: data.kind, parentKey: data.parentKey, scope: data.scope ?? 'both' });
}
for (const { file, data } of subtypes.values()) {
  for (const m of data.members) {
    if (links.has(m.id)) err(file, `member id "${m.id}" clashes with another relationship or subtype member`);
    else links.set(m.id, { file, id: m.id, parent: data.supertype, child: m.entity, kind: 'subtype', scope: data.scope ?? 'both' });
  }
}

const attrOf = (entityId, attrId) => entities.get(entityId)?.data.attributes.find((a) => a.id === attrId);
const typeKey = (a) => JSON.stringify(a.domain ? { domain: a.domain } : (a.type ?? null));
const scopeOk = (inner, outer) => outer === 'both' || inner === outer; // inner must not outlive outer

for (const { file, data: e } of entities.values()) {
  const seen = new Set();
  for (const a of e.attributes) {
    if (seen.has(a.id)) err(file, `duplicate attribute id "${a.id}"`);
    seen.add(a.id);
    if (a.domain && !domains.has(a.domain)) err(file, `attribute "${a.id}": unknown domain "${a.domain}"`);
    if (a.term && !terms.has(a.term)) err(file, `attribute "${a.id}": unknown term "${a.term}"`);
    if (!scopeOk(a.scope ?? e.scope ?? 'both', e.scope ?? 'both')) err(file, `attribute "${a.id}": scope is wider than its entity's`);
    for (const m of a.migratedFrom ?? []) {
      const link = links.get(m.relationship);
      if (!link) {
        err(file, `attribute "${a.id}": unknown relationship "${m.relationship}"`);
        continue;
      }
      if (link.child !== e.id) err(file, `attribute "${a.id}": "${m.relationship}" does not have this entity as its child`);
      if (link.kind === 'many-to-many') err(file, `attribute "${a.id}": a many-to-many relationship migrates nothing`);
      const src = attrOf(link.parent, m.attribute);
      if (!src) err(file, `attribute "${a.id}": parent "${link.parent}" has no attribute "${m.attribute}"`);
      else {
        if (typeKey(src) !== typeKey(a)) err(file, `attribute "${a.id}": type differs from ${link.parent}.${m.attribute}`);
        if (!a.rolenamed && src.name !== a.name) err(file, `attribute "${a.id}": name differs from ${link.parent}.${m.attribute} but rolenamed is not set`);
      }
      if (link.parent === link.child && !a.rolenamed) err(file, `attribute "${a.id}": a recursive relationship needs a rolename`);
    }
  }
  const keyIds = new Set();
  for (const k of e.keys ?? []) {
    if (keyIds.has(k.id)) err(file, `duplicate key id "${k.id}"`);
    keyIds.add(k.id);
    for (const a of k.attributes) if (!seen.has(a)) err(file, `key "${k.id}": unknown attribute "${a}"`);
  }
  if ((e.keys ?? []).filter((k) => k.kind === 'primary').length > 1) err(file, 'more than one primary key');
}

for (const link of links.values()) {
  const { file, id } = link;
  for (const side of ['parent', 'child']) if (!entities.has(link[side])) err(file, `"${id}": unknown ${side} entity "${link[side]}"`);
  const parent = entities.get(link.parent)?.data;
  const child = entities.get(link.child)?.data;
  if (!parent || !child || link.kind === 'many-to-many') continue;
  for (const [side, e] of [['parent', parent], ['child', child]]) {
    if (!scopeOk(link.scope, e.scope ?? 'both')) err(file, `"${id}": scope is wider than its ${side} entity's`);
  }
  const key = (parent.keys ?? []).find((k) => (link.parentKey ? k.id === link.parentKey : k.kind === 'primary'));
  if (!key) {
    err(file, `"${id}": parent "${parent.id}" has no ${link.parentKey ? `key "${link.parentKey}"` : 'primary key'} to migrate`);
    continue;
  }
  const childPk = new Set((child.keys ?? []).find((k) => k.kind === 'primary')?.attributes ?? []);
  for (const pa of key.attributes) {
    const targets = child.attributes.filter((a) => (a.migratedFrom ?? []).some((m) => m.relationship === id && m.attribute === pa));
    if (targets.length !== 1) err(file, `"${id}": ${parent.id}.${pa} must migrate to exactly one attribute of "${child.id}" (found ${targets.length})`);
    for (const t of targets) {
      const inPk = childPk.has(t.id);
      if ((link.kind === 'identifying' || link.kind === 'subtype') && !inPk) err(file, `"${id}": ${child.id}.${t.id} must be part of the child's primary key`);
      if (link.kind === 'non-identifying' && inPk && childPk.size === 1) err(file, `"${id}": non-identifying, but ${child.id}.${t.id} is the child's whole primary key`);
    }
  }
}
for (const { file, data: r } of relationships.values()) {
  if (r.resolvedBy && !entities.has(r.resolvedBy)) err(file, `unknown resolvedBy entity "${r.resolvedBy}"`);
}
for (const { file, data: s } of subtypes.values()) {
  if (s.discriminator && entities.has(s.supertype) && !attrOf(s.supertype, s.discriminator)) err(file, `supertype "${s.supertype}" has no attribute "${s.discriminator}"`);
}

for (const { file, data } of areas.values()) {
  for (const e of data.entities) if (!entities.has(e)) err(file, `unknown entity "${e}"`);
}
const layoutAreas = new Set();
for (const { file, data } of layouts) {
  const area = data.subjectArea ?? '';
  if (layoutAreas.has(area)) err(file, `second layout for ${area ? `subject area "${area}"` : 'the whole model'}`);
  layoutAreas.add(area);
  if (area && !areas.has(area)) err(file, `unknown subject area "${area}"`);
  const members = area && areas.has(area) ? new Set(areas.get(area).data.entities) : null;
  for (const n of Object.keys(data.nodes)) {
    if (!entities.has(n)) err(file, `node for unknown entity "${n}"`);
    else if (members && !members.has(n)) err(file, `entity "${n}" is not in subject area "${area}"`);
  }
  for (const e of Object.keys(data.edges ?? {})) if (!links.has(e)) err(file, `edge for unknown relationship "${e}"`);
}

if (errors.length) {
  for (const e of errors) console.error(e);
  console.error(`\n${errors.length} error(s)`);
  process.exit(1);
}
console.log(
  `OK: ${entities.size} entities, ${relationships.size} relationships, ${subtypes.size} subtype clusters, ` +
    `${areas.size} subject areas, ${layouts.length} layouts, ${words.size} words, ${terms.size} terms, ${domains.size} domains`,
);
