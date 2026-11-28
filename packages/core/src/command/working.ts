import type {
  DeepReadonly,
  EntityData,
  LayoutData,
  ModelItem,
  ReadonlyModel,
  SubjectAreaData,
} from '../model/types.js';
import type { IdSpace, Physical } from './ids.js';
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
    };
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
