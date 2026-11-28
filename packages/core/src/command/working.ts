import type {
  AttributeData,
  DeepReadonly,
  EntityData,
  KeyData,
  LayoutData,
  ModelItem,
  ReadonlyModel,
  SubjectAreaData,
} from '../model/types.js';
import type { IdSpace, Physical, SuffixMemory } from './ids.js';
import {
  fileSpace,
  type InitialPaths,
  newItemFile,
  type NewItemFolder,
  pathKey,
} from './paths.js';
import { noteWork } from './work.js';

/** The lists of a model, in the order of `Model`. */
export const LIST_NAMES = [
  'entities',
  'relationships',
  'subtypes',
  'subjectAreas',
  'layouts',
  'dictionaries',
] as const;

export type ListName = (typeof LIST_NAMES)[number];

/** One item of any list, as the model holds it. */
export type Item = DeepReadonly<ModelItem<unknown>>;

/** A list being worked on: a removed item leaves a hole, so positions stay. */
export type Cells = readonly (Item | undefined)[];

/** What stays the same while an editor lives (spec FR-01, FR-06). */
export interface EditorPlaces {
  readonly initial: InitialPaths;
  /** The comparison keys of the reserved paths. */
  readonly reservedKeys: ReadonlySet<string>;
  /** The dictionary folders of the model, as `dictionaryFolders` gives them. */
  readonly dictionaryFolders: readonly string[];
}

/** The `id` of an item's data, when it has one. */
function idOf(item: Item): string | undefined {
  const data = item.data;
  if (typeof data !== 'object' || data === null) return undefined;
  const id = (data as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

/** A plain array of the same entries, with its length noted as copied. */
function copyList<T>(list: readonly T[]): T[] {
  noteWork('copy', list.length);
  const out: T[] = [];
  for (const entry of list) out.push(entry);
  return out;
}

/**
 * The one copy of an item's data per list (Phase 5 review): the data object
 * and every object one level down that a handler changes in place. Entities:
 * `physical`, `attributes`, `keys` (an attribute or key a handler changes is
 * replaced by a new object, never changed in place); subject areas:
 * `entities`; layouts: `nodes`. Other lists: the data object.
 */
function copyData(list: ListName, data: unknown): unknown {
  switch (list) {
    case 'entities': {
      const entity = data as DeepReadonly<EntityData>;
      return {
        ...entity,
        ...(entity.physical === undefined
          ? {}
          : { physical: { ...entity.physical } }),
        attributes: copyList(entity.attributes),
        ...(entity.keys === undefined ? {} : { keys: copyList(entity.keys) }),
      };
    }
    case 'subjectAreas': {
      const area = data as DeepReadonly<SubjectAreaData>;
      return { ...area, entities: copyList(area.entities) };
    }
    case 'layouts': {
      const layout = data as DeepReadonly<LayoutData>;
      noteWork('copy', Object.keys(layout.nodes).length);
      return { ...layout, nodes: { ...layout.nodes } };
    }
    default:
      return { ...(data as object) };
  }
}

/** Positions by id in one list. */
class IdIndex {
  private readonly positions = new Map<string, number[]>();

  constructor(cells: Cells) {
    noteWork('index-build', cells.length);
    for (let i = 0; i < cells.length; i += 1) {
      const item = cells[i];
      if (item) this.add(item, i);
    }
  }

  of(id: string): readonly number[] {
    return this.positions.get(id) ?? [];
  }

  add(item: Item, position: number): void {
    const id = idOf(item);
    if (id === undefined) return;
    const at = this.positions.get(id);
    if (at) at.push(position);
    else this.positions.set(id, [position]);
  }

  remove(item: Item, position: number): void {
    const id = idOf(item);
    const at = id === undefined ? undefined : this.positions.get(id);
    if (!at) return;
    // An id is shared by few items (more than one only in a model with R01).
    const kept: number[] = [];
    for (const p of at) if (p !== position) kept.push(p);
    if (kept.length > 0) this.positions.set(id!, kept);
    else this.positions.delete(id!);
  }
}

/** The lists inside an entity that commands change: its attributes and keys. */
export type Member = 'attributes' | 'keys';

type MemberData = { readonly id: string };

/** Positions by id among the attributes or keys of one entity. */
function memberIndex(members: readonly MemberData[]): Map<string, number[]> {
  noteWork('index-build', members.length);
  const positions = new Map<string, number[]>();
  for (let i = 0; i < members.length; i += 1) {
    const id = members[i]!.id;
    const at = positions.get(id);
    if (at) at.push(i);
    else positions.set(id, [i]);
  }
  return positions;
}

/** A new attribute or key object a handler may change in place. */
function copyMember(member: Member, data: MemberData): MemberData {
  if (member === 'attributes') {
    const attribute = data as DeepReadonly<AttributeData>;
    const made: DeepReadonly<AttributeData> =
      attribute.physical === undefined
        ? { ...attribute }
        : { ...attribute, physical: { ...attribute.physical } };
    return made;
  }
  const key = data as DeepReadonly<KeyData>;
  const made: DeepReadonly<KeyData> = {
    ...key,
    attributes: copyList(key.attributes),
    ...(key.physical === undefined ? {} : { physical: { ...key.physical } }),
  };
  return made;
}

/** A subject area's data being changed, with the ids it holds. */
interface OwnedArea {
  data: SubjectAreaData;
  members: Set<string>;
}

/**
 * The state one `execute` works on: the model it started from and the
 * changes made since, applied in place to copies this state owns. Every
 * change to a list or an index goes through here and reports its work to
 * `noteWork` (plan decision 9): a list is copied once, when first changed;
 * an index is built once, when first asked; then each change costs a few
 * cells. Nothing here is shared with the start model or kept after the call.
 */
export class Working {
  private readonly lists = new Map<ListName, (Item | undefined)[]>();
  /** Items made by this state, whose data may be changed in place. */
  private readonly owned = new Set<Item>();
  private readonly indexes = new Map<ListName, IdIndex>();
  private keyCounts: Map<string, number> | undefined;
  private readonly areas = new Map<Item, OwnedArea>();
  /** By entity position, then member: positions by id; dropped when stale. */
  private readonly memberIndexes = new Map<
    number,
    Map<Member, Map<string, number[]>>
  >();
  /** Attributes and keys made by this state, which it may change in place. */
  private readonly ownedMembers = new Set<object>();
  /** By namespace: the suffix memory of generated ids (spec FR-05). */
  private readonly suffixMemories = new Map<string, SuffixMemory>();

  constructor(
    readonly start: ReadonlyModel,
    private readonly places: EditorPlaces,
  ) {}

  /** The items of `list` now; holes where items were removed. */
  cells(list: ListName): Cells {
    return this.lists.get(list) ?? (this.start[list] as Cells);
  }

  /** The lists this state changed. */
  changedLists(): ReadonlyMap<ListName, Cells> {
    return this.lists;
  }

  /** Whether this state made `item` (it is not one of the start model's). */
  isOwned(item: Item): boolean {
    return this.owned.has(item);
  }

  item<T>(list: ListName, position: number): DeepReadonly<ModelItem<T>> {
    return this.cells(list)[position] as DeepReadonly<ModelItem<T>>;
  }

  /** The positions of the items of `list` with this id. */
  positions(list: 'entities' | 'subjectAreas', id: string): readonly number[] {
    let index = this.indexes.get(list);
    if (!index) {
      index = new IdIndex(this.cells(list));
      this.indexes.set(list, index);
    }
    return index.of(id);
  }

  /** The id namespace of entities, with the files new entities get. */
  entitySpace(): Extract<IdSpace, { kind: 'entity' }> {
    return {
      kind: 'entity',
      hasId: (id) => this.positions('entities', id).length > 0,
      physicalsOf: (id) => {
        const physicals: (Physical | undefined)[] = [];
        for (const p of this.positions('entities', id)) {
          physicals.push(this.item<EntityData>('entities', p).data.physical);
        }
        return physicals;
      },
      files: this.files('entities'),
      suffixes: this.suffixes('entities'),
    };
  }

  /** The id namespace of subject areas, with the files new ones get. */
  subjectAreaSpace(): Extract<IdSpace, { kind: 'subject area' }> {
    return {
      kind: 'subject area',
      hasId: (id) => this.positions('subjectAreas', id).length > 0,
      files: this.files('subject-areas'),
      suffixes: this.suffixes('subjectAreas'),
    };
  }

  /** The id namespace of the attributes or keys of the entity at `entity`. */
  memberSpace(
    entity: number,
    member: Member,
    entityId: string,
  ): Extract<IdSpace, { kind: 'attribute' | 'key' }> {
    return {
      kind: member === 'attributes' ? 'attribute' : 'key',
      entity: entityId,
      hasId: (id) => this.memberPositions(entity, member, id).length > 0,
      // By position: an entity made again in the batch is another namespace.
      suffixes: this.suffixes(`${member} ${entity}`),
    };
  }

  /** The positions of the attributes or keys with this id in the entity at `entity`. */
  memberPositions(
    entity: number,
    member: Member,
    id: string,
  ): readonly number[] {
    let byMember = this.memberIndexes.get(entity);
    if (!byMember) {
      byMember = new Map();
      this.memberIndexes.set(entity, byMember);
    }
    let index = byMember.get(member);
    if (!index) {
      index = memberIndex(this.members(entity, member));
      byMember.set(member, index);
    }
    return index.get(id) ?? [];
  }

  /**
   * Puts `value` (a new object this state now owns) among the members of the
   * entity at `entity`: before the one at `before`, or at the end. Makes
   * `keys` when the entity has none.
   */
  insertMember(
    entity: number,
    member: Member,
    value: MemberData,
    before?: number,
  ): void {
    const list = this.ownMembers(entity, member);
    this.ownedMembers.add(value);
    if (before === undefined) {
      noteWork('copy', 1);
      list.push(value);
      const index = this.memberIndexes.get(entity)?.get(member);
      const at = index?.get(value.id);
      if (at) at.push(list.length - 1);
      else index?.set(value.id, [list.length - 1]);
      return;
    }
    noteWork('copy', list.length - before + 1);
    list.splice(before, 0, value);
    this.staleMembers(entity, member);
  }

  /** Takes the member at `position` out of the entity at `entity`. */
  removeMember(entity: number, member: Member, position: number): void {
    const list = this.ownMembers(entity, member);
    noteWork('copy', list.length - position);
    list.splice(position, 1);
    this.staleMembers(entity, member);
  }

  /** Moves the member at `from` before the one at `before`, or to the end. */
  moveMember(
    entity: number,
    member: Member,
    from: number,
    before?: number,
  ): void {
    const list = this.ownMembers(entity, member);
    noteWork('copy', list.length);
    const [moved] = list.splice(from, 1);
    let to = before ?? list.length + 1;
    if (to > from) to -= 1;
    list.splice(to, 0, moved!);
    this.staleMembers(entity, member);
  }

  /**
   * The member at `position` of the entity at `entity`, to change in place:
   * the first time replaced by a new object this state owns.
   */
  ownMember<T>(entity: number, member: Member, position: number): T {
    const list = this.ownMembers(entity, member);
    const value = list[position]!;
    if (this.ownedMembers.has(value)) return value as T;
    const made = copyMember(member, value);
    noteWork('copy', 1);
    list[position] = made;
    this.ownedMembers.add(made);
    return made as T;
  }

  /**
   * Takes the attribute `attribute` out of the keys of the entity at
   * `entity`; a key it leaves with no attribute goes, and `keys` with the
   * last one (spec FR-07).
   */
  removeFromKeys(entity: number, attribute: string): void {
    const keys = this.members(
      entity,
      'keys',
    ) as readonly DeepReadonly<KeyData>[];
    noteWork('scan', keys.length);
    // The first key that holds it; with none, nothing is owned or changed.
    let first = -1;
    for (let p = 0; p < keys.length && first < 0; p += 1) {
      const held = keys[p]!.attributes;
      noteWork('scan', held.length);
      if (held.includes(attribute)) first = p;
    }
    if (first < 0) return;
    // One pass from there: each key that holds it loses it, and the keys
    // left with an attribute close up behind, so the list is moved once
    // however many keys go (Codex review: one splice per key was n²).
    const list = this.ownMembers(entity, 'keys') as KeyData[];
    let kept = first;
    for (let p = first; p < list.length; p += 1) {
      const held = list[p]!.attributes;
      if (p > first) noteWork('scan', held.length);
      if (!held.includes(attribute)) {
        list[kept++] = list[p]!;
        continue;
      }
      const key = this.ownMember<KeyData>(entity, 'keys', p);
      let left = 0;
      for (const id of key.attributes)
        if (id !== attribute) key.attributes[left++] = id;
      key.attributes.length = left;
      if (left > 0) list[kept++] = key;
    }
    if (kept === list.length) return;
    noteWork('copy', list.length - first);
    list.length = kept;
    this.staleMembers(entity, 'keys');
    this.dropEmptyKeys(entity);
  }

  /** Removes `keys` from the entity at `entity` when a command emptied it. */
  dropEmptyKeys(entity: number): void {
    const data = this.own<EntityData>('entities', entity);
    if (data.keys && data.keys.length === 0) delete data.keys;
  }

  /** The data of the subject area at `position`, to change in place. */
  ownSubjectArea(position: number): SubjectAreaData {
    return this.ownArea(position).data;
  }

  /** Takes `ids` out of the subject area at `position`; ids it lacks are ignored. */
  removeFromArea(position: number, ids: readonly string[]): void {
    const area = this.ownArea(position);
    const gone = new Set<string>();
    for (const id of ids) if (area.members.delete(id)) gone.add(id);
    if (gone.size === 0) return;
    const list = area.data.entities;
    noteWork('scan', list.length);
    let kept = 0;
    for (const id of list) if (!gone.has(id)) list[kept++] = id;
    list.length = kept;
  }

  /** Takes the nodes of `ids` out of every layout of the subject area `area`. */
  removeAreaNodes(area: string, ids: readonly string[]): void {
    const cells = this.cells('layouts');
    noteWork('scan', cells.length);
    // Built once, when a layout of the area has a node: then each layout's
    // own nodes are walked once, so the work is the ids plus the nodes of
    // the area's layouts, not the ids times the layouts (Codex review).
    let gone: Set<string> | undefined;
    for (let p = 0; p < cells.length; p += 1) {
      const item = cells[p];
      if (!item || (item.data as LayoutData).subjectArea !== area) continue;
      const nodes = Object.keys((item.data as LayoutData).nodes);
      noteWork('scan', nodes.length);
      if (nodes.length === 0) continue;
      if (!gone) {
        noteWork('index-build', ids.length);
        gone = new Set(ids);
      }
      let holds = false;
      for (let i = 0; i < nodes.length && !holds; i += 1) {
        holds = gone.has(nodes[i]!);
      }
      if (!holds) continue;
      const data = this.own<LayoutData>('layouts', p);
      for (const id of nodes) if (gone.has(id)) delete data.nodes[id];
    }
  }

  /** Removes every layout of the subject area `area`. */
  removeLayoutsOf(area: string): void {
    const cells = this.cells('layouts');
    noteWork('scan', cells.length);
    for (let p = 0; p < cells.length; p += 1) {
      const item = cells[p];
      if (item && (item.data as LayoutData).subjectArea === area) {
        this.remove('layouts', p);
      }
    }
  }

  /** The file of a new item with this id. */
  newFile(folder: NewItemFolder, id: string): string {
    return newItemFile(this.start.dir, folder, id);
  }

  /** Adds `item` at the end of `list`. */
  append(list: ListName, item: Item): void {
    const cells = this.writable(list);
    noteWork('copy', 1);
    cells.push(item);
    this.owned.add(item);
    this.indexes.get(list)?.add(item, cells.length - 1);
    const counts = this.keyCounts;
    if (counts) {
      const key = pathKey(item.file);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  /** Removes the item at `position` of `list`. */
  remove(list: ListName, position: number): void {
    const cells = this.writable(list);
    const item = cells[position]!;
    noteWork('copy', 1);
    cells[position] = undefined;
    this.indexes.get(list)?.remove(item, position);
    const counts = this.keyCounts;
    if (counts) {
      const key = pathKey(item.file);
      const left = (counts.get(key) ?? 1) - 1;
      if (left > 0) counts.set(key, left);
      else counts.delete(key);
    }
  }

  /**
   * The data of the item at `position` of `list`, to change in place: the
   * first time copied into a new item this state owns, then that same
   * object. The copy is the list's one copy (`copyData`), whoever asks first,
   * so it holds new objects for everything any handler changes in place.
   */
  own<T>(list: ListName, position: number): T {
    const cells = this.writable(list);
    const item = cells[position]!;
    if (this.owned.has(item)) return item.data as T;
    const made: Item = {
      file: item.file,
      data: copyData(list, item.data) as DeepReadonly<unknown>,
    };
    noteWork('copy', 1);
    cells[position] = made;
    this.owned.add(made);
    return made.data as T;
  }

  /** Puts `entity` in the subject area at `position`, unless it is there. */
  addToArea(position: number, entity: string): void {
    const area = this.ownArea(position);
    if (area.members.has(entity)) return;
    noteWork('copy', 1);
    area.data.entities.push(entity);
    area.members.add(entity);
  }

  /** Takes `entity` out of every subject area that holds it. */
  removeFromAreas(entity: string): void {
    const cells = this.cells('subjectAreas');
    noteWork('scan', cells.length);
    for (let p = 0; p < cells.length; p += 1) {
      const item = cells[p];
      if (!item) continue;
      const owned = this.areas.get(item);
      const holds = owned
        ? owned.members.has(entity)
        : this.listed((item.data as SubjectAreaData).entities, entity);
      if (!holds) continue;
      const area = this.ownArea(p);
      const ids = area.data.entities;
      noteWork('scan', ids.length);
      let kept = 0;
      for (const id of ids) if (id !== entity) ids[kept++] = id;
      ids.length = kept;
      area.members.delete(entity);
    }
  }

  /** Takes the node of `entity` out of every layout that has one. */
  removeNodes(entity: string): void {
    const cells = this.cells('layouts');
    noteWork('scan', cells.length);
    for (let p = 0; p < cells.length; p += 1) {
      const item = cells[p];
      if (!item) continue;
      const nodes = (item.data as LayoutData).nodes;
      if (!Object.hasOwn(nodes, entity)) continue;
      const data = this.own<LayoutData>('layouts', p);
      delete data.nodes[entity];
    }
  }

  /** The suffix memory of the namespace `name`, made on first use. */
  private suffixes(name: string): SuffixMemory {
    let memory = this.suffixMemories.get(name);
    if (!memory) {
      memory = new Map();
      this.suffixMemories.set(name, memory);
    }
    return memory;
  }

  /** The attributes or keys of the entity at `entity` now. */
  private members(entity: number, member: Member): readonly MemberData[] {
    const data = this.item<EntityData>('entities', entity).data;
    return (data[member] ?? []) as readonly MemberData[];
  }

  /** The members of the entity at `entity` as an array this state owns. */
  private ownMembers(entity: number, member: Member): MemberData[] {
    const data = this.own<EntityData>('entities', entity);
    if (member === 'keys') data.keys ??= [];
    return data[member] as MemberData[];
  }

  private staleMembers(entity: number, member: Member): void {
    this.memberIndexes.get(entity)?.delete(member);
  }

  private listed(ids: readonly string[], entity: string): boolean {
    noteWork('scan', ids.length);
    return ids.includes(entity);
  }

  private ownArea(position: number): OwnedArea {
    const data = this.own<SubjectAreaData>('subjectAreas', position);
    const item = this.cells('subjectAreas')[position]!;
    let area = this.areas.get(item);
    if (!area) {
      noteWork('index-build', data.entities.length);
      area = { data, members: new Set(data.entities) };
      this.areas.set(item, area);
    }
    return area;
  }

  private writable(list: ListName): (Item | undefined)[] {
    let cells = this.lists.get(list);
    if (!cells) {
      const from = this.cells(list);
      noteWork('copy', from.length);
      cells = [];
      for (const item of from) cells.push(item);
      this.lists.set(list, cells);
    }
    return cells;
  }

  /** The file questions of new entities or subject areas (spec FR-06). */
  private files(folder: NewItemFolder) {
    return fileSpace({
      dir: this.start.dir,
      folder,
      used: { has: (key) => this.isUsedKey(key) },
      initial: this.places.initial,
      dictionaryFolders: this.places.dictionaryFolders,
    });
  }

  /** Whether an item now, or a reserved path, has a path with this key. */
  private isUsedKey(key: string): boolean {
    if (this.places.reservedKeys.has(key)) return true;
    let counts = this.keyCounts;
    if (!counts) {
      counts = new Map();
      const manifest = this.start.manifest;
      let entries = 0;
      const count = (file: string) => {
        entries += 1;
        const at = pathKey(file);
        counts!.set(at, (counts!.get(at) ?? 0) + 1);
      };
      if (manifest) count(manifest.file);
      for (const list of LIST_NAMES) {
        for (const item of this.cells(list)) if (item) count(item.file);
      }
      noteWork('index-build', entries);
      this.keyCounts = counts;
    }
    return counts.has(key);
  }
}
