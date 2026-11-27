# 모델 파일 형식 v0 (formatVersion 0.1)

상태: 초안. 1.0 전까지는 호환을 깨는 변경이 있을 수 있고, 그때마다 `formatVersion`을 올리고 변환 명령을 함께 낸다.

모델은 Git 저장소 안의 디렉터리 하나다. 모델 내용은 YAML, 다이어그램 배치는 JSON으로 나눠 저장한다. 각 파일의 구조는 `format/v0/schema/`의 JSON Schema(2020-12)가 정의하고, 파일 사이의 규칙은 이 문서의 "검증 규칙"이 정의한다.

```
<모델 디렉터리>/
  model.yaml               매니페스트: 형식 버전, 대상 DBMS, 사전 경로
  entities/<id>.yaml       엔터티 하나에 파일 하나 (속성, 키 그룹 포함)
  relationships/<id>.yaml  관계 하나에 파일 하나 (식별, 비식별, 다대다)
  subtypes/<id>.yaml       서브타입 묶음 하나에 파일 하나
  subject-areas/<id>.yaml  주제영역과 소속 엔터티
  layouts/<주제영역 id>.json  다이어그램 배치 (좌표, 꺾임점, 표시 수준)
  dictionary/*.yaml        단어, 용어, 도메인
```

예제는 `format/v0/examples/shop/`에 있고, `npm run validate:format`으로 검사한다.

## 프로젝트, 모델, 주제영역

묶는 단위는 세 단계다(2026-11-27 확정).

| 단계 | 무엇인가 | 어디에 적는가 |
| --- | --- | --- |
| 프로젝트 | Git 저장소 하나. 모델 폴더를 여러 개 담는다(시스템이나 사이트별) | 따로 적는 파일이 없다. `model.yaml`이 있는 폴더가 모델이다 |
| 모델 | 관계로 이어지는 한 덩어리. DB 스키마 여러 개를 다룰 수 있다 | `model.yaml`의 `schemas`, 엔터티의 `physical.schema` |
| 주제영역 | 화면의 탭 하나. 상위 분류로 한 번 묶을 수 있다 | `model.yaml`의 `areaGroups`, 주제영역의 `group`과 `order` |

- 도구는 연 폴더 아래 3단계까지 `model.yaml`을 찾는다. 점으로 시작하는 폴더와 `node_modules`는 건너뛴다. 모델 폴더 안에 다른 모델을 두지 않는다.
- 한 프로젝트 안에서 모델 `id`는 유일하다.
- 사전은 프로젝트에 하나 두고 여러 모델이 함께 쓸 수 있다. 모델마다 `dictionaries: [../dictionary]`처럼 경로로 가리킨다.
- 도구는 모델 폴더 안의 심볼릭 링크를 파일이든 폴더든 읽지 않는다.
- 모델 사이에는 관계를 두지 않는다. 관계가 필요한 테이블은 같은 모델에 넣고, 남의 시스템 스키마는 `role: linked`로 표시한다.
- 주제영역 묶음은 한 단계뿐이다. 묶음 안에 묶음을 두지 않는다.

```
<프로젝트 폴더>/
  dictionary/standard.yaml     여러 모델이 함께 쓰는 사전
  billing/model.yaml           모델 하나
  billing/entities/...
  member/model.yaml            다른 모델
  member/entities/...
```

## 설계 결정

| 결정                                                                                                            | 이유                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 배치는 `layouts/`에만 둔다. 엔터티·관계 파일에는 좌표가 없다                                                    | 상자를 옮겨도 모델 diff가 생기지 않는다. erd-editor의 `.erd.json`은 좌표가 테이블 레코드 안에 있다                                                                            |
| 객체 하나에 파일 하나                                                                                           | 두 사람이 서로 다른 엔터티를 고치면 Git이 충돌 없이 합친다. PR에서 바뀐 엔터티가 파일 목록으로 보인다                                                                         |
| ID는 처음 이름에서 만들고 그 뒤로 바꾸지 않는다 (`customer`, `cust_no`)                                         | 이름을 바꿔도 "삭제 후 추가"가 되지 않는다. 무작위 ID와 달리 `parent: customer`처럼 참조가 그대로 읽힌다. 대신 이름을 바꾸면 ID와 이름이 달라질 수 있다                       |
| 파일명은 `<id>.yaml`로 쓴다                                                                                     | ID가 안 바뀌므로 파일명도 안 바뀐다. 로더는 파일명을 해석하지 않고 안의 `id`만 본다                                                                                           |
| 관계는 엔터티 파일이 아니라 별도 파일에 둔다                                                                    | 1:N, 다대다, 서브타입을 같은 방식으로 다룬다                                                                                                                                  |
| 이주된 FK 속성은 자식 엔터티 파일에 이름과 타입까지 적는다                                                      | 엔터티 파일만 보고 테이블의 컬럼 전체를 알 수 있다. 부모 PK 이름을 바꾸면 자식 파일도 바뀌는데, 실제로 자식 테이블에 ALTER가 필요한 변경이다. 부모와 어긋나면 검증기가 잡는다 |
| 논리와 물리는 한 객체에 함께 둔다. `name`이 논리명, `physical.name`이 물리명이고 `scope`로 한쪽 전용을 표시한다 | 논리 속성과 물리 컬럼의 대응을 따로 관리하지 않아도 된다                                                                                                                      |
| 타입은 DBMS 중립 논리 타입이나 도메인으로 적고, 필요할 때만 `physical.types`로 DBMS별 타입을 덮어쓴다           | 대상 DBMS를 바꿔도 모델이 그대로다                                                                                                                                            |
| 사전은 모델과 다른 디렉터리에 둘 수 있다 (`model.yaml`의 `dictionaries`)                                        | 여러 모델이 표준 사전 하나를 공유한다 (서브모듈이나 옆 디렉터리)                                                                                                              |
| 플러그인과 가져오기 도구의 부가 정보는 `ext`에만 둔다. 그 밖의 모르는 키는 오류다                               | 오타를 잡고, 다른 형식에서 가져온 정보를 잃지 않는다                                                                                                                          |

## 파일별 내용

### model.yaml

`formatVersion`(지금은 `"0.1"`), `id`, `name`, `notation`(`ie` 기본, `idef1x`), `targets`(대상 DBMS 목록, 첫 항목이 DDL 생성 기본값), `dictionaries`(사전 디렉터리 목록, 기본 `dictionary`. 모델 폴더 밖을 가리킬 수 있다), `schemas`(이 모델이 다루는 DB 스키마 목록. 항목은 `name`, `role`(`main` 기본, `linked`는 다른 시스템의 스키마), `definition`), `areaGroups`(주제영역 묶음 목록. 항목은 `id`, `name`, `definition`이고 목록 순서가 표시 순서다).

### 엔터티

- `id`, `name`(논리명), `definition`, `note`, `scope`, `physical.name`(테이블명), `physical.schema`.
  - 서로 다른 스키마에 같은 이름의 테이블이 있으면, 나중에 만드는 쪽의 ID 앞에 스키마 이름을 붙인다(`dormant_member`). 겹치지 않으면 이름만으로 만든다.
- `attributes`: 순서가 있는 목록이고 이 순서가 컬럼 순서다.
  - `id`는 엔터티 안에서만 유일하면 된다.
  - 타입은 `domain`(사전 도메인 ID) 또는 `type`(`base`, `length`, `precision`, `scale`) 중 하나다. 초기 ERD 단계에서는 둘 다 비워 둘 수 있다.
  - `nullable`(기본 true), `default`(리터럴 또는 `{expression: ...}`), `validValues`, `term`(따르는 표준용어), `physical.name`, `physical.types`.
  - `nameSource`: 논리명의 출처(`manual`, `comment`, `dictionary`, `inferred`).
  - `migratedFrom`: FK 속성에만 있다. `{relationship, attribute}` 목록으로 어느 관계의 어느 부모 속성에서 왔는지 적는다. 항목이 둘 이상이면 단일화(unification)된 속성이다.
  - `rolenamed: true`: `name`이 롤네임이다. 부모 속성 이름이 바뀌어도 따라가지 않는다.
- `keys`: 키 그룹 목록. `kind`는 `primary`(PK), `alternate`(AK, 유일 인덱스), `inversion`(IE, 비유일 인덱스). 속성 순서가 인덱스 컬럼 순서다. 물리 전용 인덱스는 `scope: physical`로 둔다.

### 관계

- `kind`: `identifying`, `non-identifying`, `many-to-many`.
- `parent`, `child`: 엔터티 ID. 재귀 관계는 둘이 같다. 다대다에서는 두 끝을 가리키는 이름일 뿐이다.
- `verbPhrase.parentToChild`, `verbPhrase.childToParent`.
- `cardinality.parent`: `one`(기본) 또는 `zero-or-one`(비식별만). `cardinality.child`: `zero-or-more`(기본), `one-or-more`, `zero-or-one`, `exactly` + `count`.
- `referentialIntegrity`: `parentInsert`, `parentUpdate`, `parentDelete`, `childInsert`, `childUpdate`, `childDelete` 각각 `cascade`, `restrict`, `set-null`, `set-default`, `none`.
- `parentKey`: PK가 아닌 키(AK)를 참조하는 FK일 때 그 키 ID.
- `resolvedBy`: 다대다 전용. 물리 모델에서 이 관계를 푸는 연관 엔터티 ID. 예제의 `product_has_tag`(논리 전용) → `product_tag`(물리 전용)를 참고한다.
- `physical.name`: FK 제약 이름.

### 서브타입

`supertype`, `discriminator`(슈퍼타입의 속성 ID), `completeness`(`complete`/`incomplete`), `exclusivity`(`exclusive`/`inclusive`), `members`(`id`, `entity`, `discriminatorValue`). 멤버 ID는 관계 ID와 같은 이름 공간을 쓰고, 서브타입 쪽 PK의 `migratedFrom.relationship`이 이 ID를 가리킨다.

### 주제영역과 배치

- 주제영역: `id`, `name`, `group`(`areaGroups`의 ID, 없으면 묶음 밖), `order`(묶음 안의 표시 순서, 없거나 같으면 ID 순), `entities`(ID 순 정렬). 엔터티 하나가 여러 주제영역에 들어갈 수 있다.
- 배치: `subjectArea`(없으면 모델 전체 다이어그램), `display.level`(`entity`/`key`/`attribute`), `display.names`, `nodes`(엔터티 ID → `x`, `y`, `width`, `height`, `color`), `edges`(관계 ID → 붙는 변, 꺾임점). 좌표는 정수다. 노드가 없는 엔터티는 자동 배치한다. 확대 비율과 스크롤 위치는 개인 상태라 저장하지 않는다.

### 사전

사전 디렉터리의 모든 `*.yaml`을 합쳐 읽는다. 파일마다 `words`, `terms`, `domains`를 가질 수 있어 분량에 따라 나눌 수 있다.

| 종류   | 필드                                                                                                         | erd-editor 대응                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 단어   | `name`, `englishName`, `abbreviation`, `definition`, `classifier`(분류어 여부), `synonyms`, `forbiddenWords` | `description` → `definition`, 쉼표 문자열 → 목록. `classifier`는 우리 쪽에만 있다 |
| 용어   | `name`, `words`(단어 ID 순서), `physicalName`, `domain`, `definition`, `synonyms`                            | `domainId` → `domain`. `words`는 우리 쪽에만 있다                                 |
| 도메인 | `name`, `category`, `type`, `physicalTypes`, `validValues`, `default`, `definition`                          | `dataType` 문자열 → `type` 또는 `physicalTypes`                                   |

## 쓰기 규칙

도구가 파일을 쓸 때 지키는 규칙이다. 같은 모델은 항상 같은 바이트로 저장된다.

- UTF-8, LF, 파일 끝 줄바꿈 하나, 들여쓰기 2칸, 블록 스타일. 긴 줄을 접지 않는다.
- 키 순서는 스키마의 `properties` 순서. 스키마에 `properties`가 없는 맵(`physicalTypes`, `physical.types`, `ext` 안쪽)은 적힌 순서 그대로 쓴다.
- 기본값과 같은 값은 쓰지 않는다. 그 결과 빈 객체가 된 선택 키도 쓰지 않는다. `ext`는 받은 그대로 쓴다.
- 속성의 `scope`는 생략하지 않는다. 속성에 `scope`가 없으면 엔터티의 범위를 물려받으므로, 없는 것과 `both`는 뜻이 다르다. 그래서 스키마에서 속성 `scope`에는 기본값이 없다.
- YAML 1.2 코어 스키마만 쓴다. 앵커, 별칭, 사용자 태그, 중복 키는 오류다.
- `NO`, `yes`, `on`, `off`처럼 YAML 1.1 파서가 불리언·null·숫자로 읽는 문자열은 큰따옴표로 감싼다(`"NO"`, `"0.1"`). 번호의 약어 `NO`가 여기에 걸린다.
- 정렬하는 목록은 주제영역의 `entities` 하나다(ID를 글자 코드 순으로). 다른 목록은 적힌 순서를 지킨다.
- JSON 배치 파일의 고정 키는 스키마의 `properties` 순서다. `nodes`와 `edges`의 키(ID)는 글자로 비교해 정렬한다(숫자뿐인 ID도 `10`, `2`, `9` 순). 들여쓰기 2칸으로 펼쳐 쓰되, 노드 하나의 값과 `waypoints` 배열은 길이와 상관없이 한 줄로 쓴다: `"order": { "x": 380, "y": 40, "width": 240 }`, `[{ "x": 520, "y": 380 }]`. 빈 `nodes`, `edges`, 엣지 값, `waypoints`는 `{}`나 `[]`로 쓴다.
- YAML 주석은 보존하지 않는다. 도구가 파일을 다시 쓰면 주석이 사라진다(읽을 때 경고가 나온다). 설명은 주석 대신 `definition`과 `note`에 적는다.

## 검증 규칙

스키마로 표현하지 못하는 규칙이다. `tools/validate-format.mjs`가 검사한다.

1. 엔터티, 관계(서브타입 멤버 포함), 서브타입, 주제영역, 단어, 용어, 도메인의 ID는 각 종류 안에서 유일하다. 속성과 키 ID는 엔터티 안에서 유일하다.
2. 모든 ID 참조는 실제 객체를 가리킨다.
3. 엔터티의 PK는 하나 이하다.
4. 관계마다 부모 키의 각 속성이 자식의 속성 정확히 하나로 이주한다. 부모 키는 부모의 PK이고, `parentKey`가 있으면 그 키다. `parentKey`는 부모의 대체 키(`alternate`)여야 한다. 참조하는 키에 없는 부모 속성을 가리키는 `migratedFrom`은 오류다. 다대다는 이주하지 않는다.
5. 식별 관계와 서브타입에서 이주된 속성은 자식 PK에 들어 있다. 비식별 관계로 이주된 속성 하나가 자식 PK의 전부일 수는 없다.
6. 이주된 속성의 타입은 부모 속성과 같다. 타입은 `domain`이 있으면 그 도메인, 없으면 `type`, 둘 다 없으면 "없음"이다. `type`은 키 순서와 상관없이 필드를 비교한다. 이름은 `rolenamed`가 아니면 부모와 같다.
7. 재귀 관계로 이주된 속성은 롤네임이 있어야 한다.
8. 속성과 관계의 `scope`는 소속 엔터티의 범위를 넘지 못한다. 다대다 관계에도 적용한다. `scope`가 없는 속성은 엔터티의 범위를 물려받는다.
9. 배치의 노드는 해당 주제영역에 속한 엔터티만, 엣지는 실제 관계만 가리킨다. 주제영역 하나에 배치 파일은 하나다.
10. `schemas`가 있으면 스키마 이름은 유일하고, `physical.schema`가 적힌 엔터티는 그 스키마가 목록에 있어야 한다. `physical.schema`가 없는 엔터티는 허용한다.
11. 같은 스키마 안에서 테이블명(`physical.name`)은 유일하다. 논리 전용 엔터티는 세지 않는다.
12. `areaGroups`의 ID는 유일하고, 주제영역의 `group`은 그 목록에 있어야 한다.

## v0에 넣지 않은 것

모두 나중에 키를 추가하는 방식으로 넣을 수 있어 기존 파일을 깨지 않는다.

- N항 관계
- 서브타입의 물리 변환 옵션(통합, 분리)
- 뷰, 트리거, 사전/사후 스크립트
- 추정 관계 후보와 근거 등급(승인 전에는 모델 밖에 둔다)
- 댓글, 검토 상태
- 논리 모델 하나에 물리 모델 여럿
- 모델 사이의 관계, 3단 이상의 주제영역 묶음

## 열린 질문

- 스키마 `$id`는 임시로 `urn:erdmaker:format:0.1:*`다. 제품 이름과 도메인이 정해지면 URL로 바꾼다.
- 표준용어가 수만 건인 사전(공공데이터 공통표준)을 YAML로 둘 때의 로드 시간과 diff 크기는 재 보지 않았다.
- 한글 이름만 있는 객체의 ID 생성 규칙(물리명에서 만들지, 무작위로 할지)은 코어 구현 때 정한다.
