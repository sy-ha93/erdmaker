# F02 `core-model-io` 구현 계획

**작성일**: 2026-11-27
**스펙**: [docs/specs/core-model-io.md](../specs/core-model-io.md)
**분석 보고서**: [docs/analysis/core-model-io.md](../analysis/core-model-io.md)
**설계 문서**: 없음 (공개 API는 스펙이, 파일 배치는 분석 3.2절이 정한다. 모듈 나눔은 이 계획 2장에 있다)
**브랜치**: `feature/core-model-io`
**상태**: 진행 중 (단계 4/6 완료)

스펙과 분석이 다르면 스펙을 따른다. 스펙은 분석 뒤에 고쳐졌다(분석 5장의 S1~S8, S11은 스펙 본문에 이미 반영됐다). 이 계획은 스펙의 규칙을 다시 적지 않는다. 구현자는 FR·AC 번호와 부록 A의 줄 번호로 스펙을 찾아 읽는다.

## 1. 요구사항 요약

| 요구사항 | 내용                                                   | 단계       | 닫는 수용 기준             |
| -------- | ------------------------------------------------------ | ---------- | -------------------------- |
| FR-01    | 의존성, `./node` 진입점, tsconfig 둘, CLI `bin`        | 1, 6       | AC-11, AC-10, AC-17        |
| FR-02    | 파일 어댑터 인터페이스, 메모리·Node 구현, 계약 테스트  | 2          | AC-09                      |
| FR-03    | 스키마 생성 스크립트와 생성 모듈                       | 1          | AC-12                      |
| FR-04    | 메모리 모델, 공개 이름                                 | 3          | (AC-01~08이 함께 확인)     |
| FR-05    | 읽기 (YAML·JSON, 위치, 문법·기능·JSON 값 검사)         | 2, 3       | AC-06                      |
| FR-06    | 쓰기 (`serializeModel`, `writeModel`)                  | 5          | AC-01, AC-02, AC-03, AC-04 |
| FR-07    | 예제 정규화, 스키마 한 곳, 형식 문서 보강              | 1          | AC-01 (단계 5에서 확인)    |
| FR-08    | 검증 (`validateModel`, `validateProject`, `Issue`)     | 3, 4, 6    | AC-05, AC-06               |
| FR-09    | 깨진 배치 JSON                                         | 2, 4       | AC-07                      |
| FR-10    | 프로젝트에서 모델 찾기, 프로젝트 오류의 위치           | 6          | AC-08                      |
| FR-11    | CLI `erdmaker validate <dir>`, 프로젝트 오류의 출력    | 6          | AC-13, AC-14               |
| FR-12    | 테스트 파일 타입 검사                                  | 1          | AC-15                      |
| FR-13    | 옛 검사 도구 제거 (대조 테스트 → 삭제)                 | 6 (6A, 6B) | AC-16, AC-14               |
| FR-14    | 문서 갱신                                              | 6 (6B)     | AC-19 (서식)               |
| 제약     | `spikes/`를 건드리지 않는다                            | 0, 6       | AC-18                      |

DB, API, 화면 요구사항은 없다.

### 수용 기준과 단계

AC 하나는 단계 하나에서만 닫는다.

| 단계                    | 닫는 AC                           |
| ----------------------- | --------------------------------- |
| 1 패키지 틀             | AC-11, AC-12, AC-15               |
| 2 어댑터와 파서         | AC-09                             |
| 3 스키마 검사와 읽기    | AC-06                             |
| 4 파일 간 규칙          | AC-05, AC-07                      |
| 5 쓰기                  | AC-01, AC-02, AC-03, AC-04        |
| 6A 프로젝트, CLI, 대조  | AC-08, AC-10, AC-13, AC-16        |
| 6B 옛 도구 제거와 문서  | AC-14, AC-17, AC-18, AC-19        |

AC-16과 AC-19의 뒷부분(`gh pr checks`)은 push가 있어야 닫힌다. push와 PR은 이 계획의 작업이 아니고, 사용자가 승인한 뒤 리드가 한다(단계 6의 관문 참고).

## 2. 분석 보고서 반영과 모듈 나눔

### 적용한 권장 사항

| 분석 항목                                           | 계획에 반영한 내용                                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 3.2절 파일 배치                                     | 그대로 쓴다. 다른 점은 아래 "계획에서 정한 것" 1, 2뿐이다                                                      |
| 4.1절 YAML 읽기·쓰기 옵션, CST로 위치 찾기          | 단계 2(읽기), 단계 5(쓰기). 옵션 값은 스펙 FR-05와 7장을 따른다                                                |
| 4.2절 배치 JSON은 글을 직접 찍는다                  | 단계 5. `JSON.stringify(v, null, 2)`와 "정렬한 새 객체"를 쓰지 않는다                                          |
| 4.3절 A1 Ajv 가져오기                               | `import { Ajv2020 } from 'ajv/dist/2020.js'`                                                                   |
| 4.4절 `properties`는 "키 → 스키마" 맵이다           | 단계 5의 스키마 따라가기. 키 이름이 `default`인 속성을 기본값 키워드로 읽지 않는 테스트를 둔다                 |
| 4.5절 생성 스크립트는 `.ts`, `packages/core/scripts` | 단계 1. 시제품과 달리 경로를 인자로 받지 않고 `import.meta.url`에서 구한다(1.6)                               |
| 4.6절 차단 플러그인 없이는 번들 테스트가 무의미하다 | 단계 6A. `node:fs`를 가져오는 진입점이 빌드에 실패하는 단언을 같은 테스트에 둔다                               |
| 4.9절 옛 출력 해석의 함정                           | 단계 6A. 파일 부분이 `.yaml`·`.json`으로 끝나는 줄만 오류의 시작으로 본다                                      |
| 2.4절 C1, C2 (커밋 경계)                            | 단계 6A까지 옛 도구와 루트 `ajv`·`yaml`을 남기고, 6B 한 커밋에서 함께 지운다                                   |
| 2.4절 C5, C6 (`pnpm build`가 먼저)                  | 모든 단계의 관문을 `build → test → lint → validate:format` 순서로 돌린다. `.github/workflows/ci.yml`은 고치지 않는다 |
| 7장 피할 것                                         | 6장 "구현할 때 참고"에 옮겼다                                                                                  |

### 재사용하는 것

| 대상                              | 위치                                                                  | 쓰임                                                                             |
| --------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 규칙 검사 로직과 메시지 문구      | `tools/validate-format.mjs`                                           | 단계 4에서 옮긴다. 문구는 글자 그대로. 6A의 대조 기준                            |
| Ajv 설정, YAML 읽기 옵션, 요약 줄 | 같은 파일                                                             | 단계 3, 2, 6A                                                                    |
| 시제품 3개                        | 분석 보고서 머리말에 적힌 실험 폴더의 `writer-proto.mjs`, `layout-proto.mjs`, `bundle/bundle.test.js` | 참고로 읽는다. 그대로 복사하지 않는다(스펙이 분석 뒤에 바뀌었고, 시제품은 타입도 테스트도 없다). 폴더가 사라졌으면 분석 4.2, 4.4, 4.6절만으로 진행한다 |
| 정규화한 예제 3개                 | 같은 폴더의 `corrected/`                                              | 단계 1에서 손으로 고친 결과와 비교하는 참고. 최종 판정은 AC-01이다               |
| F01의 검사 절차                   | `docs/specs/repo-scaffold.md` 6.4, 6.5                                | AC-17(라이선스), AC-18(`spikes/`)                                                |

### 모듈 나눔

`packages/core/src/` 아래다. "공개"는 `src/index.ts`가 다시 내보내는 이름이다. 스펙 FR-04가 정한 이름 밖의 것은 이 계획이 정했다.

| 파일                      | 하는 일                                                                   | 공개 이름                                                                                   | 단계 |
| ------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---- |
| `generated/schemas.ts`    | 스키마 8개 (생성물). 이 폴더에는 생성물만 둔다                            | 없음                                                                                        | 1    |
| `model/types.ts`          | 타입만                                                                    | `Model`, `ModelItem`, `Issue`, `Severity`, `Position`, `PositionIndex`, 데이터 타입 `ManifestData`, `EntityData`, `RelationshipData`, `SubtypeData`, `SubjectAreaData`, `LayoutData`, `DictionaryData` | 2, 3 |
| `fs/adapter.ts`           | 인터페이스와 오류 클래스                                                  | `FileSystemAdapter`, `FileEntry`, `FileNotFoundError`                                       | 2    |
| `fs/path.ts`              | 경로 합치기와 정규화                                                      | 없음 (코어 안에서만 쓴다)                                                                   | 2    |
| `fs/memory.ts`            | 메모리 구현                                                               | `createMemoryFileSystem`                                                                    | 2    |
| `node/fs.ts`, `node/index.ts` | Node 구현 (`@erdmaker/core/node`)                                     | `createNodeFileSystem`                                                                      | 2    |
| `validate/json-value.ts`  | JSON 값 검사 (읽기, 검증, 쓰기가 함께 쓴다)                               | 없음                                                                                        | 2    |
| `parse/yaml.ts`           | YAML 읽기, 문법·기능·키 충돌 검사, 첫 주석, 위치 색인                     | 없음                                                                                        | 2    |
| `parse/json.ts`           | 배치 JSON 읽기, 문법 오류 위치, 중복 키, 위치 색인                        | 없음                                                                                        | 2    |
| `schema/ajv.ts`           | Ajv 인스턴스 (처음 쓸 때 만들어 둔다)                                     | 없음                                                                                        | 3    |
| `validate/schema.ts`      | Ajv 오류 → `Issue`                                                        | 없음                                                                                        | 3    |
| `validate/issues.ts`      | 위치 채우기, 정렬                                                         | 없음                                                                                        | 3    |
| `model/load.ts`           | `loadModel`                                                               | `loadModel`, `LoadResult`                                                                   | 3    |
| `validate/index.ts`       | `validateModel` (스키마·JSON 값 검사 뒤 규칙)                             | `validateModel`                                                                             | 3, 4 |
| `validate/rules.ts`       | R01~R12. 길어지면 `validate/rules/` 아래로 나눈다                         | 없음                                                                                        | 4    |
| `schema/resolve.ts`       | 값의 스키마 찾기, 키 순서, 기본값                                         | 없음                                                                                        | 5    |
| `model/serialize.ts`      | `serializeModel`, YAML 쓰기                                               | `serializeModel`, `SerializedFile`                                                          | 5    |
| `model/layout-json.ts`    | 배치 JSON 쓰기                                                            | 없음                                                                                        | 5    |
| `model/write.ts`          | `writeModel`                                                              | `writeModel`                                                                                | 5    |
| `project/find.ts`         | `findModels` (P02)                                                        | `findModels`                                                                                | 6A   |
| `project/validate.ts`     | `validateProject` (P01, 모델별 결과와 개수)                               | `validateProject`, `ProjectResult`, `ModelResult`, `ModelCounts`                            | 6A   |
| `testing/example.ts`      | 테스트 도우미: 예제 읽기, 치환                                            | 없음 (빌드에서 뺀다)                                                                        | 3    |
| `testing/cases.ts`        | 부록 A 사례의 정의와 기대 `Issue`                                         | 없음 (빌드에서 뺀다)                                                                        | 4    |

`packages/cli/src/`: `main.ts`(인자 해석, `validateProject` 호출, 출력, 종료 코드를 돌려주는 함수), `bin.ts`(셔뱅과 `main` 호출만). `index.ts`는 그대로 둔다.

의존 방향은 한쪽이다: `parse`·`fs`·`schema` → `validate` → `model` → `project`. `src/node/`는 기본 진입점의 파일을 가져올 수 있고, 반대는 안 된다(타입 오류가 난다. 분석 3.2절).

### 계획에서 정한 것

스펙과 분석이 계획에 넘긴 것이다.

1. **계약 테스트 묶음의 자리** (분석 S9): `packages/core/src/fs/adapter.test.ts` 한 파일에 묶음을 정의하고 메모리 구현과 Node 구현(임시 폴더)에 각각 돌린다. 테스트 파일이라 빌드에서 빠지고, 따로 내보낼 모듈이 필요 없다.
2. **테스트 도우미의 자리**: `packages/core/src/testing/`. `packages/core/tsconfig.json`의 `exclude`에 `src/testing`을 더해 `dist`에 들어가지 않게 한다. 타입 검사는 `tsconfig.test.json`이 한다. `cli`의 테스트는 이 도우미를 쓰지 않는다. 예제를 `node:fs`로 직접 읽고 필요한 사례를 테스트 안에 적는다(패키지 경계를 넘는 상대 경로 가져오기를 만들지 않는다).
3. **`serializeModel`의 반환 모양**: `{ file, text }`의 배열, `file`의 코드 단위 순. 타입 이름은 `SerializedFile`.
4. **스키마에 없는 키를 가진 모델의 쓰기** (분석 4.4절, 스펙에 없음): 스키마의 키를 먼저 쓰고, 모르는 키는 모델에 든 순서로 뒤에 쓴다. 검증을 통과한 모델에서는 `ext` 안쪽 말고는 생기지 않는 경우다. 값을 버리지 않는 쪽을 골랐다.
5. **AC-06 사례를 넣는 파일**: 파일이 모델에서 빠져도 다른 파일의 규칙 오류가 따라 나오지 않는 파일에 둔다. `subject-areas/party.yaml`은 어느 배치도 가리키지 않아 조건에 맞는다(예제에서 확인). 그래야 AC-06의 "목록 전체 비교"가 규칙이 없는 단계 3에서 닫히고 단계 4에서 바뀌지 않는다. 따라 나오는 오류는 AC-07과 대조 테스트가 본다.
6. **`spikes/` 기준선의 자리**: `docs/handoff/core-model-io-spikes-before.sha256`. `docs/handoff/`는 `.gitignore`에 있고 린트·서식 대상이 아니다. 사흘짜리 작업이라 `/tmp`는 쓰지 않는다(재부팅하면 사라진다).
7. **생성 스크립트의 타입 검사** (분석 4.5절, 미확인): 하지 않는다. ESLint와 Prettier는 본다. 결과가 틀리면 AC-12가 잡는다.
8. **`clean` 스크립트** (분석 C7): 만들지 않는다. 각 단계의 관문이 `dist` 네 곳을 정확한 경로로 지우고 다시 빌드한다(5장).
9. **`docs/stage1-backlog.md`** (분석 2.2절, FR-14 목록 밖): 6B에서 옛 도구의 경로가 나오는 세 줄(92, 103, 108행)을 고친다. 92행은 뒤 기능의 분석 단계가 읽을 파일 목록이라 지운 파일을 가리키면 안 되고, 103·108행은 F02의 범위 설명이라 경로 대신 "옛 검사 도구"로 적는다.
10. **`core`의 `ajv`·`yaml` 버전 범위**: `^8.20.0`, `^2.9.1`(분석이 확인한 설치본). 설치 뒤 `core`와 루트가 같은 버전으로 풀렸는지 확인한다(1.1). 대조 테스트는 두 쪽이 같은 Ajv일 때만 뜻이 있다.
11. **AC-16의 관문**: 6A 커밋 뒤에 멈춘다(단계 6). CI는 PR과 `main` push에서만 돌므로, 6A 커밋이 PR의 머리일 때 한 번 올라가야 그 커밋의 CI 기록이 생긴다. 6A와 6B를 한꺼번에 올리면 AC-16을 증명할 수 없다.

### 제약

- `spikes/` 아래의 어떤 파일도 만들거나 고치거나 지우지 않는다. `git clean`, 재귀 glob 삭제를 쓰지 않는다.
- 스테이징은 경로를 지정한다. `git add -A`, `git add .`을 쓰지 않는다. `docs/.yyy-workflow-state.json`은 스테이징하지 않는다(무시 대상이다).
- push와 PR 생성은 하지 않는다.
- 외부 의존성은 `core`의 `ajv`, `yaml`뿐이다. 다른 것을 더하지 않는다.
- `format/v0/schema`에서 바뀌는 파일은 `entity.schema.json` 하나, 예제에서 바뀌는 파일은 스펙 2장이 적은 셋이다.
- `.github/workflows/ci.yml`은 고치지 않는다. 단계 순서(`build` → `test` → `lint` → `validate:format`)가 이미 새 `validate:format`의 전제(`pnpm build`가 먼저)를 만족한다.
- 기본 진입점에서 닿는 코드에 `node:` 모듈, `process`, `Buffer`, `console`, `structuredClone`을 쓰지 않는다.

## 3. 영향 분석 (Dry-Run)

### 전체 위험도: 중간

새 코드가 대부분이다. 기존 동작이 바뀌는 곳은 `validate:format`(6B)과 스키마 한 곳, 예제 세 파일이다. 지우는 파일은 Git 이력에서 되살릴 수 있다. DB, API, 인증 변경은 없다.

### 새로 만드는 파일

| 파일                                                                                 | 위험 | 내용                                              |
| ------------------------------------------------------------------------------------ | ---- | ------------------------------------------------- |
| `packages/core/tsconfig.node.json`, `packages/core/tsconfig.test.json`               | 중간 | `src/node` 컴파일, 테스트 포함 타입 검사          |
| `packages/cli/tsconfig.test.json`, `packages/mcp/tsconfig.test.json`                 | 낮음 | 테스트 포함 타입 검사                             |
| `packages/core/scripts/generate-schemas.ts`                                          | 낮음 | 생성 스크립트                                     |
| `packages/core/src/generated/schemas.ts`                                             | 낮음 | 생성물. 커밋한다. 손으로 고치지 않는다            |
| `packages/core/src/{fs,parse,schema,validate,model,project,node}/*.ts`               | 낮음 | 2장 "모듈 나눔"의 파일                            |
| `packages/core/src/testing/{example,cases}.ts`                                       | 낮음 | 테스트 도우미                                     |
| `packages/core/src/**/*.test.ts`                                                     | 낮음 | 4장 각 단계가 적은 테스트                         |
| `packages/core/src/parity.test.ts`                                                   | 낮음 | 대조 테스트. 6A에서 만들고 6B에서 지운다          |
| `packages/cli/src/main.ts`, `packages/cli/src/bin.ts`                                | 낮음 | CLI                                               |
| `packages/cli/src/validate.test.ts`, `packages/cli/src/bundle.test.ts`               | 낮음 | AC-13, AC-10                                      |

### 고치는 파일

| 파일                                                               | 위험 | 내용                                                                                          | 단계  |
| ------------------------------------------------------------------ | ---- | --------------------------------------------------------------------------------------------- | ----- |
| `packages/core/package.json`                                       | 중간 | `dependencies`, `exports["./node"]`, 스크립트 `build`, `typecheck`, `generate:schemas`        | 1     |
| `packages/core/tsconfig.json`                                      | 중간 | `exclude`에 `src/node`, `src/testing`. `lib`와 `types`는 그대로(AC-11)                        | 1     |
| `packages/core/src/index.ts`                                       | 낮음 | 공개 이름 다시 내보내기                                                                       | 2~6A  |
| `packages/cli/package.json`                                        | 중간 | `typecheck`(1), `bin.erdmaker`가 정확히 `dist/bin.js`(6A)                                     | 1, 6A |
| `packages/mcp/package.json`                                        | 낮음 | `typecheck`                                                                                   | 1     |
| `package.json` (루트)                                              | 중간 | `lint` 끝에 `pnpm -r typecheck`(1). `validate:format` 교체, `ajv`·`yaml` 제거(6B)             | 1, 6B |
| `pnpm-lock.yaml`                                                   | 중간 | `pnpm install`이 고친다. `package.json`과 같은 커밋에 넣는다                                  | 1, 6B |
| `eslint.config.js`                                                 | 낮음 | 무시 목록에 `packages/core/src/generated/**`(1). `tools/**` 블록 제거(6B)                     | 1, 6B |
| `.prettierignore`                                                  | 낮음 | `packages/core/src/generated/`                                                                | 1     |
| `format/v0/schema/entity.schema.json`                              | 중간 | 속성 `scope` (FR-07)                                                                          | 1     |
| `format/v0/examples/shop/model.yaml`                               | 낮음 | FR-07                                                                                         | 1     |
| `format/v0/examples/shop/subtypes/customer_type.yaml`              | 낮음 | FR-07                                                                                         | 1     |
| `format/v0/examples/shop/relationships/customer_places_order.yaml` | 낮음 | FR-07                                                                                         | 1     |
| `docs/format-v0.md`                                                | 낮음 | 쓰기 규칙과 검증 규칙(1, FR-07). 검사 도구를 가리키는 문장(6B, FR-14)                         | 1, 6B |
| `CLAUDE.md`, `docs/planning.md`, `docs/stage1-backlog.md`          | 낮음 | FR-14와 2장의 결정 9                                                                          | 6B    |
| `docs/plans/core-model-io.md`                                      | 낮음 | 체크박스와 7장 기록. 각 단계의 커밋에 넣는다                                                  | 전부  |

### 지우는 파일

| 파일                               | 위험 | 내용                                                    | 단계 |
| ---------------------------------- | ---- | ------------------------------------------------------- | ---- |
| `packages/core/src/index.test.ts`  | 낮음 | F01의 스모크 테스트. 실제 테스트가 대신한다             | 1    |
| `tools/validate-format.mjs`        | 높음 | `git rm`. 남는 파일이 없어 `tools/` 폴더도 없어진다     | 6B   |
| `packages/core/src/parity.test.ts` | 낮음 | `git rm`. 옛 도구가 없으면 돌 수 없다                   | 6B   |

### 저장소 밖과 추적하지 않는 곳

| 대상                                             | 변경                                                  |
| ------------------------------------------------ | ----------------------------------------------------- |
| `node_modules/`, `packages/*/node_modules/`      | `pnpm install`이 고친다(단계 1, 6B)                   |
| `packages/{core,cli,mcp,web}/dist`               | 관문마다 지우고 다시 만든다                           |
| `docs/handoff/core-model-io-spikes-before.sha256` | 기준선. 무시 대상이라 커밋되지 않는다                 |
| OS 임시 폴더                                     | 테스트가 `mkdtemp`로 만든 폴더. 테스트가 끝나면 지운다 |

### 파괴적 작업

| 작업                                  | 평가                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `git rm tools/validate-format.mjs`    | 6A의 대조 테스트가 통과하고 그 커밋의 CI가 성공한 뒤에만 한다. Git 이력에 남는다            |
| `validate:format`의 실행 대상 교체    | 같은 요약 줄과 종료 코드를 AC-14가 확인한다. 깨진 배치 등 일부러 바꾼 동작은 스펙 FR-13에 있다 |
| `rm -rf packages/{core,cli,mcp,web}/dist` | 빌드 산출물. 네 경로를 그대로 적어 실행한다                                             |

### 되돌리기

브랜치를 지우지 않는다. 스펙, 분석, 계획이 이 브랜치에만 있다. `git clean`을 쓰지 않는다(`spikes/`가 추적하지 않는 폴더다).

- **커밋하기 전의 단계**: 그 단계가 고친 추적 파일을 `git restore --staged --worktree -- <경로>`로 되돌리고, 새로 만든 파일은 경로를 하나씩 지정해 지운다. `package.json`을 되돌렸으면 `pnpm install`을 다시 한다.
- **커밋한 뒤**: 문서 커밋(0.2)은 남기고 구현 커밋을 뒤에서부터 `git revert`한다. 6B만 되돌리면 옛 도구와 대조 테스트가 돌아온다. `package.json`이 바뀐 커밋을 되돌렸으면 `pnpm install`을 한다.
- **산출물**: `rm -rf ./packages/core/dist ./packages/cli/dist ./packages/mcp/dist ./packages/web/dist` 뒤 `pnpm build`.
- push한 뒤에는 이력을 고치지 않고 revert 커밋을 올린다(리드가 한다).

## 4. 구현 순서

요청받은 순서를 그대로 쓴다. 바꾼 곳은 없고, 다음 둘만 다르게 읽으면 된다. (1) 단계 2는 파서를 단위 테스트로만 확인하고 AC-06·AC-07은 닫지 않는다. 두 기준이 `loadModel`의 `Issue` 목록 전체와 규칙 `R02`를 요구해서 각각 단계 3, 4에서야 닫힌다. (2) 단계 6은 커밋이 둘(6A, 6B)이고 그 사이에 관문이 있다. FR-13이 순서를 정했고 AC-16이 6A 커밋의 CI 기록을 요구한다.

모든 단계는 5장의 "단계 관문"을 통과하고 커밋 하나로 끝난다(단계 6은 둘). 커밋 메시지는 영어 명령형이다. 이 계획 파일의 체크박스와 7장 기록은 그 단계의 커밋에 넣는다. 테스트를 먼저 쓰는 것이 자연스러운 곳은 그렇게 적었다. 먼저 쓴 테스트는 구현 전에 한 번 돌려 실패하는 것을 본다.

일정의 목표: 첫날 단계 0~3, 둘째 날 단계 4~5, 셋째 날 단계 6.

### 단계 0: 준비

**목표**: `spikes/` 기준선이 있고 문서 세 개가 따로 커밋돼 있다.
**위험**: 낮음 · **상태**: 완료 · **수용 기준**: 없음 (AC-18의 "작업 전" 절반)

- [x] 0.1 **(다른 어떤 명령보다 먼저)** 저장소 루트에서 `spikes/`의 "작업 전" 목록을 찍는다.

  ```bash
  (set -euo pipefail
   mkdir -p docs/handoff
   { find spikes -type f -print0 | sort -z | xargs -0 sha256sum
     find spikes -type l -printf '%p -> %l\n' | sort
   } > docs/handoff/core-model-io-spikes-before.sha256
   test -s docs/handoff/core-model-io-spikes-before.sha256); echo "exit=$?"
  ```

  `exit=0`이 아니면 멈추고 알린다. 이어서 `git check-ignore -q docs/handoff/core-model-io-spikes-before.sha256; echo "exit=$?"`가 `exit=0`인지 본다(무시 대상이 아니면 멈춘다). 이 파일은 6.11까지 고치지도 지우지도 않는다.

- [x] 0.2 `git branch --show-current`가 `feature/core-model-io`인지 확인한다(다르면 멈추고 알린다). 문서 세 개만 커밋한다: `git add docs/specs/core-model-io.md docs/analysis/core-model-io.md docs/plans/core-model-io.md` 뒤 커밋. 해시를 7장에 적는다(그 기록은 단계 1의 커밋에 들어간다). 되돌릴 때 이 커밋은 남긴다.

### 단계 1: 패키지 틀

**목표**: `core`가 프로젝트 둘로 컴파일되고, 테스트 파일이 타입 검사를 받고, 스키마가 코어 안에 들어 있고, 예제·스키마·형식 문서가 쓰기 규칙과 맞는다. 기능 코드는 아직 없다.
**위험**: 중간 · **상태**: 완료 · **수용 기준**: AC-11, AC-12, AC-15 · **요구사항**: FR-01(일부), FR-03, FR-07, FR-12

- [x] 1.1 `packages/core/package.json`을 고친다: `dependencies`에 `ajv`·`yaml`(2장 결정 10의 범위), `exports["./node"]`, 스크립트 `build`·`typecheck`(분석 3.2절의 모양)와 `generate:schemas`(`node scripts/generate-schemas.ts`, 인자 없음). `pnpm install`로 `pnpm-lock.yaml`을 고친다. 루트 devDependencies의 `ajv`·`yaml`은 그대로 둔다. 설치 뒤 `packages/core/node_modules/{ajv,yaml}/package.json`의 `version`이 루트 `node_modules`의 것과 같은지 확인한다. 다르면 같은 버전으로 풀리도록 `core`의 범위를 좁히고 7장에 적는다.
- [x] 1.2 `core`의 TypeScript 프로젝트를 만든다: `packages/core/tsconfig.json`의 `exclude`에 `src/node`, `src/testing` 추가, `packages/core/tsconfig.node.json`, `packages/core/tsconfig.test.json` 새로 만들기(분석 3.2절). `packages/core/src/node/index.ts`를 내용 없이 만든다(둘째 프로젝트에 입력이 있어야 한다. 단계 2에서 채운다).
- [x] 1.3 테스트 타입 검사를 넣는다(FR-12): `packages/cli/tsconfig.test.json`, `packages/mcp/tsconfig.test.json`, `packages/{cli,mcp}/package.json`의 `typecheck`, 루트 `package.json`의 `lint` 끝에 `&& pnpm -r typecheck`.
- [x] 1.4 `format/v0/schema/entity.schema.json`의 속성 `scope`를 FR-07대로 고친다.
- [x] 1.5 **테스트 먼저**: `packages/core/src/schema/schemas.test.ts`에 "스키마 동기화"(AC-12)를 쓴다(무시 대상인 `src/generated/`에는 생성물만 둔다). 원본 폴더의 `*.schema.json` 개수가 8이 아니어도 실패하게 한다. 이 테스트가 생기므로 `packages/core/src/index.test.ts`를 `git rm`한다.
- [x] 1.6 `packages/core/scripts/generate-schemas.ts`를 쓴다. 스키마 폴더(`format/v0/schema`)와 출력 파일(`packages/core/src/generated/schemas.ts`)의 경로는 `import.meta.url`에서 구한다. 인자와 현재 폴더에 기대지 않는다(시제품은 `process.argv`에서 읽으므로 이 부분을 따라 쓰지 않는다). 생성물의 모양은 분석 4.5절이다. `.prettierignore`와 `eslint.config.js`의 무시 목록에 생성물 폴더를 더한다.
- [x] 1.7 예제 세 파일을 FR-07대로 고친다(스펙 2장의 네 군데). 분석의 `corrected/`가 남아 있으면 `diff`로 비교한다. 최종 판정은 단계 5의 AC-01이다.
- [x] 1.8 `docs/format-v0.md`의 "쓰기 규칙"과 "검증 규칙"(규칙 4, 5, 6, 8, 10)을 FR-07대로 고친다. 검사 도구를 가리키는 문장(18행, 121행 근처)은 6B에서 고친다(그때까지 사실이다).
- [x] 1.9 **검증**: 5장의 단계 관문, `pnpm install --frozen-lockfile`, 그리고 다음을 돌린다.
  - 생성 명령이 인자 없이 된다. 생성물을 지우고 워크스페이스 명령으로 다시 만든 뒤 AC-12를 돌린다. 이어서 다른 폴더(저장소 루트)에서 직접 실행해도 결과가 같은지 본다. `exit=0`이어야 한다.

    ```bash
    (set -euo pipefail
     rm ./packages/core/src/generated/schemas.ts
     pnpm --filter @erdmaker/core generate:schemas
     test -s packages/core/src/generated/schemas.ts
     pnpm exec vitest run packages/core/src/schema/schemas.test.ts
     git add packages/core/src/generated/schemas.ts
     node packages/core/scripts/generate-schemas.ts
     git diff --exit-code -- packages/core/src/generated/schemas.ts); echo "exit=$?"
    ```

  - AC-11: 5장의 AC-11 명령.
  - AC-12: `pnpm test`에 "스키마 동기화"가 들어 있고 통과한다(스키마 8개).
  - AC-15: 스펙 6.3의 스크립트.
  - 고친 예제와 스키마가 옛 도구로도 같다: `out=$(pnpm --silent validate:format) && test "$out" = "$want"`(`want`는 스펙 6.2의 줄).
  - 두 프로젝트의 출력이 같은지는 여기서 보지 않는다. `src/node/`가 아직 비어 있어 둘째 프로젝트가 공유 파일을 내보내지 않는다. 2.7에서 본다.
- [x] 1.10 커밋한다. 경로를 지정해 스테이징한다.

### 단계 2: 파일 어댑터와 파서

**목표**: 어댑터 둘이 같은 계약을 지키고, YAML과 배치 JSON 글 하나를 "값, 오류, 위치 색인, 첫 주석"으로 바꿀 수 있다. 모델은 아직 없다.
**위험**: 중간 · **상태**: 완료 · **수용 기준**: AC-09 · **요구사항**: FR-02, FR-05(파일 하나 단위), FR-09(위치 규칙)

- [x] 2.1 `packages/core/src/model/types.ts`에 `Issue`, `Severity`, `Position`, `PositionIndex`를, `packages/core/src/fs/adapter.ts`에 인터페이스와 `FileNotFoundError`를 쓴다. `packages/core/src/fs/path.ts`와 `path.test.ts`(합치기, `a/../b`, 앞의 `..` 유지, `""`).
- [x] 2.2 **테스트 먼저**: `packages/core/src/fs/adapter.test.ts`에 "어댑터 계약"(AC-09의 항목 전부)을 쓰고 두 구현에 돌린다(2장 결정 1). 이어서 `packages/core/src/fs/memory.ts`, `packages/core/src/node/fs.ts`, `packages/core/src/node/index.ts`를 구현한다. Node 쪽은 `mkdtemp`로 만든 폴더를 쓰고 끝나면 그 폴더만 지운다. `node/fs.ts`는 `FileNotFoundError`를 `../fs/adapter.js`에서 가져온다(자기 클래스를 만들지 않는다).
- [x] 2.3 `packages/core/src/validate/json-value.ts`와 `json-value.test.ts`: FR-05와 FR-08이 든 값 종류, 안전한 정수, 공유 참조는 통과하고 순환은 닫히는 자리에서 보고(분석 A10).
- [x] 2.4 `packages/core/src/parse/yaml.ts`와 `yaml.test.ts`: FR-05의 읽기 옵션, `syntax`(문법, 중복 키, 키 충돌, 컬렉션 키), `yaml-feature`(앵커, 별칭, 풀리지 않는 별칭, 태그 종류별), 첫 주석의 위치, JSON Pointer → 위치 색인. 위치는 CST 토큰에서 얻는다(분석 Y11, Y15, Y16). 테스트는 사례마다 `rule`, `line`, `column`, `message`를 단언한다.
- [x] 2.5 `packages/core/src/parse/json.ts`와 `json.test.ts`: FR-09의 위치 순서 세 갈래를 각각 단언하고(분석 4.2절의 표가 입력 예다), 중복 키, 유효한 파일의 위치 색인을 단언한다.
- [x] 2.6 `packages/core/src/index.ts`가 이 단계의 공개 이름을 내보낸다.
- [x] 2.7 **검증**: AC-09("어댑터 계약"이 두 구현 모두에서 통과한다. 테스트 이름에 구현 이름이 보이게 한다)와 아래 둘을 돌리고, 마지막에 5장의 단계 관문을 돌린다(아래 검사가 `dist`를 건드리므로 관문이 뒤다).
  - 두 프로젝트가 공유 파일을 같은 내용으로 내보낸다(스펙 7장). 기본 프로젝트의 출력을 떼어 두고 `dist`에서 지운 뒤 둘째 프로젝트만 돌려 비교한다. 둘째 프로젝트가 그 파일을 내보내지 않으면 `cmp`가 파일 없음으로 실패한다. `exit=0`이어야 한다.

    ```bash
    (set -euo pipefail
     t=$(mktemp -d)
     rm -rf ./packages/core/dist
     pnpm --filter @erdmaker/core exec tsc
     cp packages/core/dist/fs/adapter.js packages/core/dist/fs/adapter.d.ts "$t"/
     rm packages/core/dist/fs/adapter.js packages/core/dist/fs/adapter.d.ts
     pnpm --filter @erdmaker/core exec tsc -p tsconfig.node.json
     cmp "$t/adapter.js" packages/core/dist/fs/adapter.js
     cmp "$t/adapter.d.ts" packages/core/dist/fs/adapter.d.ts); echo "exit=$?"
    ```

  - 빌드한 두 진입점이 `exports`를 거쳐 풀리고 같은 `FileNotFoundError`를 쓴다. `cli` 패키지 자리에서(코어에 의존하는 쪽) 가져온다. `exit=0`이어야 한다.

    ```bash
    pnpm build && pnpm --filter @erdmaker/cli exec node --input-type=module -e "
    import { FileNotFoundError } from '@erdmaker/core';
    import { createNodeFileSystem } from '@erdmaker/core/node';
    const e = await createNodeFileSystem('.')
      .readText('no-such-file.txt')
      .then(() => null, (x) => x);
    process.exit(e instanceof FileNotFoundError ? 0 : 1);"; echo "exit=$?"
    ```

- [x] 2.8 커밋한다.

### 단계 3: 스키마 검사와 모델 읽기

**목표**: `loadModel`이 예제를 모델로 읽고, `validateModel`이 스키마와 JSON 값 오류를 위치와 함께 낸다. 파일 간 규칙은 아직 없다.
**위험**: 중간 · **상태**: 완료 · **수용 기준**: AC-06 · **요구사항**: FR-04, FR-05, FR-08(스키마, 위치, 정렬, `comment`)

- [x] 3.1 `packages/core/src/testing/example.ts`를 쓴다: 디스크의 예제 29개를 `경로 → 글` 맵으로 읽기, "파일 하나에서 문자열 하나를 바꾸기"(바꿀 문자열이 없거나 둘 이상이면 예외. AC-05의 "치환할 문자열이 예제에 없으면 실패"가 여기서 나온다), 맵으로 메모리 어댑터 만들기.
- [x] 3.2 `packages/core/src/schema/ajv.ts`, `packages/core/src/validate/schema.ts`와 `schema.test.ts`: FR-03의 설정, FR-08의 `schema` 메시지와 `path`(모르는 키는 그 키를 가리킨다. 분석 A4).
- [x] 3.3 `packages/core/src/validate/issues.ts`와 `issues.test.ts`: FR-08의 위치 정하기 세 단계와 정렬 순서(위치 없는 것이 먼저).
- [x] 3.4 `packages/core/src/model/types.ts`에 `Model`, `ModelItem`, 데이터 타입을 더한다(손으로 쓴다. 스키마에서 타입을 만드는 도구는 더하지 않는다).
- [x] 3.5 **테스트 먼저**: `packages/core/src/model/load.test.ts`에 "문법과 스키마"(AC-06의 사례 전부)를 쓴다. 사례는 2장 결정 5의 파일에 넣는다. 이어서 `packages/core/src/model/load.ts`(`loadModel`)와 `packages/core/src/validate/index.ts`(`validateModel`: 스키마와 JSON 값 검사, 규칙 자리는 비워 둔다)를 구현한다.
- [x] 3.6 같은 테스트 파일에 읽기 대상의 단언을 더한다: 하위 폴더, 이름순, 모델 밖 사전 폴더, 없는 사전 폴더, 깨진 `model.yaml`로 계속하기, CRLF 파일(FR-05).
- [x] 3.7 `packages/core/src/index.ts`에 `loadModel`, `validateModel`과 타입을 더한다.
- [x] 3.8 **검증**: 5장의 단계 관문. AC-06: "문법과 스키마"가 통과한다.
- [x] 3.9 커밋한다.

### 단계 4: 파일 간 규칙 R01~R12

**목표**: `validateModel`이 부록 A의 모든 줄을 낸다. 깨진 배치가 있어도 나머지 검사가 계속된다.
**위험**: 중간 · **상태**: 완료 · **수용 기준**: AC-05, AC-07 · **요구사항**: FR-08(규칙), FR-09

- [x] 4.1 `packages/core/src/testing/cases.ts`에 부록 A의 사례를 데이터로 쓴다: 이름, 부록 A의 줄 번호, 치환, 기대 `Issue` 목록(일곱 필드 전부), 대조에서 빼는지와 그 이유(FR-13의 목록에 있는 것만). 부록 A 머리말이 요구한 수를 채운다(1번은 종류 일곱, 26번은 메시지 셋, 33번은 둘). 기대값의 `message`와 `path`는 부록 A에서, `line`·`column`은 고친 뒤의 파일에서 정한다. 구현의 출력을 확인 없이 붙여 넣지 않는다.
- [x] 4.2 **테스트 먼저**: `packages/core/src/validate/rules.test.ts`에 "규칙 사례"(AC-05)를 쓴다. 사례마다 테스트 하나, 그리고 묶음 단언 둘: 사례의 `rule`을 모으면 `R01`~`R12`가 모두 있다, 부록 A의 1~38번마다 사례가 하나 이상 있다.
- [x] 4.3 `packages/core/src/validate/rules.ts`에 옛 도구의 파일 간 검사를 옮기고 `validate/index.ts`에 잇는다. 옛 도구와 다르게 하는 곳은 FR-08이 든 넷(부록 A의 18, 25, 26, 38)뿐이다. 규칙은 스키마와 JSON 값 검사를 통과한 항목만 받는다.
- [x] 4.4 같은 테스트 파일에 AC-05의 나머지 단언을 더한다: `R06`의 타입 비교 넷, 메모리에서 고친 모델(`path`는 있고 `line`·`column`은 없다), `attributes: null`, 자기 자신을 가리키는 `ext`, 위치 없는 `Issue`가 앞.
- [x] 4.5 `packages/core/src/model/broken-layout.test.ts`에 "깨진 배치"(AC-07)를 쓴다.
- [x] 4.6 **검증**: 5장의 단계 관문. `git diff --exit-code <단계 3의 커밋> -- packages/core/src/model/load.test.ts`가 종료 코드 0이다(AC-06의 테스트가 규칙이 들어온 뒤에도 그대로 통과한다. 0이 아니면 테스트를 고친 것이므로, 사례를 따라 나오는 오류가 없는 파일로 옮기는 것 말고는 되돌린다).
- [x] 4.7 커밋한다.

### 단계 5: 쓰기

**목표**: 같은 모델은 항상 같은 바이트로 나오고, 예제가 바이트 그대로 왕복하고, `writeModel`이 바뀐 파일만 쓴다.
**위험**: 중간 · **상태**: 대기 · **수용 기준**: AC-01, AC-02, AC-03, AC-04 · **요구사항**: FR-06, FR-07(확인)

- [ ] 5.1 `packages/core/src/schema/resolve.ts`와 `resolve.test.ts`: FR-06의 "값의 스키마 찾기". 단언: 다른 파일의 `$ref`, 공통 스키마 안의 같은 파일 `$ref`, `oneOf`의 객체 갈래, 맵의 값 스키마, `$ref` 대상의 `default`, 키 이름이 `default`인 속성은 기본값이 아니다(분석 4.4절).
- [ ] 5.2 **테스트 먼저**: `packages/core/src/model/serialize.test.ts`에 "쓰기 세부"(AC-03의 단언, 5.3의 것은 빼고)를 쓴다. 이어서 `packages/core/src/model/serialize.ts`(YAML, 스펙 7장의 출력 옵션)와 `packages/core/src/model/layout-json.ts`(배치)를 구현한다. `__proto__` 키와 숫자뿐인 ID를 객체 재조립 없이 다룬다(분석 4.2절).
- [ ] 5.3 **파일의 마지막 값이 줄바꿈으로 끝나는 글일 때** (AC-03의 "마지막 값" 경우). 줄바꿈 둘 이상으로 끝나는 여러 줄 글은 블록 표기 `|+`로 써지는데(분석 Y5), 그 값이 파일의 마지막이면 파일이 LF 둘 이상으로 끝난다. 끝을 LF 하나로 잘라 맞추면 값에서 줄바꿈이 사라진다. 그래서 블록 표기의 끝 줄바꿈 처리가 "파일 끝 줄바꿈 하나"를 깨는 값은 이스케이프한 큰따옴표 글로 쓴다. 파일 글을 뒤에서 자르는 방법은 쓰지 않는다. **테스트 먼저**: `serialize.test.ts`에 마지막 키의 값이 `"a\nb\n\n"`인 항목을 넣어 (1) 써진 글이 LF 하나로 끝나고 그 앞 글자가 LF가 아니며, (2) 그 값의 줄이 기대한 큰따옴표 표기와 글자 그대로 같고, (3) YAML 1.2 core와 1.1로 다시 읽은 값이 원래 글과 같고, (4) 같은 글이 파일의 마지막이 아닐 때는 다시 읽은 값이 같다는 것을 단언한다. 이어서 `serialize.ts`에 구현한다.
- [ ] 5.4 `packages/core/src/model/roundtrip.test.ts`에 "예제 왕복"(AC-01, 디스크의 예제를 Node 어댑터로 읽는다)과 "비정규형 입력"(AC-02)을 쓴다. AC-01이 예제 때문에 실패하면 FR-07의 네 군데 안에서 예제를 고치고(그 밖을 고쳐야 하면 멈추고 알린다), 쓰기 코드에 예제용 예외를 두지 않는다.
- [ ] 5.5 **테스트 먼저**: `packages/core/src/model/write.test.ts`에 "바뀐 파일만 쓰기"(AC-04의 다섯 경우)를 쓰고 `packages/core/src/model/write.ts`를 구현한다. 어댑터의 실제 내용으로 단언한다.
- [ ] 5.6 `packages/core/src/index.ts`에 `serializeModel`, `writeModel`, `SerializedFile`을 더한다.
- [ ] 5.7 **검증**: 5장의 단계 관문. 예제를 고쳤으면 `pnpm validate:format`의 요약 줄이 스펙 6.2의 `want`와 같은지 다시 본다.
- [ ] 5.8 커밋한다.

### 단계 6: 프로젝트, CLI, 대조, 옛 도구 제거

**목표**: `erdmaker validate <dir>`가 되고, 코어가 Node 없이 도는 것과 옛 도구와 결과가 같은 것이 테스트로 확인된 뒤, 옛 도구가 없어진다.
**위험**: 높음 (삭제와 `validate:format` 교체) · **상태**: 대기 · **수용 기준**: 6A는 AC-08, AC-10, AC-13, AC-16 / 6B는 AC-14, AC-17, AC-18, AC-19 · **요구사항**: FR-01(`bin`), FR-10, FR-11, FR-13, FR-14

**커밋 경계**: 6.1~6.5가 커밋 6A, 6.7~6.12가 커밋 6B다. 6A에는 옛 도구, 루트의 `ajv`·`yaml`, `eslint.config.js`의 `tools/**` 블록, 옛 `validate:format`이 그대로 있고 대조 테스트가 그것을 쓴다. 6B는 그것들과 대조 테스트를 한 커밋에서 함께 지운다(하나만 지우면 CI의 `validate:format`이나 `--frozen-lockfile`이 깨진다. 분석 C2).

#### 6A 프로젝트, CLI, 번들, 대조

- [ ] 6.1 **테스트 먼저**: `packages/core/src/project/find.test.ts`에 "모델 찾기"(AC-08, 메모리 어댑터)를 쓰고, `packages/core/src/project/find.ts`(`findModels`)와 `packages/core/src/project/validate.ts`(`validateProject`)를 구현한다. `P01`과 `P02`에 디스크 위치를 준다(FR-10): `file`은 해당 모델의 `model.yaml`이고, `line`·`column`은 FR-08의 순서로 정한다(`P01`은 그 파일의 위치 색인에서 `/id`, `P02`는 `path`가 `""`라 1:1). 테스트는 두 오류의 `file`, `path`, `line`, `column`을 단언한다. `packages/core/src/index.ts`에 더한다.
- [ ] 6.2 CLI를 만든다: `packages/cli/package.json`의 `bin`(FR-01의 문자열 그대로), `packages/cli/src/main.ts`, `packages/cli/src/bin.ts`. 프로젝트 오류는 다른 오류와 같은 줄 모양으로 내고, `file`로 해당 모델과 이어 그 모델의 `OK` 줄을 내지 않는다(FR-11). **테스트 먼저**: `packages/cli/src/validate.test.ts`에 다음 둘을 쓴다. 실행할 파일의 경로는 `package.json`의 `bin.erdmaker`에서 읽는다. 사례 폴더는 `mkdtemp`로 만들고 끝나면 그 폴더만 지운다.
  - "validate"(AC-13의 경우 전부).
  - 프로젝트 오류(AC-13의 프로젝트 경우): 임시 폴더에 예제 사본으로 프로젝트를 만든다. 모델 셋 중 둘은 `id`가 같고, 하나는 안에 `model.yaml`이 하나 더 있다. 빌드한 CLI를 실행해 종료 코드가 1이고, stderr에 `P01`과 `P02`가 각각 `<해당 model.yaml>:<line>:<column>: … [P01]`·`[P02]` 줄로 정확한 위치와 함께 있고, stdout에 `P01`을 받은 모델과 안쪽 `model.yaml`을 가진 모델의 `OK` 줄이 없으며, 오류가 없는 모델(`id`가 같은 둘 중 앞의 것)의 `OK` 줄은 있음을 단언한다.
- [ ] 6.3 `packages/cli/src/bundle.test.ts`에 "브라우저 번들"(AC-10, 스펙 6.1의 세 단계)을 쓴다. 같은 파일에서 차단 플러그인이 일하는 것도 단언한다: `node:fs`를 가져오는 한 줄짜리 진입점(임시 폴더에 쓴다)의 빌드가 거부된다. 테스트별 타임아웃을 준다.
- [ ] 6.4 `packages/core/src/parity.test.ts`에 대조 테스트(FR-13의 1단계)를 쓴다. 대상은 예제, `testing/cases.ts`에서 대조 표시가 켜진 사례 전부, 모델 밖 사전을 가진 프로젝트 모양 하나, YAML 문법 오류 사례 하나(따라 나오는 오류까지 같아야 한다. 분석 4.9절)다. 비교하는 것은 FR-13이 적은 둘(종료 코드, 줄의 다중집합)이다. 묶음 단언: 부록 A의 1~37번마다 대조한 사례가 하나 이상 있다, 대조에서 뺀 사례는 모두 이유가 적혀 있다. 사례마다 테스트를 나누고 타임아웃을 준다(옛 도구 한 번에 약 0.2초).
- [ ] 6.5 **검증**: 5장의 단계 관문. `node packages/cli/dist/bin.js validate format/v0/examples/shop`의 stdout이 옛 `pnpm --silent validate:format`의 것과 같다. 커밋한다(6A). 해시를 7장에 적는다.
- [ ] 6.6 **관문 (여기서 멈춘다)**: 리드에게 6A의 해시를 넘긴다. 리드는 사용자 승인 뒤 6A를 머리로 push하고 PR을 열어 CI를 돌린다. AC-16의 판정: `gh run list --commit <6A 해시> --json conclusion --jq '.[].conclusion'`의 출력이 `success` 한 줄 이상이고 다른 값이 없다. 출력이 비었거나(실행이 없다) 다른 값이 있으면 닫지 않는다. 실패면 6A를 고친 새 커밋으로 다시 판정받고, 그 해시를 쓴다. 닫히기 전에는 6.7로 가지 않는다.

#### 6B 옛 도구 제거와 문서

- [ ] 6.7 한꺼번에 바꾼다: `git rm tools/validate-format.mjs packages/core/src/parity.test.ts`, 루트 `package.json`의 `validate:format`을 스펙 4장의 값으로 교체하고 devDependencies에서 `ajv`·`yaml` 제거, `pnpm install`로 `pnpm-lock.yaml` 갱신, `eslint.config.js`의 `tools/**` 블록 제거. `testing/cases.ts`의 대조 표시는 지워도 되고 남겨도 된다(기대 `message`가 옛 문구를 계속 고정한다).
- [ ] 6.8 문서를 고친다(FR-14): `CLAUDE.md`의 "지금 상태"와 "명령" 절(`validate:format`과 `pnpm test`의 일부, `pnpm lint`의 타입 검사가 `pnpm build` 뒤에 된다는 것, `pnpm lint`에 테스트 타입 검사가 들어간 것), `docs/format-v0.md`와 `docs/planning.md`의 옛 도구 문장, `docs/stage1-backlog.md`의 세 줄(2장 결정 9: 92행의 파일 목록에서 옛 경로를 `packages/core`로 바꾸고, 103행과 108행은 경로 대신 "옛 검사 도구"로 적는다. 뜻은 바꾸지 않는다). `CLAUDE.md`는 `pnpm exec prettier --write CLAUDE.md`로 서식을 맞춘다(`docs/`는 서식 대상이 아니다).
- [ ] 6.9 남은 참조가 없는지 본다. 종료 코드 1(일치 없음, 오류 없음)이어야 통과다.

  ```bash
  grep -n 'validate-format' package.json eslint.config.js CLAUDE.md \
    docs/format-v0.md docs/planning.md docs/stage1-backlog.md; test $? -eq 1; echo "exit=$?"
  ```

- [ ] 6.10 **검증**: `pnpm install --frozen-lockfile`, 5장의 단계 관문(이제 `validate:format`은 새 CLI다), AC-14(스펙 6.2의 스크립트 전체), AC-17(스펙 6.4의 스크립트와 `docs/specs/repo-scaffold.md` 6.4의 라이선스 스크립트), AC-19의 로컬 절반(`pnpm build && pnpm test && pnpm lint`).
- [ ] 6.11 **AC-18**: "작업 후" 목록을 0.1과 같은 두 `find`로 만들어 기준선과 비교한다. `exit=0`이고 출력이 없어야 한다. 아니면 커밋하지 않고 멈춰 알린다.

  ```bash
  (set -euo pipefail
   test -s docs/handoff/core-model-io-spikes-before.sha256
   { find spikes -type f -print0 | sort -z | xargs -0 sha256sum
     find spikes -type l -printf '%p -> %l\n' | sort
   } | diff docs/handoff/core-model-io-spikes-before.sha256 -); echo "exit=$?"
  ```

- [ ] 6.12 커밋한다(6B). 커밋 뒤 `git status --porcelain --untracked-files=no`의 출력이 비어야 한다. 리드에게 넘긴다: 6B의 push, PR 설명에 6A의 해시 적기(AC-16), `gh pr checks`(AC-19의 나머지)는 사용자 승인 뒤 리드가 한다.

## 5. 품질 관문

모두 저장소 루트에서 실행한다.

### 단계 관문 (모든 단계의 "검증"에서)

```bash
rm -rf ./packages/core/dist ./packages/cli/dist ./packages/mcp/dist ./packages/web/dist &&
pnpm build && pnpm test && pnpm lint && pnpm validate:format &&
out=$(find packages/core/dist packages/cli/dist packages/mcp/dist \
  \( -name '*.test.*' -o -path '*/testing/*' \)) && test -z "$out"; echo "exit=$?"
```

- `exit=0`이어야 한다. 순서를 바꾸지 않는다. `test`의 일부(6A부터), `lint`의 타입 검사, 새 `validate:format`이 `dist`를 읽는다.
- `dist`를 지우고 시작하므로 지난 빌드의 파일이 결과를 가리지 않는다. 지우는 경로는 이 넷뿐이다.
- 마지막 줄은 테스트와 테스트 도우미가 `dist`에 없음을 본다(스펙 7장).
- `package.json`을 고친 단계(1, 6B)는 `pnpm install --frozen-lockfile`도 통과해야 한다.

### AC별 확인

- [x] AC-11 (단계 1). 설정을 읽지 못하면 `JSON.parse`가 던져 실패한다.

  ```bash
  pnpm --filter @erdmaker/core exec tsc --showConfig | node -e "
  const c = JSON.parse(require('node:fs').readFileSync(0, 'utf8')).compilerOptions;
  process.exit(JSON.stringify(c.lib) === '[\"es2022\"]' && JSON.stringify(c.types) === '[]' ? 0 : 1)"; echo "exit=$?"
  ```

- [ ] AC-12, AC-09, AC-06, AC-05, AC-07, AC-01~04, AC-08, AC-13, AC-10: 스펙 6장이 이름 붙인 테스트가 `pnpm test`에 있고 통과한다. 테스트의 `describe`나 `test` 이름에 스펙의 이름("예제 왕복" 등)을 그대로 쓴다. 닫을 때 `pnpm exec vitest run -t '<이름>'`의 출력에서 통과한 테스트가 1개 이상인지 본다(이름이 틀려 0개가 돈 것을 통과로 치지 않는다).
- [x] AC-15 (단계 1): 스펙 6.3.
- [ ] AC-16 (6A 뒤, 리드): 6.6의 판정.
- [ ] AC-14, AC-17 (6B): 스펙 6.2, 6.4.
- [ ] AC-18 (6B): 6.11.
- [ ] AC-19 (6B와 PR 뒤): 로컬 세 명령, 리드의 `gh pr checks`.

스펙 6장의 스크립트는 구현 전에 쓴 것이다. 틀리면 같은 조건을 검사하도록 고치고 7장에 적는다. 조건을 낮추지 않는다.

## 6. 위험과 참고

### 위험

| 위험                                                                                      | 가능성 | 대응                                                                                                              |
| ----------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| `yaml`의 출력이 버전에 따라 달라진다 (스펙 7장)                                           | 낮음   | 1.1에서 버전을 확인한다. AC-01과 AC-03이 잡는다                                                                   |
| 손으로 고친 예제가 쓰기 규칙과 다르다 (단계 1과 5 사이)                                   | 중간   | 1.7에서 `corrected/`와 비교하고 5.4에서 AC-01로 판정한다. 고칠 범위는 FR-07의 네 군데다                           |
| 블록 표기의 끝 줄바꿈이 "파일 끝 줄바꿈 하나"와 부딪친다                                  | 중간   | 5.3. 큰따옴표 표기로 바꾸는 조건은 테스트가 고정한다                                                              |
| 문법 오류의 줄·열이 엔진 메시지의 형식에 기댄다 (AC-07의 2:1)                             | 낮음   | 로컬과 CI가 모두 Node 22다. 메시지에 위치가 없을 때의 두 갈래를 2.5가 따로 단언한다                               |
| `core`의 두 번 컴파일이 공유 파일을 다르게 내보내거나, 두 진입점이 다른 클래스를 쓴다 (스펙 7장) | 낮음 | 2.7의 `cmp`와 가져오기 검사                                                                                  |
| 부록 A 사례의 기대값(약 50개, 줄·열 포함)을 쓰는 데 시간이 든다                           | 중간   | 단계 4에 반나절을 잡는다. 기대값을 줄이지 않는다. 사흘을 넘길 것 같으면 범위를 줄이지 말고 알린다                 |
| 대조 테스트가 옛 출력의 코드 프레임 줄을 오류로 오인한다 (분석 4.9절)                     | 중간   | 6.4의 줄 고르기 규칙. YAML 문법 오류 사례를 대조에 넣어 확인한다                                                  |
| 대조 테스트가 느려 타임아웃이 난다                                                        | 중간   | 사례마다 테스트를 나누고 타임아웃을 준다                                                                          |
| 6A와 6B를 함께 올려 AC-16의 CI 기록이 없다                                                | 중간   | 6.6에서 멈춘다                                                                                                    |
| 빌드 없이 `pnpm lint`나 `pnpm test`를 돌려 `TS2307`이나 파일 없음으로 실패한다 (분석 C5)  | 중간   | 관문의 순서를 지킨다. 6.8에서 `CLAUDE.md`에 적는다. 빌드가 없을 때 건너뛰는 분기를 테스트에 넣지 않는다(실패가 맞다) |
| 분석이 실행해 보지 않은 것: `mcp`의 `typecheck`(입력이 빈 파일 하나), Vite의 `publicDir: false`, 스펙 6장의 스크립트 | 중간 | 1.9, 6.3, 6.10에서 실행으로 확인한다. 다르면 같은 조건을 지키게 고치고 7장에 적는다       |
| Ajv가 `new Function`을 쓴다 (스펙 7장)                                                    | 해당 없음 | 이 기능은 CSP가 없는 환경(AC-10)까지만 본다. F09에서 정한다                                                    |
| 임시 폴더를 지우는 코드가 다른 경로에 닿는다                                              | 낮음   | 테스트는 `mkdtemp`가 돌려준 경로만 지운다. 저장소 안에 임시 폴더를 만들지 않는다                                  |

### 알려진 한계 (이 기능에서 고치지 않는다)

스펙 8장 그대로다: 조용히 넘어가는 경우 셋, 엔진이 위치를 주지 않는 깨진 JSON의 1:1, 주석 유실(경고만), `ext` 안 숫자뿐인 키의 순서.

### 구현할 때 참고

- 피할 것(분석 7장): `JSON.stringify(v, null, 2)`로 배치 쓰기, 정렬한 새 객체로 키 순서 만들기, Ajv의 기본 내보내기, 차단 플러그인 없는 번들 테스트, 코어 안의 `structuredClone`·`console`, `properties` 아래를 키워드로 훑는 스키마 탐색.
- `core`·`cli`·`mcp`는 NodeNext라 상대 경로 가져오기에 `.js` 확장자를 쓴다.
- 생성물을 다시 만드는 자동 단계는 없다. 스키마를 고치면 `pnpm --filter @erdmaker/core generate:schemas`를 돌린다. 잊으면 AC-12가 실패한다.
- 테스트 도우미를 `src/testing/` 밖에 `*.test.ts`가 아닌 이름으로 두면 `dist`에 들어가고 관문의 마지막 줄이 놓친다. 도우미는 `src/testing/`에만 둔다.
- `vm` 컨텍스트의 결과는 다른 realm의 객체다. 번들 테스트는 컨텍스트 안에서 `JSON.stringify`해 꺼낸다(분석 4.6절).
- `syntax` 메시지 첫 줄에 `at line N, column M:`이 이미 들어 있다. 옛 문구를 지키려고 그대로 둔다(분석 S7).

## 7. 구현 기록

(구현하면서 적는다: 문서 커밋 해시(0.2), 풀린 `ajv`·`yaml` 버전(1.1), 고친 검사 스크립트, 6A의 해시와 AC-16의 판정, 계획과 달라진 점. 이 절의 변경은 각 단계의 커밋에 넣는다)

### 단계 0 (2026-11-27)

- 0.1: `spikes/` 기준선 `docs/handoff/core-model-io-spikes-before.sha256`(866줄). 명령 `exit=0`, `git check-ignore` `exit=0`. 이 단계의 첫 명령으로 실행했다.
- 0.2: 브랜치 `feature/core-model-io` 확인. 문서 커밋 `e1851c84e64c44b5711bdda8dc8f7c3afdb532f9`. 그 커밋의 계획에는 0.1의 체크만 들어 있다.

### 단계 1 (2026-11-27)

- 1.1: 풀린 버전은 `core`와 루트가 같다. `ajv` 8.20.0, `yaml` 2.9.1. 범위를 좁히지 않았다.
- 1.4: 속성 `scope`의 설명은 공통 정의의 설명 뒤에 `Absent: inherits the scope of the entity.`를 붙였다. 열거값은 공통 정의와 같은 셋이고 `default`만 없다. 키(`keys`)의 `scope`는 FR-07의 대상이 아니라 그대로 공통 정의를 참조한다.
- 1.5: 테스트 이름은 `describe('스키마 동기화')` 아래 10개(개수 8, 이름 집합, 파일별 8개).
- 1.7: 고친 세 파일이 분석의 `corrected/`와 `diff`로 같다.
- 1.8: 쓰기 규칙에 `properties`가 없는 맵의 순서와 큰따옴표의 대상(불리언·null·숫자로 읽히는 글)도 적었다(FR-06의 문장). 검사 도구를 가리키는 121행은 6B까지 그대로다.
- 1.9: 계획과 스펙의 검사 명령을 고치지 않고 그대로 돌렸다. 모두 `exit=0`: 단계 관문, `pnpm install --frozen-lockfile`, 생성 명령 검사, AC-11, `vitest run -t '스키마 동기화'`(10개 통과), AC-15(세 패키지 모두 `pnpm lint`가 종료 2로 실패하고 `zz-probe.test.ts(1,14): error TS2322`가 나온 뒤, 탐침을 지운 `pnpm lint`가 성공), 옛 도구의 요약 줄(`pnpm --silent`, `npm run --silent` 둘 다 `want`와 같다).
- 계획과 달라진 점: 없다. 5장 AC 확인의 AC-12 줄은 다른 AC와 묶여 있어 체크하지 않았다(AC-12 자체는 위 1.9에서 닫혔다).

### 단계 2 (2026-11-27)

- 2.1: `Issue.rule`은 스펙 FR-08의 값 열여덟 개의 리터럴 합집합이다(따로 이름을 내보내지 않는다). `line`·`column`은 선택 필드다(FR-08: 위치를 못 구하면 뺀다). `PositionIndex`는 `ReadonlyMap<string, Position>`이다.
- 2.2: 계약 묶음은 `adapter.test.ts`의 함수 하나이고 `describe('어댑터 계약: memory')`, `describe('어댑터 계약: node')`로 두 번 돈다(각 18개). Node 쪽은 `mkdtemp`로 만든 폴더 하나 아래에 사례마다 `<n>/root`를 열고 `afterAll`에서 그 폴더만 지운다. AC-09의 항목 밖에 더 단언한 것: 줄바꿈·비ASCII를 바꾸지 않고 쓰기, 덮어쓰기, `list('')`, 파일 경로의 `list`는 빈 목록, 경로 정규화, 폴더 위에 쓰기·파일을 거쳐 쓰기·폴더 `remove`는 거부되고 내용이 그대로다. Node 구현의 `list`도 `ENOENT`·`ENOTDIR`을 "폴더 없음"으로 보고 빈 목록을 돌려준다(스펙은 `readText`의 `ENOTDIR`만 적었다).
- 2.3: `jsonValueIssues(file, value)`가 `schema` 오류 `<path 또는 "/"> must be a JSON value`를 낸다. 스펙 FR-08대로 `undefined`도 JSON 값이 아니다(분석 S5의 "없는 키로 본다"는 따르지 않았다). 배열의 빈 자리와 접근자 속성(부르지 않는다)도 JSON 값이 아니다. 검사 중에 던지는 객체(트랩이 던지는 Proxy)는 그 자리를 보고하고 계속한다.
- 2.4: `parseYaml(file, text)` → `{ value, issues, positions, firstComment? }`. `value`와 `positions`는 `issues`가 없을 때만 채운다. 파서 오류가 있으면 `yaml-feature`와 키 검사는 하지 않는다(옛 도구와 같다). `syntax`·`yaml-feature`는 파서나 CST 토큰의 위치를 바로 넣고, 파서 위치가 없으면 1:1이다(FR-08 (1), (3)). 위치 색인에 `""`(파일 전체)는 넣지 않는다(FR-08 (3)이 1:1로 정한다). 컬렉션 맵 키의 메시지는 스펙에 없어 `Map keys must be scalars`로 정했다. 흐름 배열 안의 쌍(`[a: 1]`)은 `yaml`이 한 키짜리 맵으로 만들어 따로 다루지 않는다(시험으로 확인).
- 2.5: `parseJson(file, text)`는 같은 모양을 돌려준다. 엔진 메시지가 원문을 따옴표로 인용하며 줄바꿈을 품을 때가 있어(`Unexpected token '}', "{⏎  "a": ⏎}⏎" is not valid JSON`) 줄바꿈을 `\n`, `\r` 글자로 바꿔 한 줄로 둔다(FR-08 "영어 한 줄"; 스펙은 YAML의 "첫 줄"만 정했다). 세 갈래의 입력: 엔진 위치 `{"formatVersion": "0.1", "nodes": {`→2:1, YAML 위치 `{⏎  "a": @x⏎}`→2:8, 둘 다 없음 `{⏎  "a": ⏎}`·빈 파일·BOM→1:1. `JSON.parse`가 성공한 뒤 YAML의 `DUPLICATE_KEY`만 `syntax`로 내고, 다른 YAML 오류가 있으면 위치 색인 없이 받아들인다(그런 입력은 찾지 못했다).
- 2.6: 공개 이름 `FileNotFoundError`, `createMemoryFileSystem`, 타입 `FileSystemAdapter`, `FileEntry`, `Issue`, `Severity`, `Position`, `PositionIndex`. `@erdmaker/core/node`는 `createNodeFileSystem`만 낸다.
- 2.7: 모두 `exit=0`: `cmp` 검사, `exports` 가져오기 검사, 단계 관문, `npm run validate:format`(요약 줄이 스펙 6.2의 `want`와 같다). AC-09: `vitest run -t '어댑터 계약'`에서 36개 통과(구현마다 18개). 새 테스트는 구현을 하나씩 일부러 깨뜨려 실패하는 것을 봤다(경로, 어댑터, JSON 값, YAML, JSON 각각).
- 검사 명령: 고치지 않았다. 다만 `cmp` 검사의 `mktemp -d`는 `TMPDIR`이 없으면 `/tmp`에 폴더를 남긴다. 처음 실행이 남긴 폴더는 파일 둘과 폴더를 경로로 지웠고, 이후에는 `TMPDIR`을 세션 작업 폴더로 두고 같은 명령을 돌렸다(조건은 같다).
- 계획과 달라진 점: (1) 모듈 표에 없는 `parse/pointer.ts`(JSON Pointer 토큰 이스케이프)를 더했다. `parse`와 `validate/json-value.ts`가 함께 쓰고, `parse`가 `validate`를 가져오면 의존 방향이 거꾸로 되기 때문이다. (2) `parse/yaml.ts`가 `parse/json.ts`를 위해 `readYamlDocument`, `yamlErrorIssues`, `positionIndex`, 타입 `ParsedText`를 내보낸다(코어 안에서만 쓴다). (3) `json-value.test.ts`의 `9007199254740993`은 `no-loss-of-precision` 때문에 `Number('9007199254740993')`로 적었다(값은 YAML이 읽은 것과 같은 `2 ** 53`).
- 리뷰 수정 (2026-11-27): (1) `jsonValueIssues`는 재귀 대신 명시적 스택으로 걷는다(자식을 다 본 노드를 꺼낼 때 조상 집합에서 지워 순환 판정은 그대로). 10000단 중첩 배열·객체에서 예외가 없다. `Array.prototype`이 바로 위가 아닌 배열(하위 클래스 인스턴스)은 클래스 인스턴스로 본다. 배열은 모든 색인 대신 자기 키(`getOwnPropertyNames`, 열거 불가 색인 포함)만 돌고, 빈 자리는 배열마다 첫 빈 자리 하나로 낸다(색인 순서 안에서). (2) `parseYaml`은 CST 훑기를 반복문으로 바꾸고 파서 오류 검사 뒤로 옮겼다. 그래서 파서 오류가 있는 파일에는 `firstComment`가 없다(주석 경고는 모델에 들어간 파일에만 내므로 결과는 같다). 키 검사와 위치 색인도 `yaml`의 `visit`·재귀 대신 같은 순서의 명시적 스택으로 걷는다. (3) 계획과 달라진 점: `yaml` 합성기는 단마다 재귀해 깊은 입력에서 스스로 스택 넘침을 오류로 내는데, Node 22.23에서는 그런 입력을 한 프로세스에서 두 번 읽으면 정규식 컴파일 중 V8 치명 오류(`RegExpCompiler Allocation failed`)로 프로세스가 죽는다(`yaml`만으로 재현). 그래서 `readYamlDocument`가 CST의 컬렉션 중첩을 먼저 재고 `MAX_NESTING`(256)단을 넘으면 합성하지 않고 `syntax` 오류 `Collections are nested more than 256 levels deep at line L, column C:`(넘는 첫 컬렉션의 자리)를 낸다. 257~약 780단의 YAML은 전에는 읽혔고 이제 거부된다. (4) `parseJson`: 엔진 위치는 메시지 끝의 ` at position N (line L column C)`만 받는다(`[(line 9 column 9)]`→1:1). YAML 리더가 합성하지 못한 유효 JSON(너무 깊음)은 재귀 없는 한 번 훑기로 중복 키를 찾아 YAML 리더와 같은 문구·자리로 낸다(전에는 약 780단을 넘으면 중복 키를 놓쳤다). 위치 색인은 없다. (5) BOM이 있으면 1행의 열에서 1을 뺀다(이슈 위치, 위치 색인, 첫 주석, 파서 메시지 끝의 `at line 1, column N:`). (6) 이슈를 직접 만들던 두 곳(`json.ts`, `featureIssues`)이 `fileIssue(rule, file, message, at)` 하나를 쓴다.
- 리뷰 수정 2차 (2026-11-27): (1) `yaml`의 `uniqueKeys: true`는 키마다 같은 맵의 앞 키를 모두 비교해 키 수의 제곱 시간이 들었다(키 20000개 3.5초, 50000개 15~24초). 옵션을 끄고 키 검사(`scanKeys`, 충돌 검사와 같은 한 번 훑기)가 `Set`으로 정확한 중복(스칼라 값이 `===`로 같음, NaN은 무엇과도 다름)을 찾는다. 중복이 있는 글만 `uniqueKeys` 함수로 한 번 더 합성한다. 함수가 첫 비교에서 참을 돌려 키마다 한 번만 불리고, 합성기가 맵의 둘째 키부터 자기 순서·자리로 낸 오류 가운데 정확한 중복이 아닌 것을 버린다. 그래서 문구 `Map keys must be unique at line L, column C:`, 자리(뒤 키, 빈 키는 합성기의 자리), 다른 파서 오류와의 순서, 태그·앵커 검사 전의 조기 반환이 전과 같다. 키 50000개: YAML 약 1.0초, JSON 약 0.8초(전 24초, 15초). (2) `parseJson`은 YAML 리더와 같은 중첩 한도를 쓴다: `MAX_NESTING`을 넘는 유효 JSON은 YAML과 같은 문구·자리의 `syntax` 오류 하나이고 값이 없다(전에는 위치 색인 없이 값을 돌려줬다). 유효 JSON의 중복 키는 늘 한 번 훑기로 찾고, 값 안의 중복 뒤에 그 키를 내 합성기 순서와 같다. 엔진 위치가 없는 깨진 JSON의 위치는 중복을 포함한 YAML 첫 오류 그대로다. 1024자 넘는 키는 `yaml` 2.9.1의 흐름 맵에서 오류가 아니어서 위치 색인이 그대로 나온다. 유효 JSON인데 YAML이 오류를 내는 경우는 퍼즈 3만 건에서 탭 뒤 최상위 스칼라뿐이었고, 위치 색인이 원래 비므로 그대로 빈 색인이다. 옛 빌드와 새 빌드를 무작위 YAML·JSON 6만 건에 비교해 의도한 깊이 변경 외에는 차이가 없다.
- 리뷰 수정 3차 (2026-11-27, 마지막 리뷰 뒤에 고쳤고 리뷰받지 않았다): (1) `parserErrors`의 두 번째 합성에 `prettyErrors: false`를 넣었다. 없으면 `yaml`이 자기 줄 세기로 맵의 둘째 키부터 오류마다 그 줄 전체를 복사·검사해, 키가 한 줄에 있으면 제곱 시간이었다(한 줄 흐름 맵 키 40000개와 중복 하나 약 25초). 이슈는 이 모듈이 자리로 만들므로 문구·자리·순서가 같다(중복 입력 32개의 이슈가 고치기 전과 같다). 정확한 중복 수(`scanKeys`)와 다시 읽어 남긴 중복 오류 수가 다르면 `uniqueKeys: true`로 한 번 읽은 결과를 쓴다(`yaml`이 비교 함수를 부르는 방식이 바뀔 때의 대비; 라이브러리를 고치지 않고는 시험할 수 없어 시험은 없다). (2) 키 50000개의 2초 시간 테스트 둘을 비율 테스트 넷으로 바꿨다: 키 10000개와 40000개를 세 번씩 읽어 가장 빠른 시간의 비가 8 미만, 40000개가 10초 미만. YAML 블록 맵(고유 키), 압축 JSON(고유 키), 중복 하나인 한 줄 YAML 흐름 맵, 엔진 위치 없이 잘린 중복 있는 압축 JSON. 뒤의 둘은 (1) 전에 비 15.2, 15.5로 실패하고 뒤에 약 4로 통과한다.

### 단계 3 (2026-11-27)

- 3.1: `testing/example.ts`는 `exampleFiles()`(디스크의 29개, 경로순), `replaceOnce(files, file, search, replacement)`(새 맵을 돌려준다. 파일이 없거나 문자열이 없거나 둘 이상이면, 겹치는 경우도 포함해 던진다), `exampleFileSystem(files?)`. 도우미 자체의 테스트 `testing/example.test.ts`를 더했다(폴더가 빌드에서 빠지므로 `dist`에 들어가지 않는다).
- 3.2: `schema/ajv.ts`의 `schemaValidator(name)`. Ajv 설정은 FR-03 그대로이고 테스트가 `opts`로 확인한다. Ajv에 넣는 스키마는 원본의 복사본이며 두 가지를 바꾼다(검사 결과는 같고 시간만 다르다). (1) **`$ref`를 대상의 복사본으로 바꾼다.** Ajv는 참조한 스키마를 함수로 부르고 실패할 때마다 지금까지의 오류 배열을 `concat`으로 복사해, 오류 있는 항목 수의 제곱 시간이 들었다(속성 4만 개에 모르는 키 하나씩: 2.1초, 1만 개의 47배). 형식 스키마에 재귀 `$ref`는 없다(있으면 던진다). `$ref` 옆 키워드는 지금 `description`뿐이고, 다른 키워드가 생기면 `allOf`로 함께 둔다. (2) **`uniqueItems`**: `items`가 스칼라 `type`을 적지 않은 곳(주제영역 `entities`, 키 `attributes`)에서 Ajv는 모든 쌍을 비교한다(4만 개 4.7초). 그 자리만 같은 문구·같은 쌍(`i`는 앞 항목과 같은 마지막 항목, `j`는 그 앞의 가장 가까운 같은 항목)을 내는 키워드 `erdmakerUniqueItems`로 바꾸고, 항목마다 정규화한 JSON 글(키 정렬, 명시적 스택)로 한 번에 찾는다. 오류를 목록에 붙이도록 Ajv의 코드 생성 키워드(`CodeKeywordDefinition`, `gen.scopeValue`)로 만들었다(함수 키워드는 다시 `concat`이다). `items`가 스칼라 타입인 곳(`synonyms` 등)은 Ajv가 이미 해시로 하므로 그대로 둔다. Ajv의 문구와 쌍 고르기는 문서에 없는 동작이라, 원본 스키마의 Ajv(옛 도구와 같은 설정)와 메시지 목록을 비교하는 테스트 셋을 두었다: 정한 사례 6개, 무작위 배열 3000개, 예제 29개 파일마다 무작위로 고친 데이터 300개. Ajv가 바뀌면 이 테스트가 실패한다. `validate/schema.ts`: `schemaIssues`(FR-08의 문구와 `path`, 모르는 키는 `params.additionalProperty`를 이스케이프해 붙인다)와 `itemIssues`(JSON 값 검사 뒤 스키마 검사).
- 3.3: `validate/issues.ts`의 `placeIssue`, `compareIssues`, `finishIssues`(위치를 채우고 정렬한 새 배열). 위치의 (3) "`path`가 `""`이면 1:1"은 그 파일의 색인이 있을 때만이다. 색인이 없는 파일(메모리에서 만든 모델)은 `""`도 위치를 뺀다(AC-05의 "메모리에서 고친 모델은 `line`·`column`이 없다"). `line`과 `column` 중 하나만 있는 `Issue`는 위치가 없는 것으로 보고 다시 정한다.
- 3.4: 데이터 타입은 스키마를 손으로 옮겼다. 스펙 밖의 공개 타입 이름(계획 모듈 표의 "데이터 타입"): `AttributeData`, `KeyData`, `DataType`, `DefaultValue`, `ValidValue`, `PhysicalTypes`, `Scope`, `NameSource`, `ReferentialAction`, `Side`, `Ext`, `JsonValue`. `Model`은 `{ dir, manifest?, entities, relationships, subtypes, subjectAreas, layouts, dictionaries }`이고 항목의 `file`은 연 폴더 기준 경로다(`Issue.file`과 같다). `model.yaml`이 모델에 못 들어가면 `manifest` 키 자체가 없다.
- 3.5: `loadModel(fs, modelDir)` → `{ model, issues, positions }`. `positions`는 `ReadonlyMap<file, PositionIndex>`이고 모델에 들어간 파일만 담는다. 읽는 순서는 옛 도구와 같다(`model.yaml`, 사전, 엔터티, 관계, 서브타입, 주제영역, 배치). 파일은 하나씩 차례로 읽는다(동시에 열지 않는다). 모델에 못 들어간 파일의 `schema` 오류는 그 파일의 색인으로 위치를 받는다. `comment` 경고의 문구는 스펙이 정하지 않아 `YAML comments are not kept when erdmaker rewrites this file`로 정했다(`COMMENT_MESSAGE`). `validateModel(model, positions?)`은 모든 항목에 `itemIssues`를 하고 위치·정렬을 한다. 규칙은 단계 4에서 여기에 잇는다. AC-06 테스트는 `loadModel`의 `issues`와 `validateModel`의 결과를 합쳐 정렬한 목록 전체를 비교한다(`validateProject`가 모델마다 낼 목록). 기대값은 고친 `party.yaml`의 줄·열을 손으로 세어 먼저 적었고, 구현 뒤 처음 실행에 그대로 통과했다. `validate/index.test.ts`를 더했다: 메모리 모델(위치 없음, 목록 일곱 모두 검사), 위치 색인이 있을 때의 위치, JSON 값이 아닌 것(순환, `Date`, `undefined`, 함수), 10만 단 중첩 데이터, 모델 불변, 시간 비율 둘(엔터티 2500/1만 개, 한 엔터티의 속성 1만/4만 개, 모두 오류가 있는 데이터. (1) 전에는 이 테스트가 비 34로 실패했다).
- 3.6: 읽기 대상 테스트 8개: 하위 폴더와 이름순(목록을 거꾸로 주는 어댑터로 읽는 쪽이 정렬하는 것을 본다. `Zeta.yaml`이 `address.yaml` 앞, 폴더 `b/`가 `b.yaml` 앞, `.yml`·`.txt`와 `layouts/` 안의 `.yaml`은 읽지 않는다), 하위 폴더의 모델(경로가 연 폴더 기준), 29개 파일 모두와 위치 색인, 모델 밖 사전(`../shared`), 없는 사전 폴더, 깨진 `model.yaml`(매니페스트 없음, 기본 `dictionary` 폴더), CRLF, 어댑터 실패의 전달.
- 3.8: 단계 관문 `exit=0`(테스트 11개 파일 257개). `vitest run -t '문법과 스키마'`: 16개 통과, `exit=0`. `npm run --silent validate:format`도 `want`와 같다. 새 테스트는 구현을 한 군데씩 일부러 깨뜨려 실패하는 것을 봤다(예제 도우미, `schemaIssues`, `ajv.ts`의 `$ref` 인라인·`uniqueItems`·쌍·문구, `issues.ts`의 정렬 키 각각과 위치 단계 각각, `loadModel`의 제외·위치·주석·정렬·사전 경로·폴더 따라가기·`modelDir`). `$ref` 옆 키워드를 `allOf`로 두는 갈래는 지금 스키마에서 결과를 바꾸지 않아(옆 키워드가 `description`뿐) 깨뜨려도 테스트가 실패하지 않는다.
- 검사 명령: 고치지 않았다.
- 스펙이 정하지 않아 정한 것: (1) 데이터가 JSON 값이 아니면 그 항목에는 Ajv를 부르지 않고 `must be a JSON value`만 낸다(분석 S6을 모든 비JSON 값으로 넓혔다. 순환·접근자·Proxy가 Ajv를 멈추거나 던지게 하지 않으려는 것이다. 리뷰 수정에서 바꿨다: 아래). (2) JSON 값 검사를 통과했는데 Ajv가 읽다가 던지는 데이터(`get` 트랩이 던지는 Proxy)는 `path` `""`, `/ must be a JSON value` 하나로 낸다. (3) 어댑터의 거부는 `FileNotFoundError`를 포함해 모두 그대로 넘긴다(`model.yaml`이 없는 폴더, 목록에 있었는데 읽을 때 없어진 파일). (4) `propertyNames` 오류의 `path`는 스펙 문구대로 `instancePath`(맵)다. 키를 가리키는 것은 `additionalProperties`뿐이다. (5) 같은 사전 폴더가 `dictionaries`에 두 번 적히면 옛 도구처럼 두 번 읽는다(리뷰 수정에서 바꿨다: 아래).
- 계획과 달라진 점: (1) 모듈 표에 없는 `validate/index.test.ts`, `testing/example.test.ts`를 더했다. (2) `validate/issues.ts`가 타입 `FilePositions`를, `validate/index.ts`가 `modelItems`를 내보낸다(코어 안에서만 쓴다). (3) `schema/ajv.ts`가 위의 이유로 스키마를 변환해 넣는다(계획은 Ajv 인스턴스만 적었다).
- 알려진 한계(고치지 않았다): (1) 메모리 어댑터의 `list`는 저장된 경로 전체를 훑어, 폴더가 아주 많은 메모리 모델을 읽으면 폴더 수 × 파일 수의 시간이 든다(단계 2의 코드. 한 폴더에 파일이 많은 보통의 모델은 선형이다). (2) ~~Node 어댑터의 `list`는 폴더를 가리키는 심볼릭 링크를 따라가므로, 갈래가 둘 이상인 링크 순환이 있는 폴더는 경로 해석의 한도(`ELOOP`)에 닿을 때까지 지수적으로 많은 경로를 읽는다. 옛 도구도 같다.~~ 틀린 기록이었다: 옛 도구는 링크 순환에서 바로 `ELOOP`으로 실패하고, 이 구현은 `stat`의 오류를 모두 삼켜 엔터티를 410개 읽거나(링크 하나) 멈췄다(링크 둘). 리뷰 수정에서 고쳤다(아래).
- 리뷰 수정 (2026-11-27): ~~(1) Node 어댑터 `list`: 링크의 `stat`이 `ENOENT`·`ENOTDIR`이면 끊긴 링크로 보고 빼고, 그 밖의 오류(`ELOOP`, `EACCES` 등)는 거부한다(FR-02). 폴더를 가리키는 링크는 그 실제 경로가 나열하는 폴더나, 연 폴더에서 거기까지 지나온 폴더(경로의 앞부분마다 `realpath`) 가운데 하나를 품으면(같거나 위 폴더) 따라가지 않는다. 한 걷기 경로에서 같은 실제 폴더가 두 번 나올 수 없으므로 걷기는 끝나고, 순환이 아닌 경로마다 실제 파일이 한 번씩 나온다(형제 폴더를 가리키는 링크는 따라간다). 어댑터에 상태를 두지 않고, `realpath`는 폴더 링크가 있는 목록에서만 깊이만큼 부른다. 메모리 어댑터와 인터페이스는 그대로다. 테스트 `node/fs.test.ts`(실제 링크, 임시 폴더): 자기·위 폴더·`/` 링크, 자기 링크 둘, 형제 폴더와 파일 링크, 끊긴 링크, 두 폴더를 도는 순환, 연 폴더 밖의 순환, 자기 자신을 가리키는 링크(`ELOOP` 거부), 검색할 수 없는 폴더로의 링크(`EACCES` 거부, root면 건너뜀). 고치기 전에는 6개가 실패했다(링크 둘은 시간 초과).~~ (링크를 따라가는 이 설계는 아래 "리더 결정"으로 없앴다.) (2) `itemIssues`: JSON 값 검사와 스키마 검사를 모든 항목에 한다(FR-08). Ajv를 빼는 것은 읽기에 안전하지 않은 데이터뿐이다: 순환, 빈 자리가 있는 배열, 접근자, 클래스 인스턴스(평범한 객체로 보이지 않는 Proxy 포함), 살펴볼 때 던지는 컨테이너(`checkJsonValue`의 `readable`). `undefined`·함수·심벌·bigint·JSON이 담지 못하는 수는 Ajv에 그대로 넘기므로 디스크에서 읽은 데이터에는 늘 Ajv가 돈다. `entities/zz.yaml`의 `.inf` 사례가 이제 `name` 누락과 모르는 키도 낸다. (3) 모델에서 빠진 파일에 주석 경고가 없는 것을 시험한다: 모르는 키, 앵커, 파서 뒤에 찾는 키 충돌, 파서의 중복 키. 주석 블록을 오류 반환 앞으로 옮기면 앞의 셋이 실패한다. 파서 오류가 있으면 `parseYaml`이 주석을 찾지 않으므로 마지막 사례는 그 동작을 지킨다. (4) 사전 파일은 정규화한 경로로 한 번만 읽는다: 적힌 순서에서 처음 찾은 자리에 둔다. 같은 폴더(`dictionary`, `./dictionary`)나 겹치는 폴더(`dictionary`, `dictionary/sub`)도 파일 하나에 항목 하나, 경고는 많아야 하나다. 폴더를 모두 나열한 뒤 파일을 읽는다. (5) `dictionaries`의 절대 경로(`/`나 `\`로 시작하거나 `C:/`·`C:\` 꼴)는 읽지 않고 `model.yaml`의 그 항목(`/dictionaries/<i>`, 위치 포함)에 `schema` 오류 `dictionaries entries must be relative paths`를 `loadModel`의 `issues`로 낸다. `model.yaml`은 모델에 남는다. 그래서 메모리에서 만든 모델의 `validateModel`은 이 오류를 내지 않는다. (6) `validateModel`은 모델 자체가 잘못돼도 던지지 않는다: 목록과 항목을 게터를 부르지 않고 자기 데이터 속성으로만 읽고, 없거나 배열이 아닌 목록은 빈 목록, `file` 문자열이 없는 항목은 건너뛰고, `data`가 없거나 접근자면 `undefined`로 보아 그 파일의 오류가 된다. (7) `prepareSchema`는 `$ref` 옆에 주석류(`description`, `title`, `default`, `examples`, `$comment`) 말고 다른 키워드가 있으면 Ajv 인스턴스를 만들 때 던진다. 주석류만 있으면 전처럼 `allOf`로 함께 둔다. 합성 스키마로 시험한다(`schema/ajv.test.ts`).
- 리뷰 수정 2차 (2026-11-28): ~~(1) Node 어댑터 `list`가 폴더 링크가 있는 목록마다 지나온 폴더 전부에 `realpath`를 불러(그 하나도 깊이에 비례) 모든 단에 링크가 있으면 깊이의 세제곱 시간이 들었다(400단에 `up -> ..`·`root -> /`: 57초, 링크 하나가 800단에 있으면 4.3초). 이제 목록이 돌려준 폴더를 다음에 그 폴더가 나열될 때까지 어댑터가 기억하고(`returned`, 나열하면 지운다), 폴더의 실제 경로를 부모의 실제 경로에서 한 번만 만든다: 링크가 아니면 부모 경로 + 이름, 링크면 `linkTarget`(부모의 실제 경로에서 링크 대상을 한 칸씩, `..`는 실제 경로에서, 링크마다 `readlink`, 링크 40개를 넘으면 `ELOOP`. Linux의 `realpath`와 같은 방법이고 Linux 밖에서는 `realpath`). 지나온 폴더는 모두 들고 다니지 않고 링크를 따라 나온 폴더의 실제 경로만 든다(나머지는 다음 폴더가 품으므로 판정이 같다). 기억이 없는 폴더(걷기의 첫 폴더)는 루트에서 한 칸씩 만든다. 400단: 0.26초, 100단과의 비 약 4.8(전 85), 800단 링크 하나: 0.17초. 옛 구현과 무작위 링크 배치 800개(별칭 루트, `..`로 시작하는 경로, 같은 어댑터로 두 번 걷기 포함)를 비교해 결과와 거부 코드가 모두 같다.~~ (`returned`·`linkTarget`과 플랫폼 갈래는 아래 "리더 결정"으로 지웠다.) (2) 있을 수 없는 경로: Node 어댑터는 `ENAMETOOLONG`도 없는 것으로 보고, NUL이 든 경로는 시스템을 부르지 않고 없는 것으로 다룬다(`list`는 빈 목록, `readText`는 `FileNotFoundError`, `remove`는 아무 일도 하지 않음, ~~링크 `stat`은 끊긴 링크~~). 메모리 어댑터는 NUL이 든 경로를 받지 않는다(`writeText`는 거부, `files`에 있으면 던진다). 길이 한도는 시스템마다 달라 두지 않는다. 그래서 `dictionaries: ["dict\0x"]`, 300자 이름, `a/` 3000번이 빈 사전이 된다. (3) 절대 경로 `dictionaries` 항목의 오류는 이제 `validateModel`이 낸다(`validate/manifest.ts`의 `manifestIssues`, 게터를 부르지 않고 읽는다, 같은 규칙·문구·`path`, 위치 색인이 있으면 위치). `loadModel`은 그 폴더를 읽지 않기만 하고 오류를 내지 않는다. `model.yaml`은 모델에 남아 `validateModel`이 늘 보므로, 둘을 함께 돌리면 항목마다 오류가 하나다. 메모리에서 만든 모델도 보고된다. `field`·`listed`는 `validate/plain.ts`로 옮겼다. (4) 테스트: ~~별칭 폴더로 연 모델의 `up -> ..`(첫 폴더를 실제 경로 대신 글자 경로로 두면 실패), `entit` 옆 `entities/ent -> ../entit`(품기 판정이 구분자를 빼면 실패), 너무 긴 대상 이름의 링크,~~ Node 어댑터로 읽는 있을 수 없는 사전 폴더 셋, 계약 테스트의 있을 수 없는 경로 셋과 NUL 쓰기, ~~100단과 400단 걷기의 시간 비 12 미만·400단 5초 미만,~~ 게터를 부르지 않는 목록·항목, 메모리 모델의 절대 경로 항목. ~~별칭·`entit` 두 테스트는 지금 규칙을 지키는 테스트라 고치기 전에도 통과하고, 적은 줄을 깨뜨리면 옛 구현과 새 구현 모두에서 실패한다.~~ 나머지 새 테스트는 고치기 전에 실패했다~~(시간 테스트는 시간 초과)~~.
- 리더 결정 (2026-11-28, 리뷰 3차 뒤): 리뷰 3차가 링크 따라가기에서 또 문제를 찾았다(`returned`가 낡거나 끝없이 커질 수 있고, Linux 밖에서는 깊이의 약 세제곱 시간이며, 걷기 규칙 하나가 시험되지 않았다). 리더가 링크 따라가기를 "링크는 나열하지 않는다"로 바꿨다. 까닭: 앞 설계는 호출 사이에 상태를 두고 플랫폼마다 다른 코드가 필요했고, 주 실행 환경인 브라우저 어댑터(File System Access API)는 폴더 목록에 심볼릭 링크가 없어 따라갈 수 없으므로 Node에서 따라가면 CLI와 앱이 다른 모델을 읽는다. Node 어댑터 `list`는 `readdir`의 항목 종류로 파일과 폴더만 돌려주고, 심볼릭 링크는 무엇을 가리키든(파일, 폴더, 없음, 자기 자신) 오류 없이 뺀다. 종류를 알 수 없는 항목은 `lstat`으로 가린다(링크를 따라가지 않는다. 그 사이 없어진 항목은 뺀다). 연 폴더와 `readText`·`writeText`·`remove`에 준 경로는 운영체제가 평소대로 푼다. 어댑터는 호출 사이에 상태를 두지 않는다. `returned`, `linkTarget`, `holds`, `MAX_LINKS`, 플랫폼 갈래를 지웠다. 없는 것으로 보는 오류(`ENOENT`·`ENOTDIR`·`ENAMETOOLONG`, NUL 경로)와 그 밖 오류의 거부, 메모리 어댑터는 그대로다. 테스트 `node/fs.test.ts`: 파일·폴더·`.`·`..`·`/`로의 링크, 끊긴 링크, 자기 자신 링크, 서로 가리키는 두 폴더, 형제 폴더 링크가 목록에 없고 `loadModel`이 그 경로를 나열하거나 읽지 않으며 모델의 엔터티가 예제와 같다(하나씩, 모두 함께), 링크 폴더를 거친 경로로 연 어댑터, 링크인 파일과 링크인 `model.yaml`을 이름으로 읽기, 링크 없는 깊은 트리(200/800단)와 넓은 트리(폴더 500/2000개)의 걷기 시간 비 12 미만. `node/fs-unknown-type.test.ts`: `readdir`가 종류를 주지 않을 때 `lstat`으로 가린다(`stat`으로 바꾸면 실패). 링크를 따라가던 테스트와 깊이 비율 시간 테스트는 지웠다. 이 변경은 단계 리뷰어의 리뷰를 받지 않았고, 브랜치의 마지막 리뷰가 다룬다.

### 단계 4 (2026-11-28)

- 4.1: `testing/cases.ts`의 `RuleCase`는 `{ name, rows, changes, issues, parityExcluded? }`다. `rows`는 그 사례가 보이는 부록 A의 줄 번호들, `issues`는 `validateProject`가 모델마다 낼 목록 전체(일곱 필드, 정렬 순서 그대로), `parityExcluded`는 대조에서 뺄 때의 이유이고 FR-13의 넷(18 키 순서, 25 다대다, 26 PK·IE `parentKey`, 38)만 쓴다. 사례 66개: 오류가 있는 것 60개, 오류가 0개인 것 6개(키 순서만 다른 타입, 양쪽 다 타입 없음, `schemas` 없이 적힌 `physical.schema`와 다른 스키마의 같은 테이블명, 논리 엔터티의 테이블명, 한 속성이 같은 쌍을 두 번 적은 `migratedFrom`, 여러 속성 PK 안의 비식별 이주), 대조에서 빼는 것 6개. 규칙마다 위반 사례 수(그 규칙의 `Issue`가 하나 이상 나오는 사례): R01 10, R02 19, R03 2, R04 13, R05 3, R06 5, R07 1, R08 5, R09 6, R10 2, R11 1, R12 2. 1번은 종류 일곱, 26번은 메시지 셋(PK와 IE를 가리키는 `parentKey` 둘 다), 33번은 둘이다. 따라 나오는 오류(엔터티가 빠져 생기는 `unknown entity` 등)도 목록에 모두 적었다. `line`·`column`은 고친 파일을 줄 번호와 함께 찍어 정했고(키는 키의 시작, 배열 항목은 값의 시작), 그 뒤 옛 도구를 각 사례를 푼 임시 폴더에 돌려 `<file>: <message>` 다중집합을 비교했다: 대조에 넣는 사례 60개 모두 같고, 빼는 6개는 일부러 바꾼 메시지만 다르다. 구현은 그다음에 썼다.
- 4.2: `describe('규칙 사례')` 아래 사례마다 테스트 하나와 묶음 단언 여섯: 예제는 경고 포함 0개, 사례의 `rule`에 R01~R12가 모두 있다, 부록 A 1~38번마다 그 줄의 규칙과 메시지 꼴(정규식 표)에 맞는 `Issue`를 가진 사례가 있다, 1·26·33번의 종류와 메시지 수, 대조 제외 이유가 FR-13의 넷뿐이다, 예제에 없는 치환 문자열과 이미 있는 파일 더하기는 던진다. 구현 전에 돌려 사례 58개가 실패하는 것을 봤다(오류 0개 사례와 묶음 단언은 통과).
- 4.3: 규칙은 계획의 `validate/rules.ts` 대신 `validate/rules/` 아래 다섯 파일이다(계획이 허락한 나눔): `read.ts`(규칙이 읽는 값만 평범한 데이터로 한 번 읽어 고정된 모양으로 옮긴다. `field`·`indexed`만 쓰므로 게터를 부르지 않고 던지지 않는다. 필수 필드가 문자열이 아닌 항목은 뺀다. 검사를 통과한 데이터에서는 답을 바꾸는 Proxy만 그럴 수 있다), `context.ts`(공유 색인: 엔터티별 속성·키 id 맵, 첫 PK, 키 속성 집합, 자식 엔터티별 "링크 → 부모 속성 → 이주한 속성" 맵. 모두 처음 쓸 때 한 번 만든다), `index.ts`(사전, 매니페스트, 물리 이름, 링크 만들기, `resolvedBy`, 판별자, 주제영역, 배치), `entities.ts`(속성과 키, `migratedFrom`), `links.ts`(링크별). 조회는 모두 맵·집합이라 시간은 모델 크기와 낸 오류 수에 선형이다. 재귀가 없다. `validateModel`은 스키마·JSON 값 검사(`itemIssues`)의 오류가 없는 항목만 규칙에 넘긴다. 매니페스트의 절대 경로 사전 오류(`manifestIssues`)는 매니페스트를 빼지 않는다(디스크에서도 `model.yaml`이 모델에 남는다). 모델 폴더는 `model.dir`(문자열이 아니면 `""`)를 정규화해 쓴다. R01의 `(also in <file>)`을 위해 `fs/path.ts`에 `relativePath`를 더했다(테스트 13개).
- 4.4: `rules.test.ts`의 다른 `describe`(이름이 모두 `규칙 사례`로 시작한다): R06 비교 넷(사례 이름으로 결과를 단언), 메모리에서 고친 모델(규칙 오류와 스키마 오류가 `path`만 있고 위치 없음, 목록 전체), `attributes: null`(그 파일의 `schema` 오류 + 그 엔터티를 뺀 모델의 `validateModel`과 정확히 같다), 자기 자신을 가리키는 `ext`(같은 방식), 한 파일에서 위치 없는 `Issue`가 앞, 연 폴더 아래 `m/`의 모델과 밖의 사전(`file`은 연 폴더 기준, 메시지의 파일은 모델 폴더 기준 `../dict/standard.yaml`), 문자열이 아닌 `dir`. 예외 없음: 예제의 모든 항목을 트랩이 무작위로 던지거나 다른 값을 돌려주는 Proxy로 감싸 120번(비율 0.001·0.01·0.05, 씨앗 40개씩) 불러 던지지 않는다. 시간: `ruleIssues`만 잰다(스키마 검사가 증가를 가리지 않게). 모양 셋(속성 n개와 그 n개짜리 PK를 한 관계로 이주하는 엔터티 둘 / 허브 하나에서 관계 n개, 서브타입 멤버 n개, 모든 엔터티를 든 주제영역, 모든 노드·엣지를 든 배치 / 단어·용어 n개)을 각각 바른 모델과 모든 이주가 틀린 모델(오류 2·wide + 2·many개)로, n=5000과 20000을 세 번씩 재어 가장 빠른 시간의 비가 8 미만, 20000이 20초 미만. 잰 비(두 번 실행): 바른 모델 4.06·4.25, 3.92·4.86, 4.71·4.97, 틀린 모델 4.20·4.52, 3.53·5.31, 4.45·4.59. 옛 도구식 조회로 바꾸면 실패한다: 이주 대상 훑기 14.8, 속성 `find` 9.9·11.5, 키 집합 매번 만들기 22.7, 주제영역 엔터티 훑기 17.7, 단어 목록 훑기 24.8. 큰 모델 자체가 맞는지(오류 0개, 틀린 모델은 정확한 개수)는 `validateModel`로 따로 단언한다.
- 4.5: `model/broken-layout.test.ts`의 `describe('깨진 배치')` 셋: AC-07의 입력(잘린 `sales.json` + `tag.yaml`의 모르는 도메인)은 오류가 정확히 둘(R02 14:5, `syntax` 2:1)이고 모델의 배치는 `catalog.json` 하나이며 `sales.json`의 위치 색인이 없다. 잘린 배치와 함께 `catalog.json`의 모르는 노드는 R09로 나온다(남은 배치도 검사된다). 한 줄에 `nodes`가 둘인 배치는 `syntax` 하나, 1:39.
- 규칙을 하나씩 깨뜨려 확인했다: `context.report` 호출 42곳과 사전 중복 3곳을 하나씩 아무것도 하지 않게 바꾸고, 조건 23곳을 바꿨다(논리 엔터티 건너뛰기, `schemas`가 있을 때만, 스키마별 테이블명, 없는 `scope`의 경로, 첫 용어가 이긴다, 모델 전체 배치 둘, 주제영역 밖 노드, `migratedFrom` 전부, 다대다의 38번 제외, R03 한 번, 속성 범위 물려받기, 타입 비교, 다대다 이주 없음, IE `parentKey`, 잘못된 종류 뒤 계속하기, 비식별의 PK 전부 조건, 서브타입의 R05, 부모 쪽 R08, 한 속성은 한 번 센다, 첫 PK, 첫 속성, 도메인 id 비교, 타입 키 순서). 처음 돌렸을 때 살아남은 둘(부모 쪽 R08, 첫 용어가 이긴다)을 잡는 사례를 더했고(`product`를 `logical`로 둔 사례, 중복 용어에 모르는 단어), 마지막에는 68곳 모두 테스트가 실패한다.
- 4.6: 5장의 단계 관문 `exit=0`(테스트 16개 파일 406개, 단계 3 끝의 306개에서 100개 늘었다). `npm run --silent validate:format`도 요약 줄이 `want`와 같다. AC-05: `pnpm exec vitest run -t '규칙 사례'` 84개 통과, `exit=0`. AC-07: `-t '깨진 배치'` 3개 통과, `exit=0`. `git diff --exit-code bcf9cf9 -- packages/core/src/model/load.test.ts` `exit=0`(단계 3의 커밋이 여럿이라 단계 4 직전의 커밋을 기준으로 했다. 이 파일을 마지막으로 바꾼 것은 `e43bc62`다).
- 검사 명령: 고치지 않았다.
- 단계 3의 테스트를 고친 곳(`validate/index.test.ts`의 넷): 규칙이 들어오자 테스트가 일부러 깨뜨린 항목 때문에 규칙 오류가 따라 나왔다. 조건은 낮추지 않고 목록 전체 비교를 그대로 둔 채 이렇게 고쳤다. (1) 메모리에서 고친 모델: 깨진 사전을 예제 사전에 더하고(바꾸지 않고), 매니페스트가 빠져 생기는 R12 셋(위치 없음)을 기대 목록에 적었다. (2) 위치 검사의 대상을 첫 엔터티에서 아무도 가리키지 않는 `subject-areas/party.yaml`로 옮겼다(같은 2:1 단언). (3) 시간 비율 테스트의 기대 개수에 주제영역의 R02(엔터티마다 하나)를 더했다. (4) 절대 경로 사전 테스트의 `dictionaries`에 `dictionary`를 함께 적어 사전이 그대로 읽히게 했다(같은 6:5 단언).
- 스펙이 정하지 않아 정한 것: (1) `parentKey`가 PK나 IE를 가리키면 R04를 내고, 그 키를 링크가 이주하는 키로 보고 나머지 검사(정확히 하나, R05, 38번)를 계속한다. 그 키가 없을 때(26번 첫 메시지)와 PK가 없을 때는 옛 도구처럼 거기서 멈춘다. (2) 25번의 `/scope`는 관계나 서브타입 파일에 `scope`가 적혀 있을 때이고, 없으면(`both`로 보아 오류가 날 때) 부록 A 머리말대로 그 키를 가질 객체인 `""`다. 서브타입 멤버도 범위가 서브타입에 있으므로 `""`다. (3) R03은 PK가 몇 개든 하나이고 둘째 PK를 가리킨다(옛 도구처럼). (4) 절대 경로 사전 항목이 있는 매니페스트도 규칙에 쓴다(위). (5) `(also in <file>)`의 경로는 `model.dir` 기준이다. 모델 폴더가 연 폴더 밖(`../m`)이고 파일이 연 폴더 안이면 돌아가는 길의 이름을 알 수 없어 연 폴더 기준 경로를 그대로 쓴다. (6) 타입에 스칼라가 아닌 필드가 있으면(스키마가 막는다) 무엇과도 같지 않다. (7) 38번은 스펙의 조건(다대다가 아니고 부모 속성과 키가 있을 때)만 보므로, 링크의 자식이 그 엔터티가 아닐 때(15번)도 검사한다. (8) 옛 도구를 그대로 따른 것: `id`가 겹친 뒤 항목은 다른 규칙에서 빠진다(첫 항목이 이긴다), 배치는 겹친 것까지 모두 검사한다, 적히지 않은 `physical.schema`와 `""`는 같은 스키마다, 사전의 겹친 용어는 첫 것만 단어·도메인을 검사한다.
- 리뷰 후속 (2026-11-28, 단계 4 리뷰 1회차 통과 뒤, 동작 변경 없음, 별도 커밋): (1) 리뷰어가 탐침으로만 확인한 동작에 사례 다섯을 더했다(사례 71개): 다른 서브타입 멤버와 겹치는 멤버 id(9번 둘째 꼴), PK 없는 슈퍼타입(26번 셋째 메시지가 `/members/<i>`에), `scope` 키가 없는 서브타입 파일의 R08(`""`), 부모와 자식이 뒤바뀐 관계의 38번(15번·27번과 함께), id 꼴을 통과하는 프로토타입 이름(`constructor`, `valueof`). 대조 대상인 넷은 옛 도구를 사례마다 푼 임시 폴더에 돌려 `<file>: <message>` 다중집합이 같고, 뒤바뀐 관계는 38번 메시지만 다르다(FR-13 대조 제외). 사례마다 해당 코드를 한 군데씩 깨뜨려(객체 `in` 조회, 서브타입 `scopePath`, 멤버끼리의 충돌 검사, 멤버 링크의 `path`, 15번 뒤 중단) 그 사례만 실패하는 것을 봤다. (2) `validate/rules/index.ts`: R01 중복 id 메시지를 한 함수(`duplicate`)에서 만들고 엔터티와 사전이 함께 쓴다, 엔터티 맵은 `context.entities` 하나를 `byId`가 채운다(복사하지 않는다), R12 모르는 영역 그룹·R02 `resolvedBy`·판별자·주제영역 엔터티를 이름 있는 함수(`groupIssues`, `resolvedByIssues`, `discriminatorIssues`, `areaEntityIssues`)로 옮겼다. 기존 테스트는 고치지 않고 모두 통과한다.
- 계획과 달라진 점: (1) 규칙 모듈을 `validate/rules/` 아래 다섯 파일로 나눴다(위). (2) `fs/path.ts`에 `relativePath`를 더했다(모듈 표에 없다). (3) `RuleCase`의 변경에 "파일 더하기"(`addFile`, 이미 있으면 던진다)를 더했다. 서브타입 파일이 하나뿐이라 "중복 서브타입 id"를 치환으로 만들 수 없고, 논리 엔터티의 테이블명 사례도 아무도 가리키지 않는 엔터티가 필요하다(두 사례). (4) `validate/index.test.ts`의 넷을 고쳤다(위). (5) 리드의 지시로 스펙 FR-07의 "프로젝트, 모델, 주제영역" 절 문장(모델 폴더 안의 심볼릭 링크를 읽지 않는다)을 `docs/format-v0.md`에 이 단계에서 더했다. 단계 1의 1.8 뒤에 스펙(D-03)이 바뀌어 생긴 일이다. (6) 계획 4.3은 옛 도구와 다른 곳을 18, 25, 26, 38의 넷으로 적었다. 리드가 다섯째로 든 "`schemas`가 있어도 `physical.schema`가 없는 엔터티는 허용"은 옛 도구도 이미 그렇게 해서(`schema !== undefined`일 때만 본다) 결과가 다르지 않다. 0개 사례 하나가 이것을 고정한다.

---

마지막 수정: 2026-11-28 (단계 4 완료)
상태: 진행 중 (단계 4/6 완료)
