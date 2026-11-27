# F02 `core-model-io` 스펙

작성: 2026-11-27 · 기준 문서: [stage1-backlog.md](../stage1-backlog.md) F02, [format-v0.md](../format-v0.md), `CLAUDE.md`

- **상태**: Draft
- **브랜치**: `feature/core-model-io`
- **분량**: 3일

## 1. 목적

형식 v0 모델 폴더를 메모리 모델로 읽고, 검증하고, 다시 쓰는 일을 `@erdmaker/core`에 넣는다. 지금 `tools/validate-format.mjs`가 하는 검사를 코어로 옮기고, CLI `erdmaker validate <dir>`로 낸다. 이 기능이 끝나면 옛 검사 도구는 없어지고, 코어는 Node 없이도 도는 것이 테스트로 확인된다.

## 2. 지금 상태

- 패키지 4개는 비어 있다(`src/index.ts`에 내용이 없다). `core`의 `tsconfig.json`은 `lib: ["ES2022"]`, `types: []`다.
- `tools/validate-format.mjs`(381줄)가 스키마 검사와 파일 간 규칙을 한 파일에서 한다. 오류는 `<파일>: <메시지>`로만 나오고 줄 번호가 없다.
- `ajv`(8.20.0, MIT)와 `yaml`(2.9.1, ISC)은 루트 devDependencies다.
- 확인한 것 (2026-11-27, Node 22.23.3):
  - 배치 JSON이 깨지면 옛 도구가 `TypeError: Cannot read properties of undefined (reading 'subjectArea')`로 죽는다. 종료 코드는 1이지만 오류 목록이 나오지 않는다.
  - `yaml`의 `stringify`에 `lineWidth: 0`, `compat: 'yaml-1.1'`을 주면 예제의 YAML 27개가 읽은 그대로 다시 써질 때 바이트가 같다. `compat`이 없으면 `"NO"`의 따옴표가 빠진다.
  - **예제가 쓰기 규칙과 네 군데에서 어긋난다.** `model.yaml`의 `notation: ie`와 `dictionaries: [dictionary]`, `subtypes/customer_type.yaml`의 `exclusivity: exclusive`는 기본값과 같은데 적혀 있다. `relationships/customer_places_order.yaml`의 `referentialIntegrity`는 `parentDelete`가 `parentUpdate`보다 앞인데 스키마 순서는 반대다. 쓰기 규칙대로 쓰면 이 세 파일은 바이트가 달라진다.
  - 배치 JSON은 `JSON.stringify(값, null, 2)`의 출력과 다르다. 노드 하나가 한 줄(`"order": { "x": 380, "y": 40, "width": 240 }`)이고, 고정 키는 정렬이 아니라 스키마 순서다. 형식 문서의 "JSON 배치 파일은 키를 정렬한다"만으로는 이 모양이 정해지지 않는다.
  - `JSON.parse`의 오류 메시지에는 위치가 없을 때가 있다(`Unexpected token '}', "..." is not valid JSON`).
  - `yaml` 패키지는 `exports`의 `default` 조건이 브라우저용 빌드를 가리킨다. `ajv`의 본체에는 Node 내장 모듈 `require`가 없고(`standalone`만 쓴다), 검사 함수를 `new Function`으로 만든다.

## 3. 범위

**포함**: 파일 어댑터 인터페이스와 구현 2개(Node, 메모리), 모델 읽기·쓰기, 스키마 검사와 파일 간 규칙 12개, 프로젝트 폴더에서 모델 찾기, CLI `validate`, 깨진 배치 JSON 버그 수정, 테스트 파일의 타입 검사, 옛 검사 도구 제거.

**제외**: 편집 명령과 실행 취소(F03), 관계·FK 이주 로직(F04, 여기서는 검증만 한다), 형식 버전 변환, 브라우저용 어댑터와 변경 감지(F09), 화면, npm 배포.

## 4. 정한 것

| 항목               | 선택                                                                                                                                                                             | 이유                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Node 어댑터의 자리 | `@erdmaker/core/node`라는 별도 진입점(`packages/core/src/node/`). 기본 진입점 `@erdmaker/core`는 이것을 가져오지 않는다                                                          | CLI와 MCP가 둘 다 쓴다. `cli`에 두면 `mcp`가 `cli`에 의존하게 된다                                                          |
| 스키마를 코어에 넣는 방법 | `format/v0/schema/*.schema.json`에서 TypeScript 모듈 `packages/core/src/generated/schemas.ts`를 만들어 커밋한다. 원본과 같은지는 테스트가 확인한다                         | 생성물이 보통의 소스 파일이라 tsc, Vitest, Vite에 따로 설정이 필요 없고, 스키마 변경이 리뷰에 보인다                        |
| 쓰기 규칙의 근거   | 키 순서와 기본값은 내장한 스키마의 `properties` 순서와 `default`에서 읽는다. 코드에 따로 적지 않는다                                                                             | 스키마가 유일한 원본이다                                                                                                    |
| 예제와 쓰기 규칙의 불일치 | 예제를 고친다(FR-07). 기본값을 적은 것까지 기억하는 모델은 만들지 않는다                                                                                                  | "같은 모델은 항상 같은 바이트"를 지키려면 파일에 적힌 방식이 모델에 남으면 안 된다                                          |
| 메모리 모델의 모양 | 스키마 모양 그대로인 평범한 데이터. 기본값은 채우지 않는다(없으면 기본값이다). 객체마다 `{ file, data }`로 온 파일 경로를 따로 든다                                              | 파일과 메모리가 1:1이라 왕복과 diff가 단순하다. 로더는 파일명을 해석하지 않으므로 경로를 기억해야 같은 자리에 다시 쓴다     |
| 오류 객체          | `{ rule, severity, file, path, line, column, message }`. `severity`는 `error`나 `warning`이고 종료 코드는 `error`만 바꾼다. `path`는 그 파일 데이터 안의 JSON Pointer(RFC 6901, 파일 전체는 `""`), `line`·`column`은 1부터 센다                               | `path`는 편집 뒤에도 유효해 화면(F11)과 MCP(F08)가 객체를 찾는 데 쓰고, 줄 번호는 사람이 편집기에서 찾는 데 쓴다            |
| 규칙 ID            | 형식 문서 검증 규칙의 번호를 따라 `R01`~`R12`. 그 밖에 `syntax`, `yaml-feature`, `schema`, 프로젝트 규칙 `P01`·`P02`                                                             | 번호의 원본이 형식 문서 하나다                                                                                              |
| 오류 메시지        | `schema`, `yaml-feature`, `R01`~`R12`의 `message`는 옛 도구의 문구를 그대로 쓴다(영어)                                                                                           | 옛 도구와 결과가 같은지를 문자열 비교로 증명한다                                                                            |
| JSON의 위치        | 유효한지는 `JSON.parse`가 정한다. 문법 오류의 줄·열은 엔진 메시지의 위치, 없으면 같은 글을 YAML 파서로 읽어 나온 위치, 그것도 없으면 1:1이다(FR-09). 유효한 파일 안의 위치는 YAML 파서로 구한다                                                                                                      | `JSON.parse`는 위치를 주지 않는다. 유효한 JSON은 YAML 1.2로 읽힌다(예제 배치로 확인)                                        |
| 위반 예제의 형태   | 폴더를 복사하지 않고, 테스트 코드에서 "예제 + 치환 한두 개"로 정의한다                                                                                                           | 29개 파일 사본 수십 벌은 예제가 바뀔 때마다 어긋난다                                                                        |
| 어댑터 API         | 전부 비동기(`Promise`)                                                                                                                                                           | 브라우저의 File System Access API가 비동기다                                                                                |
| `validate:format`  | `node packages/cli/dist/bin.js validate format/v0/examples/shop`. `pnpm build` 뒤에 된다                                                                                         | pnpm은 설치할 때 `dist/`가 없으면 `bin` 링크를 못 만든다. 경로를 직접 부르면 npm과 pnpm에서 똑같이 된다. CI는 이미 빌드가 먼저다 |
| CLI 인자 처리      | 의존성 없이 직접 한다                                                                                                                                                            | 명령이 하나다                                                                                                               |

## 5. 요구사항

### FR-01 패키지 배치와 의존성

- `ajv`와 `yaml`을 `@erdmaker/core`의 `dependencies`에 넣는다. 루트 devDependencies의 것은 옛 도구가 쓰므로 옛 도구를 지우는 커밋(FR-13의 2단계)에서 뺀다. 다른 외부 의존성은 더하지 않는다.
- `core`의 `exports`에 `"./node"`를 더한다. `core`는 TypeScript 프로젝트 둘로 컴파일한다: 기본 진입점은 `lib: ["ES2022"]`, `types: []` 그대로이고, `src/node/`만 `@types/node`가 있는 별도 tsconfig를 쓴다.
- 기본 진입점에서 닿는 코드는 `node:` 모듈, Node 전역(`process`, `Buffer`), DOM을 쓰지 않는다. 경로 합치기와 정규화(`a/../b`)도 코어 안의 함수로 한다.
- `cli`의 `package.json`에 `bin`(`erdmaker` → 정확히 `dist/bin.js`)을 넣는다. 루트 패키지는 `@erdmaker/cli`에 의존하지 않고, `validate:format`은 이 파일을 경로로 실행한다. 파일 첫 줄은 `#!/usr/bin/env node`다.

### FR-02 파일 어댑터

- 인터페이스 이름은 `FileSystemAdapter`다. 메서드는 넷이다.

  | 메서드                  | 동작                                                                                |
  | ----------------------- | ----------------------------------------------------------------------------------- |
  | `readText(path)`        | UTF-8 글을 돌려준다. 파일이 없으면 `FileNotFoundError`(코어가 내보낸다)로 거부한다  |
  | `writeText(path, text)` | 받은 글을 그대로 쓴다(줄바꿈을 바꾸지 않는다). 상위 폴더가 없으면 만든다            |
  | `list(dir)`             | 바로 아래 항목의 `{ name, kind: 'file' \| 'directory' }` 목록. 폴더가 없으면 빈 목록 |
  | `remove(path)`          | 파일을 지운다. 없으면 아무 일도 하지 않는다                                         |

- 경로는 연 폴더를 기준으로 한 상대 경로이고 구분자는 `/`다. 연 폴더 자신은 `""`다. 사전이 밖에 있으면 `../dictionary/standard.yaml`처럼 `..`로 시작할 수 있다. 그런 경로를 읽을 수 있는지는 구현에 달렸다(Node와 메모리 구현은 읽는다).
- Node 구현에서 "없음"은 `ENOENT`, `ENOTDIR`, `ENAMETOOLONG`, 또는 경로에 NUL이 든 경우이고 `FileNotFoundError`가 된다. 메모리 구현은 길이 제한이 없고, NUL이 든 경로는 읽으면 없음이고 쓰면 거부한다. 그 밖의 실패(`EACCES`, 폴더를 파일로 읽음)는 `FileNotFoundError`가 아닌 오류로 거부한다. 코어는 이것을 삼키지 않고 호출자에게 그대로 넘긴다.
- `list`는 심볼릭 링크를 돌려주지 않는다. 링크인 항목은 무엇을 가리키든 오류 없이 뺀다. 직접 준 경로(연 폴더, `readText`, `writeText`, `remove`)는 운영체제가 평소대로 푼다. 브라우저 어댑터(F09)는 심볼릭 링크를 볼 수 없어 Node에서 따라가면 CLI와 앱이 다른 모델을 읽게 되고, 폴더 링크를 안전하게 따라가려면 상태가 필요하다.
- `remove`는 이 기능에서 부르지 않는다. F03이 인터페이스를 바꾸지 않도록 지금 둔다.
- 구현 둘: `createMemoryFileSystem(files?)`(`@erdmaker/core`), `createNodeFileSystem(rootDir)`(`@erdmaker/core/node`).
- 계약 테스트는 `core`의 테스트 안에 있는 공유 묶음 하나이고, 메모리 구현과 Node 구현에 돌린다.

### FR-03 스키마 내장

- 생성 스크립트 `packages/core/scripts/generate-schemas.ts`가 `format/v0/schema/*.schema.json` 8개를 읽어 `packages/core/src/generated/schemas.ts`를 만든다. 스키마 원본은 `format/v0/schema`뿐이고 생성물을 손으로 고치지 않는다.
- 생성물은 커밋한다. `.prettierignore`와 ESLint 무시 목록에 `packages/core/src/generated/`를 더한다.
- Ajv 설정은 옛 도구와 같다: 2020-12, `allErrors: true`, `strict: false`, `strictSchema: true`.

### FR-04 메모리 모델

- 모델은 평범한 데이터(객체와 배열)이고 JSON으로 직렬화된다. 담는 것: 모델 폴더 경로, 매니페스트, 엔터티·관계·서브타입·주제영역·배치의 목록, 사전 파일 목록. 사전은 파일 단위로 든다(파일마다 `words`, `terms`, `domains`를 나눠 가질 수 있어서다).
- 각 항목은 `{ file, data }`다. `data`는 해당 스키마의 모양이고 기본값을 채우지 않는다.
- 읽기·쓰기·검증 함수는 받은 모델을 고치지 않는다.
- 줄·열은 모델에 넣지 않는다. `loadModel`이 파일마다 위치 색인(`path` → 줄·열)을 만들어 모델 옆에 따로 돌려준다. 메모리에서 만들거나 고친 객체는 색인이 없다.
- 공개 이름(다른 기능이 쓴다): `loadModel`, `serializeModel`, `writeModel`, `validateModel`, `findModels`, `validateProject`, `FileNotFoundError`, 타입 `Model`, `Issue`, `FileSystemAdapter`. 나머지 이름은 계획 단계에서 정한다.

### FR-05 읽기

- `loadModel(fs, modelDir)`는 `{ model, issues, positions }`를 돌려준다. `issues`는 모델에 들어가지 못한 파일의 오류와 `comment` 경고다. `model.yaml`이 없으면 `FileNotFoundError`로 거부한다. 읽는 대상은 옛 도구와 같다.
  - `model.yaml`
  - `entities/`, `relationships/`, `subtypes/`, `subject-areas/` 아래의 `*.yaml`과 `layouts/` 아래의 `*.json`. 하위 폴더까지 들어가고, 폴더마다 이름순(코드 단위 비교)으로 읽는다.
  - `dictionaries`에 적힌 폴더(없으면 `dictionary`) 아래의 `*.yaml`. 경로는 `model.yaml` 기준이고 모델 폴더 밖일 수 있다. 폴더가 없으면 빈 사전이다. 사전 파일은 한 번씩만 읽는다: 적힌 폴더들이 정규화한 뒤 같거나 겹치면 적힌 순서에서 먼저 나온 쪽이 이긴다. 절대 경로 항목(`/`나 `\`로 시작하거나 `C:/`, `C:\`처럼 드라이브 문자로 시작)은 읽지 않는다. 있을 수 없는 경로인 항목은 없는 폴더처럼 빈 사전이다.
- YAML은 1.2 core 스키마로 읽는다(`parseDocument`에 `version: '1.2'`, `schema: 'core'`, `lineCounter`, `logLevel: 'error'`). 중복 키는 `yaml`의 `uniqueKeys` 옵션(키 수의 제곱으로 느려진다)을 쓰지 않고 직접 찾으며, 메시지 `Map keys must be unique at line L, column C:`와 뒤 키의 위치는 그대로다. 파일 맨 앞의 UTF-8 BOM은 열로 세지 않는다. 태그·앵커·별칭·주석은 `yaml`의 CST 토큰에서 찾고 그 토큰의 위치를 쓴다. `NO`, `yes`, `on`은 문자열이다. 중복 키와 문법 오류는 `syntax`, 앵커·별칭·태그는 `yaml-feature` 오류다. 메시지는 `YAML anchors are not allowed`, `YAML aliases are not allowed`, `YAML tag <tag> is not allowed`다. 파일에 적힌 태그는 모두 거부한다(`!!binary`, `!!timestamp`, `!!set` 같은 `tag:yaml.org,2002:` 태그와 `%TAG`로 선언한 것 포함).
- 컬렉션이 256단계보다 깊이 겹친 파일은 `syntax` 오류 `Collections are nested more than 256 levels deep at line L, column C:`이고 위치는 한도를 넘은 첫 컬렉션이다(더 깊은 입력은 YAML 라이브러리와 엔진을 죽일 수 있고, 실제 모델 파일은 몇 단계뿐이다).
- 객체로 바꾸면 같은 문자열이 되는 맵 키(`true`와 `"true"`)는 `syntax` 오류 `Map keys collide as "<key>"`이고 위치는 뒤의 키다. 컬렉션인 맵 키(`? [a, b]`)도 `syntax` 오류다.
- JSON 값은 null, 불리언, 문자열, 유한한 수, 배열, 평범한 객체다. 값이 정수인 수는 어떻게 적었든 안전한 정수(`Number.MAX_SAFE_INTEGER` 이하)여야 한다(`1e300`은 거부). 메모리 모델에서 `Array`의 하위 클래스 인스턴스는 JSON 값이 아니고, 빈 칸이 있는 배열은 배열마다 첫 빈 칸에서 오류 하나를 낸다. `ext` 안을 포함해 JSON 값이 아닌 것(`.inf`, `.nan`, 큰 정수)은 그 값의 위치에서 `schema` 오류 `<path> must be a JSON value`다.
- `syntax`, `yaml-feature`, `schema` 오류가 있는 파일은 모델에 넣지 않고 오류만 남긴다. `syntax`나 `yaml-feature` 오류가 있으면 그 파일의 스키마 검사는 하지 않는다. 나머지 파일은 계속 읽는다.
- `model.yaml`이 그런 파일이면 매니페스트 없이 계속한다(사전은 기본 경로, `schemas`와 `areaGroups`는 없는 것으로 본다).
- 정규형이 아닌 파일(키 순서가 다름, 기본값이 적혀 있음, CRLF)도 읽는다. 오류가 아니다.

### FR-06 쓰기

- `serializeModel(model)`은 파일 접근 없이 `경로 → 글` 목록을 돌려준다. 같은 모델은 항상 같은 바이트다. JSON에 담을 수 없는 값이 든 모델은 예외를 던진다. `writeModel`은 이것을 먼저 부르므로 그때 아무것도 쓰지 않는다.
- `writeModel(fs, model)`은 그 목록에서 지금 파일 내용과 다르거나 파일이 없는 것만 쓰고, 쓴 경로 목록을 돌려준다. 모델에 없는 파일(읽다가 오류로 빠진 파일 포함)은 건드리지 않는다. 파일 삭제는 F03에서 더한다.
- 항목은 읽어 온 `file` 경로에 그대로 쓴다.
- 어떤 값의 스키마는 이렇게 찾는다: `$ref`는 같은 파일(`#/$defs/…`)과 다른 파일(`urn:…#/$defs/…`) 모두 따라가고, 배열은 `items`, 맵의 값은 `additionalProperties`, `oneOf`는 값이 객체일 때 `properties`가 있는 갈래를 쓴다. `allOf`·`if`·`then`·`else`는 보지 않는다(키를 정의하지 않는다). `default`는 키 자리에서 먼저 찾고 없으면 `$ref` 대상에서 찾는다.
- YAML 쓰기 규칙:
  - UTF-8, LF, 파일 끝 줄바꿈 하나, 들여쓰기 2칸, 블록 스타일. 긴 줄을 접지 않는다.
  - 고정 키는 스키마의 `properties` 순서. 스키마에 `properties`가 없는 맵(`physicalTypes`, `physical.types`, `ext` 안쪽)은 모델에 든 순서 그대로.
  - 스키마의 `default`와 같은 값은 쓰지 않는다. 그 결과 빈 객체가 된 선택 키도 쓰지 않는다. `ext`는 받은 그대로 쓴다.
  - 속성의 `scope`는 생략하지 않는다. 속성에 `scope`가 없으면 엔터티의 범위를 물려받으므로(옛 도구와 같다) 없는 것과 `both`가 같은 뜻이 아니다. 스키마에서 속성 `scope`의 기본값을 없애므로(FR-07) 쓰기 코드에 예외를 두지 않는다.
  - YAML 1.1 파서가 불리언·null·숫자로 읽을 문자열은 큰따옴표로 감싼다(`"NO"`, `"no"`, `"0.1"`).
  - 정렬하는 목록은 주제영역의 `entities` 하나다(코드 단위 비교). 다른 목록은 순서를 지킨다.
  - 블록 글로 쓰면 파일이 줄바꿈 둘 이상으로 끝나게 되는 값(파일의 마지막 값이고 줄바꿈 둘 이상으로 끝나는 글)은 이스케이프한 큰따옴표 글로 쓴다.
  - 앵커와 별칭을 쓰지 않는다. 같은 객체가 두 곳에서 참조돼도 두 번 풀어 쓴다.
- 배치 JSON 쓰기 규칙:
  - 고정 키는 스키마의 `properties` 순서. `nodes`와 `edges`의 키(ID)는 글자로 비교해 정렬한다(숫자뿐인 ID도 `10`, `2`, `9` 순).
  - 들여쓰기 2칸으로 펼쳐 쓰되, `nodes`의 값 하나와 `waypoints` 배열은 길이와 상관없이 한 줄로 쓴다: `{ "x": 40, "y": 320 }`, `[{ "x": 520, "y": 380 }]`. 빈 `nodes`, 빈 `edges`, 빈 엣지 값, 빈 `waypoints`는 `{}`나 `[]`로 한 줄에 쓴다.
  - LF, 파일 끝 줄바꿈 하나.
- YAML 주석은 보존하지 않는다(사용자 결정). 주석이 있는 파일은 다시 쓸 때 주석을 잃고, 읽을 때 경고가 나온다(FR-08).

### FR-07 예제 정규화와 형식 문서 보강

- 예제를 쓰기 규칙에 맞게 고친다. 바꾸는 것은 2장에 적은 네 군데뿐이다(파일 3개). 모델의 뜻과 `validate`의 요약 줄은 바뀌지 않는다.
- `docs/format-v0.md`의 "쓰기 규칙"을 고친다. "JSON 배치 파일은 키를 정렬한다"를 FR-06의 배치 규칙(스키마 키 순서, `nodes`·`edges`의 ID 정렬, 노드 하나에 한 줄)으로 바꾸고, 빈 객체 생략, 속성 `scope`를 생략하지 않는 것, 정렬하는 목록이 `entities` 하나인 것을 적는다. 주석은 보존하지 않으며 설명은 `definition`과 `note`에 적는다는 것도 적는다. "프로젝트, 모델, 주제영역" 절에는 모델 폴더 안의 심볼릭 링크를 읽지 않는다는 한 문장을 더한다.
- `docs/format-v0.md`의 검증 규칙에 FR-08의 내용을 적는다. 규칙 4: `parentKey`는 부모의 대체 키여야 하고, 참조하는 키에 없는 부모 속성을 가리키는 `migratedFrom`은 오류다. 규칙 5: 비식별 관계로 이주된 속성 하나가 자식 PK의 전부일 수 없다. 규칙 6: 타입은 키 순서와 상관없이 비교한다. 규칙 8: 다대다 관계에도 적용한다. 규칙 10: `physical.schema`가 적힌 엔터티만 검사하고, 없는 엔터티는 허용한다.
- `format/v0/schema/entity.schema.json`에서 속성의 `scope`를 공통 정의 참조 대신 기본값이 없는 같은 열거형으로 바꾸고, 설명에 "없으면 엔터티의 범위를 물려받는다"를 적는다. 바뀌는 스키마 파일은 이것 하나이고 생성 모듈을 다시 만든다. 받아들이는 값은 달라지지 않는다.

### FR-08 검증

- `validateModel(model, positions?)`는 파일 접근 없이 `Issue[]`를 돌려준다. 먼저 모든 항목에 스키마 검사와 JSON 값 검사(FR-05의 `must be a JSON value`)를 하고, 파일 간 규칙 12개는 그 검사를 통과한 항목만으로 한다(디스크에서 읽을 때 오류 파일을 빼는 것과 같다). 메모리 모델에서는 `undefined`, 함수, 심벌, bigint, `Date`, 타입 배열과 그 밖의 클래스 인스턴스도 JSON 값이 아니고, 순환하는 데이터는 순환이 닫히는 자리에서 같은 오류로 보고한다. 두 검사는 항목마다 둘 다 한다(`.inf` 같은 값이 그 항목의 스키마 오류를 가리지 않는다). 스키마 검사는 안전하게 읽을 수 없는 데이터(순환, 빈 칸이 있는 배열, 접근자, 클래스 인스턴스, 들여다보면 예외를 던지는 컨테이너)에서만 건너뛰고, 평범한 객체처럼 동작하는 Proxy는 평범한 객체로 검사한다. 매니페스트의 절대 `dictionaries` 항목은 그 항목에 `schema` 오류 `dictionaries entries must be relative paths`로 보고한다(메모리 모델도 같다. 스키마 파일은 바꾸지 않는다). 어떤 모양의 `data`나 `Model`이 와도 예외를 던지지 않는다: 없는 목록은 빈 목록으로 보고, 읽다가 예외가 나는 데이터(던지는 트랩이 있는 Proxy)는 `/ must be a JSON value`로 보고한다. F03은 명령을 적용한 메모리 모델에 이것을 부른다.
- `validateProject(fs, dir)`는 모델 찾기, 읽기, 검증을 한 번에 해서 `{ issues, models }`를 돌려준다. `issues`는 `P01`·`P02`만 담고, `models`의 항목은 `{ dir, issues, counts }`다(`issues`는 `loadModel`과 `validateModel`의 것). 프로젝트 오류는 `file`로 모델과 이어진다. CLI와 MCP(F08)가 이것을 부른다.
- `Issue`의 필드:

  | 필드             | 내용                                                                                                    |
  | ---------------- | ------------------------------------------------------------------------------------------------------- |
  | `rule`           | `syntax`, `yaml-feature`, `schema`, `R01`~`R12`, `P01`, `P02`, `comment`                                |
  | `severity`       | `error` 또는 `warning`. `comment`만 `warning`이다                                                       |
  | `file`           | 연 폴더 기준 경로                                                                                       |
  | `path`           | 파일 데이터 안의 JSON Pointer. `syntax`와 `yaml-feature`는 `""`                                         |
  | `line`, `column` | 1부터. 순서대로 정한다. (1) 파서나 주석이 준 위치가 있으면 그것(`syntax`, `yaml-feature`, `comment`). (2) 없으면 `path`를 위치 색인에서 찾는다: 객체의 키이면 키의 시작, 배열 항목이면 값의 시작. (3) `path`가 `""`이고 파서 위치가 없으면, 위치 색인이 있는 파일은 1:1이고 메모리에서 만든 항목은 줄·열이 없다 |
  | `message`        | 영어 한 줄                                                                                              |

- (2)에서 그 파일의 색인이 없거나 `path`가 색인에 없으면 `line`과 `column`을 뺀다. `path`는 항상 있다. 디스크에서 읽어 바로 검증하면(`validateProject`) 모든 `Issue`에 줄·열이 있다.
- `schema` 오류: `message`는 `<instancePath 또는 "/"> <Ajv 메시지>`, `path`는 `instancePath`다. 모르는 키(`additionalProperties`)는 그 키를 가리킨다.
- `syntax` 오류: YAML은 파서 메시지의 첫 줄을 쓴다.
- `R01`~`R12`: 메시지마다의 규칙 ID와 `path`는 부록 A를 따른다. 검사 내용과 문구는 옛 도구와 같되, 형식 문서와 옛 도구가 다른 네 곳은 형식 문서를 따른다(부록 A의 18, 25, 26, 38).
- 돌려주는 순서는 `file`, 위치가 없는 것 먼저, `line`, `column`, `rule`, `message` 순 정렬이다.
- 주석이 있는 YAML 파일마다 `comment` 경고 하나를 낸다. 모델에 들어간 파일에만 낸다. 위치는 첫 주석이고, 메시지는 `YAML comments are not kept when erdmaker rewrites this file`이다. 예제는 경고가 0개다.

### FR-09 깨진 배치 JSON

- `JSON.parse`가 실패한 배치 파일은 `syntax` 오류 하나로 보고하고 모델에 넣지 않는다. 다른 파일의 검사는 계속된다.
- 위치는 다음 순서로 구한다: 엔진 메시지에 줄·열이 있으면 그것, 없으면 같은 글을 YAML 파서로 읽어 나온 첫 오류의 위치, 그것도 없으면 1:1.
- 중복 키가 있는 JSON과 컬렉션이 256단계보다 깊이 겹친 JSON도 `syntax` 오류다(YAML 파일과 같은 기준, FR-05).

### FR-10 프로젝트에서 모델 찾기

- `findModels(fs, dir)`는 `{ models, issues }`를 돌려준다. `models`는 `model.yaml`이 있는 폴더의 경로순 목록이고 `issues`는 `P02`다. `P01`은 `model.yaml`을 읽어야 알 수 있어 `validateProject`가 낸다.
- 깊이는 연 폴더가 0이다. 깊이 0~3의 폴더를 본다(`a/b/c/model.yaml`은 찾고 `a/b/c/d/model.yaml`은 찾지 않는다).
- 이름이 `.`으로 시작하는 폴더와 `node_modules`는 들어가지 않는다.
- 모델 폴더 안(깊이 한도 안)에서 또 `model.yaml`이 나오면 안쪽 것을 모델로 치지 않고 `P02` 오류로 보고한다. `file`은 안쪽 `model.yaml`이다.
- 모델 `id`가 겹치면 그 `id`를 가진 모델마다 `P01` 오류를 하나씩 낸다. `file`은 그 모델의 `model.yaml`, `path`는 `/id`이고 메시지에 같은 `id`를 가진 다른 모델의 경로가 든다. `model.yaml`을 읽지 못한 모델은 이 비교에서 뺀다.
- 사전 폴더는 여러 모델이 함께 가리킬 수 있다. 모델마다 따로 읽고, 사전의 오류는 가리키는 모델마다 보고된다.

### FR-11 CLI `erdmaker validate <dir>`

- `<dir>`은 모델 폴더나 프로젝트 폴더다. `<dir>`을 연 폴더로 삼아 `validateProject`를 부른다.
- 출력:
  - 오류는 stderr에 한 줄씩 `<file>:<line>:<column>: <message> [<rule>]`, 끝에 빈 줄과 `<n> error(s)`. 경고는 같은 줄 모양에 메시지 앞에 `warning: `을 붙이고, 개수에 세지 않는다.
  - 오류가 없는 모델은(경고만 있어도) stdout에 `OK: <n> entities, <n> relationships, <n> subtype clusters, <n> subject areas, <n> layouts, <n> words, <n> terms, <n> domains`. `<dir>`이 모델 폴더가 아니면 줄 앞에 `<모델 폴더>: `를 붙인다. `P01`·`P02`는 다른 오류와 같은 줄 모양으로 그 `file`과 함께 찍고 오류 개수와 종료 코드 1에 센다. `P01`이 난 모델과 `P02`의 안쪽 `model.yaml`을 품은 모델은 OK 줄을 내지 않는다.
- 종료 코드:

  | 코드 | 경우                                                                                           |
  | ---- | ---------------------------------------------------------------------------------------------- |
  | 0    | 찾은 모델이 모두 오류 없음(경고는 상관없다)                                                    |
  | 1    | 오류가 하나 이상                                                                               |
  | 2    | 사용법 오류: 인자 없음, 모르는 명령, `<dir>`이 폴더가 아님, 모델을 하나도 못 찾음. stderr에 이유 한 줄 |

- 명령 처리는 종료 코드를 돌려주는 함수로 두고 `bin.ts`는 그 함수만 부른다. 수용 테스트는 `package.json`의 `bin.erdmaker`가 가리키는 파일을 자식 프로세스로 실행한다.

### FR-12 테스트 파일 타입 검사

- `core`, `cli`, `mcp`에 `typecheck` 스크립트를 둔다. `src/**/*.test.ts`를 포함해 `tsc --noEmit`으로 검사한다(테스트용 tsconfig에는 `@types/node`가 있다).
- 루트 `lint` 스크립트 끝에 `pnpm -r typecheck`를 더한다. `web`은 빌드의 `tsc --noEmit`이 이미 `src` 전체를 본다.

### FR-13 옛 검사 도구 제거

- 순서를 지킨다.
  1. 새 검증기와 대조 테스트를 넣는다. 대조 테스트는 예제와 부록 A의 모든 사례를 임시 폴더에 풀고 `tools/validate-format.mjs`를 실행해, 종료 코드와 `<file>: <message>` 줄의 다중집합(같은 줄의 개수까지)이 새 검증기와 같은지 본다. 이 커밋을 올려 CI가 통과하는 것을 확인한다.
  2. 다음 커밋에서 `tools/validate-format.mjs`와 대조 테스트를 지우고, `validate:format`을 새 CLI로 바꾸고, 루트의 `ajv`·`yaml`과 `eslint.config.js`의 `tools/**` 설정을 지운다.
- 대조에서 빼는 것은 일부러 바꾼 동작이고, 각각 AC-05~07에 자기 테스트가 있다: 깨진 배치 JSON과 풀리지 않는 별칭(옛 도구가 죽는다), 배치 JSON의 중복 키(옛 도구는 받아들인다), `yaml-feature` 사례 전부(파일을 모델에서 빼는 것과 `%TAG`), 맵 키 충돌과 컬렉션 키, `.inf`·`.nan`·큰 정수, 부록 A의 18(키 순서만 다른 타입), 25(다대다), 26(PK나 IE를 가리키는 `parentKey`), 38. 그 밖에 `syntax` 메시지의 둘째 줄 이후, `P01`·`P02`, 경고는 비교하지 않는다.
- 지운 뒤에도 부록 A 사례의 기대 `message`가 옛 문구를 계속 고정한다.

### FR-14 문서 갱신

- `CLAUDE.md`: "지금 상태"와 "명령" 절. `validate:format`이 `pnpm build` 뒤에 된다는 것, 테스트 타입 검사가 `pnpm lint`에 들어간 것을 적는다.
- `docs/format-v0.md`, `docs/planning.md`에서 `tools/validate-format.mjs`를 가리키는 문장을 새 CLI로 고친다.

## 6. 수용 기준

모두 저장소 루트에서 `pnpm install && pnpm build` 뒤에 실행한다. "테스트"라고 적은 것은 `pnpm test`에 들어 있는 Vitest 테스트이고, 통과 조건은 그 테스트의 단언이다. 명령은 따로 적지 않으면 종료 코드 0이 통과다.

| #     | 요구사항      | 확인 방법                                                 | 통과 조건                                                                                                                                                                                                                                              |
| ----- | ------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-01 | FR-05~07      | `core` 테스트 "예제 왕복"                                 | 디스크의 `format/v0/examples/shop`을 읽어 `serializeModel`한 결과가, 경로 집합은 폴더의 파일 29개와 같고 내용은 파일마다 바이트가 같다. `Issue`는 경고를 포함해 0개다                                                                                                   |
| AC-02 | FR-06         | `core` 테스트 "비정규형 입력"                             | 예제를 메모리에서 흐트러뜨린 사본(스키마 `properties`에 있는 키와 `nodes`·`edges`의 키만 순서 뒤집기, 기본값 명시, `entities` 역순, CRLF, 배치를 들여쓰기 4칸으로 다시 쓰기)을 읽어 `serializeModel`하면 원래 예제와 바이트가 같다. 따로, `physicalTypes`의 키 순서를 뒤집은 사본은 뒤집힌 순서 그대로 써진다 |
| AC-03 | FR-06         | `core` 테스트 "쓰기 세부"                                 | 단언 여덟: (1) `NO`, `no`, `yes`, `on`, `off`, `~`, `null`, `0.1`, `1e3`, 앞뒤 공백이 있는 글을 쓴 결과를 YAML 1.2 core와 1.1로 읽으면 같은 문자열이다. (2) 줄바꿈 둘로 끝나는 여러 줄 글이 쓰고 읽어 같다. (3) `default: { expression: … }`가 써진다. (4) 선택 키를 모두 가진 관계를 키 역순으로 넣으면 스키마 순서로 써진다. (5) 공통 스키마를 참조하는 `type`의 키가 `base`, `length`, `precision`, `scale` 순이다. (6) 노드 ID `9`, `10`, `2`가 `10`, `2`, `9` 순으로 써지고 값의 키는 `x`, `y`, `width` 순이며, 빈 `nodes`·`edges`·엣지 값·`waypoints`는 `{}`·`[]`로 써진다. (7) `ext` 안 두 곳이 같은 객체를 참조하는 모델을 쓰면 글에 `&`·`*` 앵커 표기가 없고, 다시 읽으면 값이 같고 `Issue`가 0개다. (8) 파일의 마지막 값이 `"a\n\n"`이면 글이 줄바꿈 정확히 하나로 끝나고, 다시 읽은 값이 `"a\n\n"`이다 |
| AC-04 | FR-06         | `core` 테스트 "바뀐 파일만 쓰기"                          | 메모리 어댑터의 실제 내용으로 확인한다. 예제 그대로: 쓴 경로 0개, 내용 불변. 엔터티 하나의 `name` 변경: 쓴 경로가 그 파일 하나이고 내용이 `serializeModel`의 것과 같으며 나머지 28개는 불변. 모델에 새 엔터티 항목 추가: 그 `file`이 생긴다. 스키마 오류로 읽기에서 빠진 파일: `writeModel` 뒤에도 바이트가 같다. 속성의 `default`가 `Infinity`이거나 `2 ** 53`인 모델: `validateModel`이 `must be a JSON value` 오류를 내고, `serializeModel`은 던지고, `writeModel`은 거부되며 어댑터 내용이 불변이다 |
| AC-05 | FR-08         | `core` 테스트 "규칙 사례"                                 | 부록 A의 사례마다 `Issue` 목록이 기대값과 정확히 같다(`rule`, `severity`, `file`, `path`, `line`, `column`, `message`를 비교하고, 더 있거나 덜 있으면 실패). 치환할 문자열이 예제에 없으면 실패한다. 사례 전체의 `rule`을 모으면 `R01`~`R12`가 모두 있다. `type`의 키 순서만 다른 이주 속성과, 부모와 자식 모두 `domain`도 `type`도 없는 이주 속성은 오류가 0개이고, 부모와 도메인이 다른 이주 속성과 부모는 도메인인데 자식은 `type`인 이주 속성은 `R06`이다. 디스크를 거치지 않고 메모리에서 고친 모델에 `validateModel`을 부르면 스키마 오류와 규칙 오류가 `path`는 있고 `line`·`column`은 없이 나온다. 메모리 모델의 엔터티 하나를 `attributes: null`로 바꾸면 예외 없이 그 파일의 `schema` 오류가 나오고, 그 엔터티는 규칙 검사에서 빠진 것으로 다뤄진다. `ext`가 자기 자신을 가리키는 엔터티는 예외 없이 `must be a JSON value` 오류가 나온다. 한 파일에 위치가 없는 `Issue`와 있는 `Issue`가 함께 있으면 없는 것이 앞이다 |
| AC-06 | FR-05, FR-08  | `core` 테스트 "문법과 스키마"                             | 사례마다 `Issue` 목록 전체를 `rule`, `file`, `path`, `line`, `column`, `message`로 비교한다. 앵커, 별칭, 풀리지 않는 별칭, `!custom` 태그, `!!binary` 태그, `%TAG`로 선언한 태그: 사례 파일마다 모르는 키도 함께 넣는다. FR-05의 메시지로 `yaml-feature`만 나오고, 그 파일의 `schema` 오류는 없으며, 그 파일은 모델에 없다. 중복 키, `ext` 안의 `true`와 `"true"` 키: `syntax`(뒤는 키 이름이 든 메시지). 모르는 키, 필수 키 누락, `ext` 안의 `.inf`, `ext` 안의 `9007199254740993`과 `1e300`: `schema`. 컬렉션 맵 키: `syntax`. 예제 사전의 `abbreviation` `"NO"`는 문자열 `NO`로 읽힌다. 주석 한 줄을 넣은 사례는 `severity`가 `warning`인 `comment` 하나만 낸다 |
| AC-07 | FR-09         | `core` 테스트 "깨진 배치"                                 | `layouts/sales.json`을 `{"formatVersion": "0.1", "nodes": {`와 줄바꿈으로 바꾸고 엔터티 하나에 모르는 도메인을 넣은 사례에서, 예외 없이 오류가 정확히 2개 나온다: `layouts/sales.json`의 `syntax`(위치가 정확히 2:1)와 엔터티 파일의 `R02`. 한 줄에 `nodes` 키가 둘인 배치는 `syntax` 하나이고 `column`이 둘째 키의 자리다 |
| AC-08 | FR-10         | `core` 테스트 "모델 찾기" (메모리 어댑터)                 | 깊이 3의 모델은 찾고 깊이 4는 찾지 않는다. `.hidden/`과 `node_modules/` 안의 모델은 찾지 않는다. 모델 안의 모델은 `findModels`의 `models`에 없고 `issues`에 `P02`로 있으며 `file`이 안쪽 `model.yaml`이다. `id`가 같은 두 모델은 `validateProject`의 `issues`에 `P01`이 둘 있고 `file`이 각 모델의 `model.yaml`이며, 두 모델의 `issues`에는 없다. 두 모델이 `../dictionary`를 함께 가리키는 프로젝트는 오류가 0개다 |
| AC-09 | FR-02         | `core` 테스트 "어댑터 계약"                               | 같은 테스트 묶음이 메모리 구현과 Node 구현(임시 폴더)에서 통과한다: 쓰고 읽기, 없는 상위 폴더에 쓰기, `list`의 종류 구분, 없는 폴더의 `list`가 빈 목록, 없는 파일과 경로 중간이 파일인 경로 읽기가 `FileNotFoundError`, 폴더를 읽으면 `FileNotFoundError`가 아닌 오류, `remove`, `..`로 시작하는 경로 읽기 |
| AC-10 | FR-01         | `cli` 테스트 "브라우저 번들"                              | 6.1                                                                                                                                                                                                                                                    |
| AC-11 | FR-01         | `pnpm --filter @erdmaker/core exec tsc --showConfig`      | `lib`가 `["es2022"]`이고 `types`가 `[]`다                                                                                                                                                                                                              |
| AC-12 | FR-03         | `core` 테스트 "스키마 동기화"                             | `format/v0/schema`의 파일 8개를 파싱한 값과 생성 모듈의 값이 개수가 같고, 파일마다 `JSON.stringify` 결과가 같다(키 순서까지 본다) |
| AC-13 | FR-11         | `cli` 테스트 "validate"                                   | `packages/cli/package.json`의 `bin.erdmaker`가 가리키는 파일을 자식 프로세스로 실행해 종료 코드, stdout, stderr를 각각 단언한다. 예제: 0과 6.2의 요약 줄. `format/v0/examples`: 0과 `shop: `이 앞에 붙은 같은 줄. 규칙 사례 하나를 푼 임시 폴더: 1, stderr에 `<file>:<line>:<column>: <message> [<rule>]` 줄과 `1 error(s)`. 주석만 넣은 사례: 0, stderr에 `warning: `이 든 줄, stdout에 요약 줄. `id`가 같은 모델 둘과 모델 안의 `model.yaml`이 있는 임시 프로젝트: 1, stderr에 `P01` 줄 둘과 `P02` 줄 하나가 각자의 `model.yaml` 경로로 나오고, stdout에 그 모델들의 OK 줄이 없다. 모델이 없는 폴더, 없는 경로, 인자 없음, 모르는 명령: 각각 2 |
| AC-14 | FR-11, FR-13  | 6.2                                                       | `npm run validate:format`과 `pnpm validate:format`이 선언된 bin 파일을 실행하고, 종료 코드 0과 같은 요약 줄을 낸다. 옛 도구 파일이 없다 |
| AC-15 | FR-12         | 6.3                                                       | 테스트 파일에 타입 오류가 있으면 `pnpm lint`가 그 오류로 실패한다 |
| AC-16 | FR-13         | 대조 테스트가 든 커밋의 CI (`gh run list --commit <sha>`) | 성공이다. PR 설명에 그 커밋의 해시를 적는다                                                                                                                                                                                                            |
| AC-17 | FR-01         | 6.4                                                       | `ajv`와 `yaml`이 `core`의 `dependencies`에만 있고, 직접 의존성에 GPL·AGPL이 없다                                                                                                                                                                       |
| AC-18 | 제약          | [repo-scaffold.md](./repo-scaffold.md) 6.5의 절차         | `spikes/`의 파일 목록과 해시가 작업 전과 같다                                                                                                                                                                                                          |
| AC-19 | 전체          | `pnpm build && pnpm test && pnpm lint`, PR 뒤 `gh pr checks` | 모두 성공이다                                                                                                                                                                                                                                       |

### 6.1 AC-10 브라우저 번들

`cli` 패키지의 테스트 하나가 다음을 한다(테스트는 Node에서 돌지만 검사 대상은 번들이다).

1. Vite의 `build`로 `packages/core/dist/index.js`를 IIFE 하나로 묶는다. 플러그인이 `node:`로 시작하거나 `node:module`의 `builtinModules`에 있는 모듈을 가져오려는 시도를 만나면 빌드를 실패시킨다.
2. 묶은 코드를 전역이 `console`뿐인 `node:vm` 컨텍스트에서 실행한다. `process`, `require`, `Buffer`가 없다.
3. 그 안에서 예제 파일 29개를 메모리 어댑터에 넣고 `validateProject`를 불러 오류 0개, 엔터티 10개를 확인한다.

### 6.2 AC-14 `validate:format`

```bash
want='OK: 10 entities, 11 relationships, 1 subtype clusters, 3 subject areas, 2 layouts, 5 words, 4 terms, 8 domains'
bin=packages/cli/$(node -p "require('./packages/cli/package.json').bin.erdmaker") || exit 1
test ! -e tools/validate-format.mjs || exit 1
test "$(head -n 1 "$bin")" = '#!/usr/bin/env node' || exit 1
node -e "process.exit(require('./package.json').scripts['validate:format'] === 'node $bin validate format/v0/examples/shop' ? 0 : 1)" || exit 1
out=$(npm run --silent validate:format) || exit 1
test "$out" = "$want" || exit 1
out=$(pnpm --silent validate:format) || exit 1
test "$out" = "$want" || exit 1
node "$bin" validate docs; test $? -eq 2
```

### 6.3 AC-15 테스트 타입 검사

```bash
for p in core cli mcp; do
  f=packages/$p/src/zz-probe.test.ts
  printf "export const n: number = 'x';\n" > "$f"
  out=$(pnpm lint 2>&1); code=$?
  rm "$f"
  test $code -ne 0 || exit 1
  echo "$out" | grep -q "zz-probe.test.ts.*TS2322" || exit 1
done
pnpm lint
```

탐침 파일은 ESLint와 Prettier를 통과하는 내용이라, 실패는 타입 검사에서만 난다.

### 6.4 AC-17 의존성

```bash
node -e "
const r = require('./package.json'), c = require('./packages/core/package.json');
const all = { ...r.dependencies, ...r.devDependencies };
if (all.ajv || all.yaml || !c.dependencies.ajv || !c.dependencies.yaml) process.exit(1);
if (Object.keys(c.dependencies).sort().join() !== 'ajv,yaml') process.exit(1);"
```

이어서 [repo-scaffold.md](./repo-scaffold.md) 6.4의 라이선스 스크립트를 그대로 실행한다.

## 7. 구현할 때 확인할 것

- **`yaml`의 출력 옵션**: `lineWidth: 0`, `compat: 'yaml-1.1'`, `aliasDuplicateObjects: false`를 쓴다. 앞의 둘로 예제가 재현되는 것은 2.9.1에서 확인했다. 패키지를 올리면 출력이 달라질 수 있고, AC-01이 잡는다.
- **Ajv와 CSP**: Ajv는 `new Function`을 쓴다. 화면(F09)이 `unsafe-eval`을 막는 CSP를 걸면 코어의 스키마 검사가 브라우저에서 실패한다. 이 기능은 CSP가 없는 환경(AC-10)까지만 확인한다. PWA의 콘텐츠 보안 정책은 F09에서 정한다. eval을 막는 정책이면 검사 함수를 빌드 때 미리 만든다(Ajv standalone).
- **AC-10의 방법**: 분석에서 됐다. Vite 8 라이브러리 모드의 IIFE가 `console`만 있는 `vm` 컨텍스트에서 돈다. 차단 플러그인은 꼭 있어야 한다. 없으면 Vite가 `node:fs`를 빈 모듈로 바꾸고 빌드가 성공한다.
- **Ajv 가져오기**: `import { Ajv2020 } from 'ajv/dist/2020.js'`로 쓴다. 기본 내보내기는 NodeNext에서 `TS2351`로 컴파일되지 않는다(분석에서 확인).
- **`core`의 컴파일 두 번**: `src/node/`용 tsconfig가 기본 진입점의 파일을 함께 내보낼 수 있다. 출력이 같은지, `dist/`에 테스트 파일이 들어가지 않는지 확인한다.
- **6장의 스크립트**는 구현 전에 써서 실행해 보지 않았다. 틀리면 같은 조건을 검사하도록 고친다(조건을 낮추지 않는다).

## 8. 알려진 한계

열린 질문은 2026-11-27에 모두 정해져 본문에 반영했다. 남는 한계는 다음과 같다.

- 조용히 넘어가는 것(옛 도구와 같다): `dictionaries`에 적힌 폴더가 없을 때, `entities/foo.yml`처럼 확장자가 다른 파일, 모델 폴더의 모르는 파일.
- YAML 파서도 받아들이는 깨진 JSON(끝 쉼표 등)은 엔진이 위치를 주지 않으면 1:1로 보고된다.
- YAML 주석은 파일을 다시 쓸 때 사라진다. 경고로만 알린다.
- 모델 폴더 안의 심볼릭 링크는 무시한다. 사전을 함께 쓰려면 링크 대신 `dictionaries: [../shared]`로 가리킨다.
- 메모리 어댑터의 `list`는 저장된 경로를 모두 훑으므로 폴더가 수천 개인 모델에서 느리다. 실제 모델은 폴더가 몇 개다.
- `ext` 안의 맵에 숫자뿐인 키가 있으면 순서가 보존되지 않는다(JavaScript 객체의 키 순서).

## 부록 A. 규칙 메시지와 사례

옛 도구의 파일 간 검사 전부와 새로 더한 38번이다. 줄마다 위반 사례가 하나 이상 있어야 한다(1번은 종류 일곱 모두, 26번은 메시지 셋 모두, 33번은 둘 모두). `file`은 옛 도구가 보고하던 파일 그대로이고, 24~29번은 관계 파일이나 서브타입 파일이다. "링크"는 관계 파일이면 `""`, 서브타입 멤버이면 `/members/<i>`다. 가리키는 키가 파일에 없으면 그 키를 가질 객체를 가리킨다.

| #   | 규칙 | 메시지                                                                       | `path`                                               |
| --- | ---- | ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | R01  | `duplicate <종류> id "<id>" (also in <file>)`. 종류는 `entity`, `relationship`, `subtype`, `subject area`, `word`, `term`, `domain`. `<file>`은 모델 폴더 기준 경로 | 뒤 파일의 `/id`, 사전은 `/words/<i>/id`, `/terms/<i>/id`, `/domains/<i>/id` |
| 2   | R02  | `term "<id>": unknown word "<w>"`                                            | `/terms/<i>/words/<j>`                               |
| 3   | R02  | `term "<id>": unknown domain "<d>"`                                          | `/terms/<i>/domain`                                  |
| 4   | R10  | `duplicate schema "<name>"`                                                  | `model.yaml`의 `/schemas/<i>/name`                   |
| 5   | R12  | `duplicate area group id "<id>"`                                             | `model.yaml`의 `/areaGroups/<i>/id`                  |
| 6   | R10  | `physical.schema "<s>" is not listed in model.yaml`. 적힌 `physical.schema`만 검사한다. `schemas`가 있어도 `physical.schema`가 없는 엔터티는 오류가 아니다 | `/physical/schema` |
| 7   | R11  | `table name "<n>" is already used by "<id>" in the same schema`              | `/physical/name`                                     |
| 8   | R12  | `unknown area group "<g>"`                                                   | `/group`                                             |
| 9   | R01  | `member id "<id>" clashes with another relationship or subtype member`       | `/members/<i>/id`                                    |
| 10  | R01  | `duplicate attribute id "<id>"`                                              | `/attributes/<i>/id`                                 |
| 11  | R02  | `attribute "<a>": unknown domain "<d>"`                                      | `/attributes/<i>/domain`                             |
| 12  | R02  | `attribute "<a>": unknown term "<t>"`                                        | `/attributes/<i>/term`                               |
| 13  | R08  | `attribute "<a>": scope is wider than its entity's`                          | `/attributes/<i>/scope`                              |
| 14  | R02  | `attribute "<a>": unknown relationship "<r>"`                                | `/attributes/<i>/migratedFrom/<j>/relationship`      |
| 15  | R04  | `attribute "<a>": "<r>" does not have this entity as its child`              | 14와 같음                                            |
| 16  | R04  | `attribute "<a>": a many-to-many relationship migrates nothing`              | 14와 같음                                            |
| 17  | R02  | `attribute "<a>": parent "<p>" has no attribute "<x>"`                       | `/attributes/<i>/migratedFrom/<j>/attribute`         |
| 18  | R06  | `attribute "<a>": type differs from <p>.<x>`. 속성의 타입은 `domain`이 있으면 그 도메인, 없으면 `type`, 둘 다 없으면 "없음"이다. 도메인은 같은 ID끼리, `type`은 키 순서와 상관없이 필드가 같은 것끼리, "없음"은 "없음"끼리만 같다 | `/attributes/<i>` |
| 19  | R06  | `attribute "<a>": name differs from <p>.<x> but rolenamed is not set`        | `/attributes/<i>/name`                               |
| 20  | R07  | `attribute "<a>": a recursive relationship needs a rolename`                 | `/attributes/<i>`                                    |
| 21  | R01  | `duplicate key id "<k>"`                                                     | `/keys/<i>/id`                                       |
| 22  | R02  | `key "<k>": unknown attribute "<a>"`                                         | `/keys/<i>/attributes/<j>`                           |
| 23  | R03  | `more than one primary key`                                                  | 둘째 PK의 `/keys/<i>`                                |
| 24  | R02  | `"<id>": unknown <parent\|child> entity "<e>"`                               | `/parent`, `/child`, `/supertype`, `/members/<i>/entity` |
| 25  | R08  | `"<id>": scope is wider than its <parent\|child> entity's`. 다대다 관계에도 검사한다 | `/scope` |
| 26  | R02 / R04 / R04 | `"<id>": parent "<p>" has no key "<k>" to migrate` / `"<id>": parentKey "<k>" must be an alternate key of "<p>"` (종류가 `primary`나 `inversion`) / `"<id>": parent "<p>" has no primary key to migrate` | `/parentKey` / `/parentKey` / 링크 |
| 27  | R04  | `"<id>": <p>.<pa> must migrate to exactly one attribute of "<c>" (found <n>)` | 링크                                                |
| 28  | R05  | `"<id>": <c>.<t> must be part of the child's primary key`                    | 링크                                                 |
| 29  | R05  | `"<id>": non-identifying, but <c>.<t> is the child's whole primary key`      | 링크                                                 |
| 30  | R02  | `unknown resolvedBy entity "<e>"`                                            | `/resolvedBy`                                        |
| 31  | R02  | `supertype "<s>" has no attribute "<d>"`                                     | `/discriminator`                                     |
| 32  | R02  | `unknown entity "<e>"` (주제영역)                                            | `/entities/<i>`                                      |
| 33  | R09  | `second layout for subject area "<a>"` / `second layout for the whole model` | `/subjectArea` / `""` |
| 34  | R09  | `unknown subject area "<a>"`                                                 | `/subjectArea`                                       |
| 35  | R09  | `node for unknown entity "<n>"`                                              | `/nodes/<n>`                                         |
| 36  | R09  | `entity "<n>" is not in subject area "<a>"`                                  | `/nodes/<n>`                                         |
| 37  | R09  | `edge for unknown relationship "<e>"` | `/edges/<e>` |
| 38  | R04  | `attribute "<a>": <p>.<x> is not part of the key that "<r>" migrates` (다대다가 아니고 부모 속성과 키가 있을 때) | `/attributes/<i>/migratedFrom/<j>/attribute` |
