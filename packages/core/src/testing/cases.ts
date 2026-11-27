import type { Issue } from '../model/types.js';
import { exampleFiles, type Files, replaceOnce } from './example.js';

/** One change to the example: replace the one occurrence of `search` in `file`. */
export interface Replace {
  file: string;
  search: string;
  replace: string;
}

/** One change to the example: a file that is not in it. */
export interface Add {
  file: string;
  add: string;
}

export type Change = Replace | Add;

/** A case of spec Appendix A: the example with some changes, and every issue it must give. */
export interface RuleCase {
  name: string;
  /** The rows of Appendix A this case shows. */
  rows: number[];
  changes: Change[];
  /** Every issue of the model, sorted as `validateProject` returns them. */
  issues: Issue[];
  /**
   * Set when the parity test against the old tool leaves the case out: why
   * (only behaviour FR-13 lists as changed on purpose).
   */
  parityExcluded?: string;
}

/** A copy of `files` with `file` added. Throws when it is already there. */
export function addFile(files: Files, file: string, text: string): Files {
  if (file in files) throw new Error(`${file} is already in the example`);
  return { ...files, [file]: text };
}

/** The example files with the case's changes applied, in order. */
export function caseFiles(
  rule: RuleCase,
  files: Files = exampleFiles(),
): Files {
  return rule.changes.reduce(
    (out, change) =>
      'add' in change
        ? addFile(out, change.file, change.add)
        : replaceOnce(out, change.file, change.search, change.replace),
    files,
  );
}

const error = (
  rule: Issue['rule'],
  file: string,
  path: string,
  line: number,
  column: number,
  message: string,
): Issue => ({ rule, severity: 'error', file, path, line, column, message });

const replace = (
  file: string,
  search: string,
  replacement: string,
): Replace => ({
  file,
  search,
  replace: replacement,
});

const DICTIONARY = 'dictionary/standard.yaml';
const MODEL = 'model.yaml';
const SUBTYPE = 'subtypes/customer_type.yaml';
const PARTY = 'subject-areas/party.yaml';
const CATALOG_LAYOUT = 'layouts/catalog.json';
const SALES_LAYOUT = 'layouts/sales.json';
const entity = (id: string) => `entities/${id}.yaml`;
const relationship = (id: string) => `relationships/${id}.yaml`;

const FR13_TYPE = 'FR-13: row 18, types that differ only in key order';
const FR13_MANY = 'FR-13: row 25, the scope rule on many-to-many';
const FR13_PARENT_KEY =
  'FR-13: row 26, parentKey naming a primary or inversion key';
const FR13_KEY_PART = 'FR-13: row 38, migratedFrom outside the migrated key';

/**
 * The cases of spec Appendix A. Messages and paths come from Appendix A,
 * lines and columns from the changed files.
 */
export const RULE_CASES: RuleCase[] = [
  // Row 1, all seven kinds.
  {
    name: 'duplicate entity id',
    rows: [1],
    changes: [
      replace(
        entity('personal_customer'),
        'id: personal_customer\n',
        'id: customer\n',
      ),
    ],
    issues: [
      error(
        'R01',
        entity('personal_customer'),
        '/id',
        1,
        1,
        'duplicate entity id "customer" (also in entities/customer.yaml)',
      ),
      error(
        'R02',
        PARTY,
        '/entities/3',
        8,
        5,
        'unknown entity "personal_customer"',
      ),
      error(
        'R02',
        SUBTYPE,
        '/members/0/entity',
        7,
        5,
        '"customer_is_personal": unknown child entity "personal_customer"',
      ),
    ],
  },
  {
    name: 'duplicate relationship id',
    rows: [1],
    changes: [
      replace(
        relationship('product_has_tag'),
        'id: product_has_tag\n',
        'id: order_ships_to\n',
      ),
    ],
    issues: [
      error(
        'R01',
        relationship('product_has_tag'),
        '/id',
        1,
        1,
        'duplicate relationship id "order_ships_to" (also in relationships/order_ships_to.yaml)',
      ),
    ],
  },
  {
    name: 'duplicate subtype id',
    rows: [1],
    changes: [
      {
        file: 'subtypes/zz.yaml',
        add: 'id: customer_type\nsupertype: customer\nmembers:\n  - id: customer_is_vip\n    entity: personal_customer\n',
      },
    ],
    issues: [
      error(
        'R01',
        'subtypes/zz.yaml',
        '/id',
        1,
        1,
        'duplicate subtype id "customer_type" (also in subtypes/customer_type.yaml)',
      ),
    ],
  },
  {
    name: 'duplicate subject area id',
    rows: [1],
    changes: [replace(PARTY, 'id: party\n', 'id: catalog\n')],
    issues: [
      error(
        'R01',
        PARTY,
        '/id',
        1,
        1,
        'duplicate subject area id "catalog" (also in subject-areas/catalog.yaml)',
      ),
    ],
  },
  {
    name: 'duplicate word id',
    rows: [1],
    changes: [
      replace(
        DICTIONARY,
        'terms:\n',
        '  - id: cust\n    name: 고객2\nterms:\n',
      ),
    ],
    issues: [
      error(
        'R01',
        DICTIONARY,
        '/words/5/id',
        29,
        5,
        'duplicate word id "cust" (also in dictionary/standard.yaml)',
      ),
    ],
  },
  {
    // The first term of an id is the one checked: the second's unknown word is not reported.
    name: 'duplicate term id',
    rows: [1],
    changes: [
      replace(
        DICTIONARY,
        'domains:\n',
        '  - id: cust_no\n    name: 고객번호2\n    words:\n      - nowhere\ndomains:\n',
      ),
    ],
    issues: [
      error(
        'R01',
        DICTIONARY,
        '/terms/4/id',
        58,
        5,
        'duplicate term id "cust_no" (also in dictionary/standard.yaml)',
      ),
    ],
  },
  {
    name: 'duplicate domain id',
    rows: [1],
    changes: [
      replace(
        DICTIONARY,
        '        meaning: 법인\n',
        '        meaning: 법인\n  - id: code\n    name: 코드2\n    type:\n      base: string\n',
      ),
    ],
    issues: [
      error(
        'R01',
        DICTIONARY,
        '/domains/8/id',
        112,
        5,
        'duplicate domain id "code" (also in dictionary/standard.yaml)',
      ),
    ],
  },
  {
    name: 'term with an unknown word',
    rows: [2],
    changes: [replace(DICTIONARY, '      - nm\n', '      - nmx\n')],
    issues: [
      error(
        'R02',
        DICTIONARY,
        '/terms/1/words/1',
        41,
        9,
        'term "cust_nm": unknown word "nmx"',
      ),
    ],
  },
  {
    name: 'term with two unknown words',
    rows: [2],
    changes: [
      replace(
        DICTIONARY,
        '      - ord\n      - dtm\n',
        '      - ordx\n      - dtmx\n',
      ),
    ],
    issues: [
      error(
        'R02',
        DICTIONARY,
        '/terms/3/words/0',
        54,
        9,
        'term "ord_dtm": unknown word "ordx"',
      ),
      error(
        'R02',
        DICTIONARY,
        '/terms/3/words/1',
        55,
        9,
        'term "ord_dtm": unknown word "dtmx"',
      ),
    ],
  },
  {
    name: 'term with an unknown domain',
    rows: [3],
    changes: [replace(DICTIONARY, '    domain: name\n', '    domain: namex\n')],
    issues: [
      error(
        'R02',
        DICTIONARY,
        '/terms/1/domain',
        43,
        5,
        'term "cust_nm": unknown domain "namex"',
      ),
    ],
  },
  {
    name: 'duplicate schema name',
    rows: [4],
    changes: [
      replace(
        MODEL,
        'areaGroups:\n',
        'schemas:\n  - name: shop\n  - name: shop\nareaGroups:\n',
      ),
    ],
    issues: [
      error('R10', MODEL, '/schemas/1/name', 10, 5, 'duplicate schema "shop"'),
    ],
  },
  {
    name: 'duplicate area group id',
    rows: [5],
    changes: [
      replace(
        MODEL,
        '    name: 거래\n',
        '    name: 거래\n  - id: master\n    name: 다시\n',
      ),
    ],
    issues: [
      error(
        'R12',
        MODEL,
        '/areaGroups/2/id',
        13,
        5,
        'duplicate area group id "master"',
      ),
    ],
  },
  {
    // The other entities have no physical.schema, which is allowed although schemas is listed.
    name: 'physical.schema not in the schemas list',
    rows: [6],
    changes: [
      replace(
        MODEL,
        'areaGroups:\n',
        'schemas:\n  - name: main\nareaGroups:\n',
      ),
      replace(entity('tag'), '  name: TAG\n', '  name: TAG\n  schema: other\n'),
    ],
    issues: [
      error(
        'R10',
        entity('tag'),
        '/physical/schema',
        5,
        3,
        'physical.schema "other" is not listed in model.yaml',
      ),
    ],
  },
  {
    name: 'physical.schema without a schemas list, and a table name another schema uses',
    rows: [6, 7],
    changes: [
      replace(
        entity('tag'),
        '  name: TAG\n',
        '  name: PRODUCT\n  schema: other\n',
      ),
    ],
    issues: [],
  },
  {
    name: 'table name used twice in the same schema',
    rows: [7],
    changes: [replace(entity('tag'), '  name: TAG\n', '  name: PRODUCT\n')],
    issues: [
      error(
        'R11',
        entity('tag'),
        '/physical/name',
        4,
        3,
        'table name "PRODUCT" is already used by "product" in the same schema',
      ),
    ],
  },
  {
    name: 'table name of a logical entity is not counted',
    rows: [7],
    changes: [
      {
        file: 'entities/zz.yaml',
        add: 'id: zz\nname: ZZ\nscope: logical\nphysical:\n  name: PRODUCT\nattributes: []\n',
      },
    ],
    issues: [],
  },
  {
    name: 'unknown area group',
    rows: [8],
    changes: [replace(PARTY, 'group: master\n', 'group: nope\n')],
    issues: [error('R12', PARTY, '/group', 3, 1, 'unknown area group "nope"')],
  },
  {
    name: 'subtype member id that a relationship has',
    rows: [9],
    changes: [
      replace(
        SUBTYPE,
        '  - id: customer_is_corporate\n',
        '  - id: order_ships_to\n',
      ),
    ],
    issues: [
      error(
        'R02',
        entity('corporate_customer'),
        '/attributes/0/migratedFrom/0/relationship',
        14,
        9,
        'attribute "cust_no": unknown relationship "customer_is_corporate"',
      ),
      error(
        'R01',
        SUBTYPE,
        '/members/1/id',
        9,
        5,
        'member id "order_ships_to" clashes with another relationship or subtype member',
      ),
    ],
  },
  {
    name: 'duplicate attribute id',
    rows: [10],
    changes: [replace(entity('tag'), '  - id: tag_nm\n', '  - id: tag_no\n')],
    issues: [
      error(
        'R01',
        entity('tag'),
        '/attributes/1/id',
        12,
        5,
        'duplicate attribute id "tag_no"',
      ),
      error(
        'R02',
        entity('tag'),
        '/keys/1/attributes/0',
        26,
        9,
        'key "ak_tag_nm": unknown attribute "tag_nm"',
      ),
    ],
  },
  {
    name: 'attribute with an unknown domain',
    rows: [11],
    changes: [
      replace(entity('tag'), '    domain: name\n', '    domain: namex\n'),
    ],
    issues: [
      error(
        'R02',
        entity('tag'),
        '/attributes/1/domain',
        14,
        5,
        'attribute "tag_nm": unknown domain "namex"',
      ),
    ],
  },
  {
    name: 'attribute with an unknown term',
    rows: [12],
    changes: [
      replace(
        entity('customer'),
        '    term: cust_nm\n',
        '    term: cust_nmx\n',
      ),
    ],
    issues: [
      error(
        'R02',
        entity('customer'),
        '/attributes/1/term',
        16,
        5,
        'attribute "cust_nm": unknown term "cust_nmx"',
      ),
    ],
  },
  {
    name: 'attribute scope wider than its entity',
    rows: [13],
    changes: [
      replace(
        entity('product_tag'),
        '    name: 태그번호\n',
        '    name: 태그번호\n    scope: both\n',
      ),
    ],
    issues: [
      error(
        'R08',
        entity('product_tag'),
        '/attributes/1/scope',
        19,
        5,
        'attribute "tag_no": scope is wider than its entity\'s',
      ),
    ],
  },
  {
    name: 'migratedFrom with an unknown relationship',
    rows: [14, 27],
    changes: [
      replace(
        entity('order'),
        '      - relationship: order_ships_to\n',
        '      - relationship: order_ships_tox\n',
      ),
    ],
    issues: [
      error(
        'R02',
        entity('order'),
        '/attributes/2/migratedFrom/0/relationship',
        31,
        9,
        'attribute "ship_addr_no": unknown relationship "order_ships_tox"',
      ),
      error(
        'R04',
        relationship('order_ships_to'),
        '',
        1,
        1,
        '"order_ships_to": address.addr_no must migrate to exactly one attribute of "order" (found 0)',
      ),
    ],
  },
  {
    name: 'migratedFrom with a relationship whose child is another entity',
    rows: [15],
    changes: [
      replace(
        entity('order'),
        '      - relationship: customer_places_order\n        attribute: cust_no\n',
        '      - relationship: customer_places_order\n        attribute: cust_no\n      - relationship: customer_has_address\n        attribute: cust_no\n',
      ),
    ],
    issues: [
      error(
        'R04',
        entity('order'),
        '/attributes/1/migratedFrom/1/relationship',
        24,
        9,
        'attribute "cust_no": "customer_has_address" does not have this entity as its child',
      ),
    ],
  },
  {
    // prod_nm is outside product's primary key: row 38 is not checked on many-to-many.
    name: 'migratedFrom with a many-to-many relationship',
    rows: [16],
    changes: [
      replace(
        entity('tag'),
        '    domain: name\n',
        '    domain: name\n    migratedFrom:\n      - relationship: product_has_tag\n        attribute: prod_nm\n    rolenamed: true\n',
      ),
    ],
    issues: [
      error(
        'R04',
        entity('tag'),
        '/attributes/1/migratedFrom/0/relationship',
        16,
        9,
        'attribute "tag_nm": a many-to-many relationship migrates nothing',
      ),
    ],
  },
  {
    name: 'migratedFrom with an unknown parent attribute',
    rows: [17, 27],
    changes: [
      replace(
        entity('order'),
        '        attribute: cust_no\n',
        '        attribute: cust_nox\n',
      ),
    ],
    issues: [
      error(
        'R02',
        entity('order'),
        '/attributes/1/migratedFrom/0/attribute',
        23,
        9,
        'attribute "cust_no": parent "customer" has no attribute "cust_nox"',
      ),
      error(
        'R04',
        relationship('customer_places_order'),
        '',
        1,
        1,
        '"customer_places_order": customer.cust_no must migrate to exactly one attribute of "order" (found 0)',
      ),
    ],
  },
  {
    name: 'migrated attribute with another domain than its parent',
    rows: [18],
    changes: [
      replace(
        entity('order_item'),
        '    term: ord_no\n    domain: number\n',
        '    term: ord_no\n    domain: quantity\n',
      ),
    ],
    issues: [
      error(
        'R06',
        entity('order_item'),
        '/attributes/0',
        6,
        5,
        'attribute "ord_no": type differs from order.ord_no',
      ),
    ],
  },
  {
    name: 'migrated attribute with a type where its parent has a domain',
    rows: [18],
    changes: [
      replace(
        entity('product_tag'),
        '    name: 태그번호\n    domain: number\n',
        '    name: 태그번호\n    type:\n      base: integer\n',
      ),
    ],
    issues: [
      error(
        'R06',
        entity('product_tag'),
        '/attributes/1',
        17,
        5,
        'attribute "tag_no": type differs from tag.tag_no',
      ),
    ],
  },
  {
    name: 'migrated attribute with a type of other fields than its parent',
    rows: [18],
    changes: [
      replace(
        entity('tag'),
        '    domain: number\n',
        '    type:\n      base: decimal\n      precision: 10\n      scale: 0\n',
      ),
      replace(
        entity('product_tag'),
        '    name: 태그번호\n    domain: number\n',
        '    name: 태그번호\n    type:\n      base: decimal\n      precision: 11\n      scale: 0\n',
      ),
    ],
    issues: [
      error(
        'R06',
        entity('product_tag'),
        '/attributes/1',
        17,
        5,
        'attribute "tag_no": type differs from tag.tag_no',
      ),
    ],
  },
  {
    name: 'migrated attribute with the type of its parent in another key order',
    rows: [18],
    changes: [
      replace(
        entity('tag'),
        '    domain: number\n',
        '    type:\n      base: decimal\n      precision: 10\n      scale: 0\n',
      ),
      replace(
        entity('product_tag'),
        '    name: 태그번호\n    domain: number\n',
        '    name: 태그번호\n    type:\n      scale: 0\n      precision: 10\n      base: decimal\n',
      ),
    ],
    issues: [],
    parityExcluded: FR13_TYPE,
  },
  {
    name: 'migrated attribute and its parent both without domain and type',
    rows: [18],
    changes: [
      replace(entity('tag'), '    domain: number\n', ''),
      replace(
        entity('product_tag'),
        '    name: 태그번호\n    domain: number\n',
        '    name: 태그번호\n',
      ),
    ],
    issues: [],
  },
  {
    name: 'migrated attribute with another name than its parent',
    rows: [19],
    changes: [
      replace(
        entity('order_item'),
        '    name: 주문번호\n',
        '    name: 주문번호2\n',
      ),
    ],
    issues: [
      error(
        'R06',
        entity('order_item'),
        '/attributes/0/name',
        7,
        5,
        'attribute "ord_no": name differs from order.ord_no but rolenamed is not set',
      ),
    ],
  },
  {
    name: 'recursive relationship without a rolename',
    rows: [19, 20],
    changes: [replace(entity('category'), '    rolenamed: true\n', '')],
    issues: [
      error(
        'R07',
        entity('category'),
        '/attributes/2',
        18,
        5,
        'attribute "parent_ctgr_no": a recursive relationship needs a rolename',
      ),
      error(
        'R06',
        entity('category'),
        '/attributes/2/name',
        19,
        5,
        'attribute "parent_ctgr_no": name differs from category.ctgr_no but rolenamed is not set',
      ),
    ],
  },
  {
    name: 'duplicate key id',
    rows: [21],
    changes: [
      replace(entity('customer'), '  - id: ak_email\n', '  - id: pk\n'),
    ],
    issues: [
      error(
        'R01',
        entity('customer'),
        '/keys/1/id',
        41,
        5,
        'duplicate key id "pk"',
      ),
    ],
  },
  {
    name: 'key with an unknown attribute',
    rows: [22],
    changes: [
      replace(entity('customer'), '      - email\n', '      - emailx\n'),
    ],
    issues: [
      error(
        'R02',
        entity('customer'),
        '/keys/1/attributes/0',
        44,
        9,
        'key "ak_email": unknown attribute "emailx"',
      ),
    ],
  },
  {
    name: 'two primary keys',
    rows: [23],
    changes: [
      replace(
        entity('customer'),
        '    kind: alternate\n',
        '    kind: primary\n',
      ),
    ],
    issues: [
      error(
        'R03',
        entity('customer'),
        '/keys/1',
        41,
        5,
        'more than one primary key',
      ),
    ],
  },
  {
    name: 'three primary keys',
    rows: [23],
    changes: [
      replace(
        entity('customer'),
        '    kind: alternate\n',
        '    kind: primary\n',
      ),
      replace(
        entity('customer'),
        '      name: UK_CUSTOMER_EMAIL\n',
        '      name: UK_CUSTOMER_EMAIL\n  - id: pk3\n    kind: primary\n    attributes:\n      - cust_nm\n',
      ),
    ],
    issues: [
      error(
        'R03',
        entity('customer'),
        '/keys/1',
        41,
        5,
        'more than one primary key',
      ),
    ],
  },
  {
    name: 'relationship with an unknown parent entity',
    rows: [24, 17],
    changes: [
      replace(
        relationship('product_ordered_as_item'),
        'parent: product\n',
        'parent: productx\n',
      ),
    ],
    issues: [
      error(
        'R02',
        entity('order_item'),
        '/attributes/2/migratedFrom/0/attribute',
        31,
        9,
        'attribute "prod_no": parent "productx" has no attribute "prod_no"',
      ),
      error(
        'R02',
        relationship('product_ordered_as_item'),
        '/parent',
        3,
        1,
        '"product_ordered_as_item": unknown parent entity "productx"',
      ),
    ],
  },
  {
    name: 'relationship with an unknown child entity',
    rows: [24, 15],
    changes: [
      replace(
        relationship('category_classifies_product'),
        'child: product\n',
        'child: productx\n',
      ),
    ],
    issues: [
      error(
        'R04',
        entity('product'),
        '/attributes/2/migratedFrom/0/relationship',
        25,
        9,
        'attribute "ctgr_no": "category_classifies_product" does not have this entity as its child',
      ),
      error(
        'R02',
        relationship('category_classifies_product'),
        '/child',
        4,
        1,
        '"category_classifies_product": unknown child entity "productx"',
      ),
    ],
  },
  {
    name: 'subtype with an unknown supertype',
    rows: [24, 17],
    changes: [
      replace(SUBTYPE, 'supertype: customer\n', 'supertype: customerx\n'),
    ],
    issues: [
      error(
        'R02',
        entity('corporate_customer'),
        '/attributes/0/migratedFrom/0/attribute',
        15,
        9,
        'attribute "cust_no": parent "customerx" has no attribute "cust_no"',
      ),
      error(
        'R02',
        entity('personal_customer'),
        '/attributes/0/migratedFrom/0/attribute',
        15,
        9,
        'attribute "cust_no": parent "customerx" has no attribute "cust_no"',
      ),
      error(
        'R02',
        SUBTYPE,
        '/supertype',
        2,
        1,
        '"customer_is_corporate": unknown parent entity "customerx"',
      ),
      error(
        'R02',
        SUBTYPE,
        '/supertype',
        2,
        1,
        '"customer_is_personal": unknown parent entity "customerx"',
      ),
    ],
  },
  {
    name: 'subtype member with an unknown entity',
    rows: [24, 15],
    changes: [
      replace(
        SUBTYPE,
        '    entity: personal_customer\n',
        '    entity: personal_customerx\n',
      ),
    ],
    issues: [
      error(
        'R04',
        entity('personal_customer'),
        '/attributes/0/migratedFrom/0/relationship',
        14,
        9,
        'attribute "cust_no": "customer_is_personal" does not have this entity as its child',
      ),
      error(
        'R02',
        SUBTYPE,
        '/members/0/entity',
        7,
        5,
        '"customer_is_personal": unknown child entity "personal_customerx"',
      ),
    ],
  },
  {
    name: 'relationship scope wider than its child entity',
    rows: [25],
    changes: [
      replace(
        relationship('product_tag_product'),
        'scope: physical\n',
        'scope: both\n',
      ),
    ],
    issues: [
      error(
        'R08',
        relationship('product_tag_product'),
        '/scope',
        7,
        1,
        '"product_tag_product": scope is wider than its child entity\'s',
      ),
    ],
  },
  {
    name: 'relationship scope wider than its parent entity, and a child entity narrower than the relationship',
    rows: [25],
    changes: [
      replace(
        entity('product'),
        'name: 상품\nphysical:\n',
        'name: 상품\nscope: logical\nphysical:\n',
      ),
    ],
    issues: [
      error(
        'R08',
        relationship('category_classifies_product'),
        '',
        1,
        1,
        '"category_classifies_product": scope is wider than its child entity\'s',
      ),
      error(
        'R08',
        relationship('product_ordered_as_item'),
        '',
        1,
        1,
        '"product_ordered_as_item": scope is wider than its parent entity\'s',
      ),
      error(
        'R08',
        relationship('product_tag_product'),
        '/scope',
        7,
        1,
        '"product_tag_product": scope is wider than its parent entity\'s',
      ),
    ],
  },
  {
    // The relationship has no scope key, so the path is the object that would hold it.
    name: 'relationship without a scope under a physical child entity',
    rows: [25],
    changes: [
      replace(relationship('product_tag_tag'), 'scope: physical\n', ''),
    ],
    issues: [
      error(
        'R08',
        relationship('product_tag_tag'),
        '',
        1,
        1,
        '"product_tag_tag": scope is wider than its child entity\'s',
      ),
    ],
  },
  {
    name: 'many-to-many relationship scope outside its child entity',
    rows: [25],
    changes: [
      replace(
        relationship('product_has_tag'),
        'child: tag\n',
        'child: product_tag\n',
      ),
    ],
    issues: [
      error(
        'R08',
        relationship('product_has_tag'),
        '/scope',
        9,
        1,
        '"product_has_tag": scope is wider than its child entity\'s',
      ),
    ],
    parityExcluded: FR13_MANY,
  },
  {
    name: 'parentKey that the parent does not have',
    rows: [26],
    changes: [
      replace(
        relationship('customer_places_order'),
        'child: order\n',
        'child: order\nparentKey: ak_emailx\n',
      ),
    ],
    issues: [
      error(
        'R02',
        relationship('customer_places_order'),
        '/parentKey',
        5,
        1,
        '"customer_places_order": parent "customer" has no key "ak_emailx" to migrate',
      ),
    ],
  },
  {
    name: 'parentKey naming the primary key',
    rows: [26],
    changes: [
      replace(
        relationship('customer_places_order'),
        'child: order\n',
        'child: order\nparentKey: pk\n',
      ),
    ],
    issues: [
      error(
        'R04',
        relationship('customer_places_order'),
        '/parentKey',
        5,
        1,
        '"customer_places_order": parentKey "pk" must be an alternate key of "customer"',
      ),
    ],
    parityExcluded: FR13_PARENT_KEY,
  },
  {
    // The checks of what the key migrates still run on the key parentKey names.
    name: 'parentKey naming an inversion entry',
    rows: [26, 27, 38],
    changes: [
      replace(
        relationship('order_contains_item'),
        'child: order_item\n',
        'child: order_item\nparentKey: ie_ord_dtm\n',
      ),
    ],
    issues: [
      error(
        'R04',
        entity('order_item'),
        '/attributes/0/migratedFrom/0/attribute',
        15,
        9,
        'attribute "ord_no": order.ord_no is not part of the key that "order_contains_item" migrates',
      ),
      error(
        'R04',
        relationship('order_contains_item'),
        '',
        1,
        1,
        '"order_contains_item": order.cust_no must migrate to exactly one attribute of "order_item" (found 0)',
      ),
      error(
        'R04',
        relationship('order_contains_item'),
        '',
        1,
        1,
        '"order_contains_item": order.ord_dtm must migrate to exactly one attribute of "order_item" (found 0)',
      ),
      error(
        'R04',
        relationship('order_contains_item'),
        '/parentKey',
        5,
        1,
        '"order_contains_item": parentKey "ie_ord_dtm" must be an alternate key of "order"',
      ),
    ],
    parityExcluded: FR13_PARENT_KEY,
  },
  {
    name: 'parent without a primary key',
    rows: [26],
    changes: [
      replace(entity('tag'), '    kind: primary\n', '    kind: alternate\n'),
    ],
    issues: [
      error(
        'R04',
        relationship('product_tag_tag'),
        '',
        1,
        1,
        '"product_tag_tag": parent "tag" has no primary key to migrate',
      ),
    ],
  },
  {
    name: 'parent attribute not migrated',
    rows: [27],
    changes: [
      replace(
        entity('order_item'),
        '    migratedFrom:\n      - relationship: product_ordered_as_item\n        attribute: prod_no\n',
        '',
      ),
    ],
    issues: [
      error(
        'R04',
        relationship('product_ordered_as_item'),
        '',
        1,
        1,
        '"product_ordered_as_item": product.prod_no must migrate to exactly one attribute of "order_item" (found 0)',
      ),
    ],
  },
  {
    name: 'parent attribute migrated to two attributes of a subtype',
    rows: [27, 28],
    changes: [
      replace(
        entity('personal_customer'),
        '        attribute: cust_no\n',
        '        attribute: cust_no\n  - id: cust_no2\n    name: 고객번호\n    domain: number\n    migratedFrom:\n      - relationship: customer_is_personal\n        attribute: cust_no\n',
      ),
    ],
    issues: [
      error(
        'R04',
        SUBTYPE,
        '/members/0',
        6,
        5,
        '"customer_is_personal": customer.cust_no must migrate to exactly one attribute of "personal_customer" (found 2)',
      ),
      error(
        'R05',
        SUBTYPE,
        '/members/0',
        6,
        5,
        '"customer_is_personal": personal_customer.cust_no2 must be part of the child\'s primary key',
      ),
    ],
  },
  {
    name: 'one parent attribute named twice by the same migrated attribute',
    rows: [27],
    changes: [
      replace(
        entity('order'),
        '      - relationship: customer_places_order\n        attribute: cust_no\n',
        '      - relationship: customer_places_order\n        attribute: cust_no\n      - relationship: customer_places_order\n        attribute: cust_no\n',
      ),
    ],
    issues: [],
  },
  {
    name: 'identifying migration outside the child primary key',
    rows: [28],
    changes: [
      replace(
        entity('order_item'),
        '      - ord_no\n      - line_no\n',
        '      - line_no\n',
      ),
    ],
    issues: [
      error(
        'R05',
        relationship('order_contains_item'),
        '',
        1,
        1,
        '"order_contains_item": order_item.ord_no must be part of the child\'s primary key',
      ),
    ],
  },
  {
    name: 'non-identifying migration as the whole child primary key',
    rows: [29, 28],
    changes: [
      replace(
        entity('order_item'),
        '      - ord_no\n      - line_no\n',
        '      - prod_no\n',
      ),
    ],
    issues: [
      error(
        'R05',
        relationship('order_contains_item'),
        '',
        1,
        1,
        '"order_contains_item": order_item.ord_no must be part of the child\'s primary key',
      ),
      error(
        'R05',
        relationship('product_ordered_as_item'),
        '',
        1,
        1,
        '"product_ordered_as_item": non-identifying, but order_item.prod_no is the child\'s whole primary key',
      ),
    ],
  },
  {
    name: 'non-identifying migration as part of a child primary key of several attributes',
    rows: [29],
    changes: [
      replace(
        entity('order_item'),
        '      - ord_no\n      - line_no\n',
        '      - ord_no\n      - line_no\n      - prod_no\n',
      ),
    ],
    issues: [],
  },
  {
    name: 'unknown resolvedBy entity',
    rows: [30],
    changes: [
      replace(
        relationship('product_has_tag'),
        'resolvedBy: product_tag\n',
        'resolvedBy: product_tagx\n',
      ),
    ],
    issues: [
      error(
        'R02',
        relationship('product_has_tag'),
        '/resolvedBy',
        8,
        1,
        'unknown resolvedBy entity "product_tagx"',
      ),
    ],
  },
  {
    name: 'discriminator the supertype does not have',
    rows: [31],
    changes: [
      replace(
        SUBTYPE,
        'discriminator: cust_type_cd\n',
        'discriminator: cust_type_cdx\n',
      ),
    ],
    issues: [
      error(
        'R02',
        SUBTYPE,
        '/discriminator',
        3,
        1,
        'supertype "customer" has no attribute "cust_type_cdx"',
      ),
    ],
  },
  {
    name: 'subject area with an unknown entity',
    rows: [32],
    changes: [
      replace(PARTY, '  - personal_customer\n', '  - personal_customerx\n'),
    ],
    issues: [
      error(
        'R02',
        PARTY,
        '/entities/3',
        8,
        5,
        'unknown entity "personal_customerx"',
      ),
    ],
  },
  {
    name: 'second layout for a subject area',
    rows: [33, 36],
    changes: [
      replace(
        CATALOG_LAYOUT,
        '"subjectArea": "catalog"',
        '"subjectArea": "sales"',
      ),
    ],
    issues: [
      error(
        'R09',
        CATALOG_LAYOUT,
        '/nodes/category',
        5,
        5,
        'entity "category" is not in subject area "sales"',
      ),
      error(
        'R09',
        CATALOG_LAYOUT,
        '/nodes/product_tag',
        7,
        5,
        'entity "product_tag" is not in subject area "sales"',
      ),
      error(
        'R09',
        CATALOG_LAYOUT,
        '/nodes/tag',
        8,
        5,
        'entity "tag" is not in subject area "sales"',
      ),
      error(
        'R09',
        SALES_LAYOUT,
        '/subjectArea',
        3,
        3,
        'second layout for subject area "sales"',
      ),
    ],
  },
  {
    name: 'second layout for the whole model',
    rows: [33],
    changes: [
      replace(CATALOG_LAYOUT, '  "subjectArea": "catalog",\n', ''),
      replace(SALES_LAYOUT, '  "subjectArea": "sales",\n', ''),
    ],
    issues: [
      error('R09', SALES_LAYOUT, '', 1, 1, 'second layout for the whole model'),
    ],
  },
  {
    name: 'layout for an unknown subject area',
    rows: [34],
    changes: [
      replace(
        CATALOG_LAYOUT,
        '"subjectArea": "catalog"',
        '"subjectArea": "catalogx"',
      ),
    ],
    issues: [
      error(
        'R09',
        CATALOG_LAYOUT,
        '/subjectArea',
        3,
        3,
        'unknown subject area "catalogx"',
      ),
    ],
  },
  {
    name: 'node for an unknown entity',
    rows: [35],
    changes: [replace(CATALOG_LAYOUT, '"tag": {', '"tagx": {')],
    issues: [
      error(
        'R09',
        CATALOG_LAYOUT,
        '/nodes/tagx',
        8,
        5,
        'node for unknown entity "tagx"',
      ),
    ],
  },
  {
    name: 'node for an entity outside the subject area',
    rows: [36],
    changes: [replace(CATALOG_LAYOUT, '"tag": {', '"customer": {')],
    issues: [
      error(
        'R09',
        CATALOG_LAYOUT,
        '/nodes/customer',
        8,
        5,
        'entity "customer" is not in subject area "catalog"',
      ),
    ],
  },
  {
    name: 'edge for an unknown relationship',
    rows: [37],
    changes: [
      replace(SALES_LAYOUT, '"order_bills_to": {', '"order_bills_tox": {'),
    ],
    issues: [
      error(
        'R09',
        SALES_LAYOUT,
        '/edges/order_bills_tox',
        16,
        5,
        'edge for unknown relationship "order_bills_tox"',
      ),
    ],
  },
  {
    name: 'migratedFrom naming a parent attribute outside the primary key',
    rows: [38],
    changes: [
      replace(
        entity('order'),
        '      - relationship: order_ships_to\n        attribute: addr_no\n',
        '      - relationship: order_ships_to\n        attribute: addr_no\n      - relationship: order_ships_to\n        attribute: cust_no\n',
      ),
    ],
    issues: [
      error(
        'R04',
        entity('order'),
        '/attributes/2/migratedFrom/1/attribute',
        34,
        9,
        'attribute "ship_addr_no": address.cust_no is not part of the key that "order_ships_to" migrates',
      ),
    ],
    parityExcluded: FR13_KEY_PART,
  },
  {
    name: 'migratedFrom naming a parent attribute outside the alternate key parentKey names',
    rows: [38, 27],
    changes: [
      replace(
        relationship('customer_places_order'),
        'child: order\n',
        'child: order\nparentKey: ak_email\n',
      ),
    ],
    issues: [
      error(
        'R04',
        entity('order'),
        '/attributes/1/migratedFrom/0/attribute',
        23,
        9,
        'attribute "cust_no": customer.cust_no is not part of the key that "customer_places_order" migrates',
      ),
      error(
        'R04',
        relationship('customer_places_order'),
        '',
        1,
        1,
        '"customer_places_order": customer.email must migrate to exactly one attribute of "order" (found 0)',
      ),
    ],
    parityExcluded: FR13_KEY_PART,
  },
  {
    // Row 38 is checked apart from row 15, so a swapped relationship gives both.
    name: 'relationship with its parent and child swapped',
    rows: [38, 15, 27],
    changes: [
      replace(
        relationship('customer_places_order'),
        'parent: customer\nchild: order\n',
        'parent: order\nchild: customer\n',
      ),
    ],
    issues: [
      error(
        'R04',
        entity('order'),
        '/attributes/1/migratedFrom/0/relationship',
        22,
        9,
        'attribute "cust_no": "customer_places_order" does not have this entity as its child',
      ),
      error(
        'R04',
        entity('order'),
        '/attributes/1/migratedFrom/0/attribute',
        23,
        9,
        'attribute "cust_no": order.cust_no is not part of the key that "customer_places_order" migrates',
      ),
      error(
        'R04',
        relationship('customer_places_order'),
        '',
        1,
        1,
        '"customer_places_order": order.ord_no must migrate to exactly one attribute of "customer" (found 0)',
      ),
    ],
    parityExcluded: FR13_KEY_PART,
  },
  {
    name: 'subtype member id that another member has',
    rows: [9],
    changes: [
      replace(
        SUBTYPE,
        '  - id: customer_is_corporate\n',
        '  - id: customer_is_personal\n',
      ),
    ],
    issues: [
      error(
        'R02',
        entity('corporate_customer'),
        '/attributes/0/migratedFrom/0/relationship',
        14,
        9,
        'attribute "cust_no": unknown relationship "customer_is_corporate"',
      ),
      error(
        'R01',
        SUBTYPE,
        '/members/1/id',
        9,
        5,
        'member id "customer_is_personal" clashes with another relationship or subtype member',
      ),
    ],
  },
  {
    // A subtype member's link is the member, so the third message of row 26 points at it.
    name: 'supertype without a primary key',
    rows: [26],
    changes: [
      replace(
        entity('customer'),
        '    kind: primary\n',
        '    kind: alternate\n',
      ),
    ],
    issues: [
      error(
        'R04',
        relationship('customer_has_address'),
        '',
        1,
        1,
        '"customer_has_address": parent "customer" has no primary key to migrate',
      ),
      error(
        'R04',
        relationship('customer_places_order'),
        '',
        1,
        1,
        '"customer_places_order": parent "customer" has no primary key to migrate',
      ),
      error(
        'R04',
        SUBTYPE,
        '/members/0',
        6,
        5,
        '"customer_is_personal": parent "customer" has no primary key to migrate',
      ),
      error(
        'R04',
        SUBTYPE,
        '/members/1',
        9,
        5,
        '"customer_is_corporate": parent "customer" has no primary key to migrate',
      ),
    ],
  },
  {
    // The subtype file has no scope key, so the path is the object that would hold it.
    name: 'subtype without a scope over a physical member entity',
    rows: [25],
    changes: [
      replace(
        entity('personal_customer'),
        'name: 개인고객\n',
        'name: 개인고객\nscope: physical\n',
      ),
    ],
    issues: [
      error(
        'R08',
        SUBTYPE,
        '',
        1,
        1,
        '"customer_is_personal": scope is wider than its child entity\'s',
      ),
    ],
  },
  {
    // Ids that pass the id pattern and name an Object.prototype member (`constructor`) or nearly do.
    name: 'ids that look like prototype keys',
    rows: [11, 14, 27, 32, 35],
    changes: [
      replace(
        entity('address'),
        '    domain: code\n',
        '    domain: constructor\n',
      ),
      replace(
        entity('order'),
        '      - relationship: order_bills_to\n',
        '      - relationship: constructor\n',
      ),
      replace(
        PARTY,
        '  - personal_customer\n',
        '  - personal_customer\n  - constructor\n  - valueof\n',
      ),
      replace(
        CATALOG_LAYOUT,
        '"tag": { "x": 1060, "y": 40 }\n',
        '"tag": { "x": 1060, "y": 40 },\n    "constructor": { "x": 0, "y": 0 }\n',
      ),
    ],
    issues: [
      error(
        'R02',
        entity('address'),
        '/attributes/2/domain',
        24,
        5,
        'attribute "zip_cd": unknown domain "constructor"',
      ),
      error(
        'R02',
        entity('order'),
        '/attributes/3/migratedFrom/0/relationship',
        40,
        9,
        'attribute "bill_addr_no": unknown relationship "constructor"',
      ),
      error(
        'R09',
        CATALOG_LAYOUT,
        '/nodes/constructor',
        9,
        5,
        'node for unknown entity "constructor"',
      ),
      error(
        'R04',
        relationship('order_bills_to'),
        '',
        1,
        1,
        '"order_bills_to": address.addr_no must migrate to exactly one attribute of "order" (found 0)',
      ),
      error('R02', PARTY, '/entities/4', 9, 5, 'unknown entity "constructor"'),
      error('R02', PARTY, '/entities/5', 10, 5, 'unknown entity "valueof"'),
    ],
  },
];
