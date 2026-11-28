# F03 `core-commands` 구현 계획

**작성일**: 2026-11-28 (계획 리뷰 3회차 반영)
**스펙**: [docs/specs/core-commands.md](../specs/core-commands.md) (FR-01~FR-11, AC-01~AC-18, 부록 A~D)
**분석 보고서**: [docs/analysis/core-commands.md](../analysis/core-commands.md)
**결정 기록**: [docs/decisions/core-commands.md](../decisions/core-commands.md) (D-00~D-05)
**브랜치**: `feature/core-commands`
**상태**: 진행 중 (단계 7/8 완료)

스펙과 분석이 다르면 스펙을 따른다. 스펙은 분석 뒤에, 그리고 계획 리뷰 1~3회차 뒤에 고쳐졌다(분석 5장 S1~S9와 11장 Q1~Q4는 스펙 본문에 있다. 2장 "계획에서 정한 것" 3). 이 계획은 스펙의 규칙을 다시 적지 않는다. 구현자는 FR·AC 번호와 부록의 줄로 스펙을 찾아 읽는다.

**스펙에서 모순이나 빈 곳을 찾으면 짐작으로 메우지 않는다. 멈추고 리드에게 알린다**(6장 위험 1).

## 1. 요구사항 요약

| 요구사항 | 내용 | 단계 | 닫는 수용 기준 |
| --- | --- | --- | --- |
| FR-01 | 편집기(`createEditor`, `execute`·`undo`·`redo`), 모델의 조건, 재진입, 공개 이름 | 4(조건), 5, 6(공개) | AC-01, AC-11, AC-14 |
| FR-02 | 불변, `ReadonlyModel`, "바뀌었다"의 뜻, 이력의 메모리 | 1(타입), 5, 6 | AC-01, AC-05, AC-06 |
| FR-03 | 입력 복사와 한도, 명령 스키마, 한 줄 문구 | 2 | AC-01, AC-11 |
| FR-04 | 명령마다 검증, 거부 규칙 | 5 | AC-07, AC-13 |
| FR-05 | ID 만들기(슬러그, 로마자, 후보 순서, 거부 이유 다섯) | 3, 6 | AC-08 |
| FR-06 | 새 항목의 경로, 비교 키, 예약 경로, 처음 경로, `listReservedFiles` | 3, 6 | AC-09 |
| FR-07 | 명령 17종의 동작, 연쇄 | 5(`entity.*`), 6 | AC-04, AC-06, AC-10 |
| FR-08 | 묶음과 이력 | 5, 6 | AC-12, AC-13, AC-03 |
| FR-09 | `writeChanges` | 4 | AC-05, AC-03, AC-02 |
| FR-10 | 성능(선형, 후보 수의 상한, 바뀐 항목만 직렬화, 250 ms 방지선 하나) | 3, 4(감시), 5(일의 수), 7 | AC-15 |
| FR-11 | 문서 갱신 | 8 | AC-16 |
| 형식 변경 없음 | `format/`, `packages/core/src/generated/`가 그대로다 | 모든 단계의 관문 | AC-16 |
| 제약 | `spikes/`를 건드리지 않는다 | 0, 모든 단계의 관문 | AC-17 |

DB, API, 화면 요구사항은 없다.

### 수용 기준과 단계

AC 하나는 단계 하나에서만 닫는다. "먼저"는 그 AC의 테스트 일부를 미리 쓰는 단계다. 테스트 파일은 `packages/core/src/command/` 아래이고(AC-02와 AC-01의 공개 이름만 `packages/cli/src/`), `describe` 이름은 스펙 6장의 테스트 이름 그대로다.

| AC | 테스트 파일 · `describe` | 먼저 | 닫는 단계 |
| --- | --- | --- | --- |
| AC-01 | `schemas.test.ts` "명령 스키마", `serializable.test.ts` "명령 직렬화"(`@ts-expect-error` 셋), `packages/cli/src/core-entry.test.ts`(공개 이름 아홉) | 1, 2 | 6 |
| AC-02 | `packages/cli/src/bundle.test.ts` "브라우저 번들" | | 7 |
| AC-03 | `undo-roundtrip.test.ts` "실행 취소 왕복" | | 7 |
| AC-04 | `rename.test.ts` "이름 변경" | | 6 |
| AC-05 | `write-changes.test.ts` "저장의 조건"(단계 4), "바뀐 파일만"(단계 7) | 4 | 7 |
| AC-06 | `handlers.test.ts` "명령 동작" | 5 | 6 |
| AC-07 | `policy.test.ts` "검증 정책" | 5 | 6 |
| AC-08 | `slug.test.ts` "ID 만들기: 슬러그", `ids.test.ts` "ID 만들기" | 3 | 6 |
| AC-09 | `paths.test.ts` "새 파일 경로", `reload.test.ts` "다시 읽기" | 3, 4, 6 | 7 |
| AC-10 | `cascade.test.ts` "연쇄와 대상" | 5 | 6 |
| AC-11 | `copy.test.ts`·`message.test.ts`(단계 2), `hostile.test.ts` "믿을 수 없는 입력"·"거부 문구", `handler-throws.test.ts` | 2, 5 | 6 |
| AC-12 | `history.test.ts` "이력" (마지막 문장이 `key.delete`를 쓴다) | 5 | 6 |
| AC-13 | `batch.test.ts` "묶음" | 5 | 6 |
| AC-14 | `model-shape.test.ts`(단계 4), `editor.test.ts` "편집기 만들기" (거부 코드 여덟이 `entity.*`와 재진입으로 모두 나온다) | 4 | 5 |
| AC-15 | `editor.perf.test.ts`, `history.test.ts` "이력"(`undo`·`redo`의 `validateModel` 0번) | 5 | 7 |
| AC-16 | 5장의 AC-16 스크립트(스펙 6.1과 같은 글, 형식 확인 두 줄 제외) | | 8 |
| AC-17 | 5장의 `spikes/` 비교 | 0 | 8 |
| AC-18 | 5장의 단계 관문, `dependencies` 확인. `gh pr checks`는 리드가 닫는다 | | 8 (PR 검사는 리드) |

## 2. 분석 보고서 반영과 모듈 나눔

### 적용한 권고 (분석 9장)

| 권고 | 반영 |
| --- | --- |
| 1 `serializeItem` 떼기 | 단계 1. 2장 "계획에서 정한 것" 4의 모양 |
| 2 `DeepReadonly`, `ReadonlyModel`, 매개변수 넓히기 | 단계 1 |
| 3 명령 스키마는 손으로 쓴 TS, 깊이 얼림, 동기화 테스트 | 단계 2 |
| 4 `prepareSchema(s, s)` → `schemaAjv().compile`, 종류마다 처음 쓸 때 한 번 | 단계 2. 다른 Ajv 인스턴스를 만들지 않는다 |
| 5 스키마 오류 고르기 | **스펙이 바꿨다.** 순서는 FR-03 4의 `compareIssues`(파일·위치·규칙이 같으니 문구의 코드 단위 순)다. 분석의 "`path` 먼저"는 쓰지 않는다(AC-01이 `/ must NOT have additional properties`로 고정한다). `schemaIssues`를 `ValidateFunction`을 받는 안쪽 함수로 나누는 것은 한다(단계 1) |
| 6 복사기: 명시적 스택, 깊이 → 값 → 글, 모든 반사 호출을 `try`로, `Object.defineProperty` | 단계 2 |
| 7 처리는 `handlers/*.ts`, 레지스트리는 따로. `vi.mock` 세 자리 | 단계 5, 6 |
| 8 단일 명령도 묶음과 같은 길, 바뀐 목록만 새 배열 | 단계 5 |
| 9 "새 오류"와 `Issue` 다시 쓰기 | **술어가 둘이고 따로다**(단계 5). (가) 거부의 `issues`에 넣을 새 오류: 전 목록에 `rule`, `file`, `path`, `message`가 모두 같은 것이 없는 오류(FR-04). 키는 `JSON.stringify([rule, file, path, message])`. (나) 객체 다시 쓰기: `rule`, `file`, `path`, `message`, `severity`, `line`, `column`이 모두 같을 때만 앞 목록의 객체를 쓴다(FR-02). 다시 쓰기는 이 계획에서 필수다(오류 15000개 모델의 이력 100칸이 약 278 MB에서 약 12 MB로 준다. 분석 4.4). 이력의 칸은 모델과 `issues`만 든다. 경로나 ID 색인을 칸마다 붙들지 않는다 |
| 10, 11 새 경로의 폴더, 대소문자 쌍 | 스펙 FR-09에 들어갔다. 단계 4 |
| 12 FR-05 2단계 "둘 다 있고 같다", `set.physical: {}`, 이미 든 ID | 스펙에 들어갔다. 단계 6에 테스트 하나씩 |
| 13 테스트 도우미 셋을 먼저 | 처음 쓰는 단계에서 만든다: `testing/commands.ts`(단계 2), `testing/recording-fs.ts`(단계 4), `testing/wide-model.ts`(단계 7) |
| 14 묶음 크기에 대한 `expectLinearTime` | **하지 않는다.** 시간 대신 일의 수를 세는 결정적 테스트로 바꿨다(결정 9) |
| 15 모델의 조건 검사 한 함수, 접두만 다르게 | 단계 4 `command/model-shape.ts`의 `checkEditable` |
| 16 F02의 관문, 시간 테스트는 따로 15번 | 5장 |

재사용하는 것은 분석 1.3절의 표, 읽을 자리는 분석 8장 그대로다. 덧붙일 것 둘: `compareIssues`(`validate/issues.ts` 26행)는 스키마 오류 고르기에, `serialize-too-large.test.ts`의 `vi.mock(path, async (importOriginal) => …)` 꼴은 감시 테스트에 쓴다.

### 모듈 나눔

분석 2.1절의 배치를 쓴다. 다른 점만 적는다. 모두 `packages/core/src/` 아래다. "공개"는 `src/index.ts`가 내보내는 단계다.

| 파일 | 하는 일 | 공개 이름 (단계) | 만드는 단계 |
| --- | --- | --- | --- |
| `model/serialize-item.ts` | `itemText`(글만), `serializeItem`(JSON 값 검사 + 글). 감시 지점 | 없음 | 1 |
| `model/types.ts` | `DeepReadonly`, `ReadonlyModel` | `ReadonlyModel` (1) | 1 |
| `command/types.ts` | `Command`(17종), `CommandResult`, `RejectionCode`, `Editor`, `Issues` | 타입 넷 (6) | 2 |
| `command/message.ts`, `copy.ts`, `schemas.ts`, `check.ts` | FR-03 | `commandSchemas` (6) | 2 |
| `command/slug.ts`, `ids.ts`, `paths.ts` | FR-05, FR-06. `paths.ts`에 비교 키 `pathKey`(결정 8) | `listReservedFiles` (3) | 3 |
| `command/model-shape.ts` | `checkEditable(model)`: FR-01 조건 1~4의 이유 또는 `undefined` (분석에 없는 파일) | 없음 | 4 |
| `command/write-changes.ts` | FR-09 | `writeChanges` (4) | 4 |
| `command/work.ts` | `noteWork(kind, entries)`: 아무것도 하지 않는 함수. 일의 수를 세는 감시 지점(결정 9. 분석에 없는 파일) | 없음 | 5 |
| `command/working.ts`, `find.ts`, `changes.ts`, `registry.ts`, `editor.ts`, `handlers/entity.ts` | FR-01, FR-02, FR-04, FR-08, `entity.*` | `createEditor` (6) | 5 |
| `command/handlers/attribute.ts`, `key.ts`, `subject-area.ts` | 나머지 13종 | 없음 | 6 |
| `testing/commands.ts`, `recording-fs.ts`, `wide-model.ts` | 테스트 도우미(빌드에서 빠진다) | 없음 | 2, 4, 7 |

의존 방향: `model`·`validate`·`schema`·`fs` → `command`. `command` 안에서는 `copy`·`check`·`message` → `ids`·`paths` → `handlers` → `registry` → `editor`. `write-changes`는 `model-shape`, `serialize-item`, `paths`의 `pathKey`만 쓰고 편집기를 모른다.

### 계획에서 정한 것

1. **`writeChanges`(단계 4)가 편집기(단계 5~6)보다 먼저다**(분석과 다른 한 군데. 계획 리뷰가 확인했다). AC-04, AC-09, AC-10, AC-13이 명령 뒤의 저장 결과까지 단언하고, `writeChanges`는 두 모델만 받아 손으로 만든 모델로 혼자 시험된다.
2. **편집기 단계를 둘로 나눴다**: 단계 5는 뼈대와 `entity.*`, 단계 6은 나머지 13종. **`createEditor`, `commandSchemas`, 명령 타입 넷은 17종이 다 있는 단계 6에서야 `index.ts`가 내보낸다.** 그 전의 테스트는 모듈 경로(`./editor.js` 등)에서 가져온다.
3. **분석의 열린 질문은 스펙에 답이 있다.** Q1 → FR-09 "새 경로의 보호", Q2 → FR-09 "먼저 보는 것", Q3 → FR-02 "이력의 메모리", Q4 → FR-03 4. S5~S9 → FR-05, FR-07, FR-03.
4. **`serializeItem`의 모양과 F02의 예외 경계**: `itemText(file, data, schema)`는 `canonical`을 `try` **밖에서** 부르고, `layoutJson`·`yamlText`의 `RangeError`만 `Cannot write <file>: it is too large or too deeply nested to write`인 `TypeError`로 바꾸며 `cause`를 남긴다(지금 `serialize.ts` 229~249행 그대로). `canonical`에서 난 예외는 그대로 나간다. JSON 값 검사(첫 훑기)는 접근자를 부르지 않고 던지는 트랩을 잡으므로, 거기서 걸린 것은 원래 오류가 아니라 `must be a JSON value` `TypeError`가 된다. `serializeItem`은 `checkJsonValue`의 첫 오류를 지금과 같은 문구의 `TypeError`로 던진 뒤 `itemText`를 부른다. `serializeModel`은 지금처럼 **모든 항목을 먼저 검사한 뒤** `itemText`를 부른다. 편집기와 `writeChanges`는 `serializeItem`만 부르고 테스트는 그것을 감시한다. `yamlText`를 함께 옮겨 가져오기 순환을 만들지 않는다.
5. **기준선 둘을 `docs/handoff/`에 둔다**(무시 대상, 커밋되지 않는다): `core-commands-spikes-before.sha256`(AC-17. F02의 것은 쓰지 않는다)과 `core-commands-f02-tests.list`(`main`에 있는 테스트 파일과 `src/testing/` 파일의 경로. 단계 1의 불변 증명에 쓴다). 둘 다 **없을 때만** 만든다.
6. **입력 층의 내부 함수**: `check.ts`에 `readCommand(input)`(FR-03의 1~4, `batch`는 봉투까지)와 `checkCommand(copy)`(3~4, 하위 명령용)를 둔다. 단계 2는 이것을 직접 시험하고, 단계 5~6이 같은 표를 `execute`로 다시 돌린다. 표는 `testing/commands.ts`에 한 번만 적는다(`REJECTED_INPUTS`, `ACCEPTED_INPUTS`: 입력을 만드는 함수로 둔다. `SAMPLE_COMMANDS`: 종류, 시작 모델, 앞서 실행할 명령, 기대 데이터, 기대 `written`·`removed`).
7. **ID 고르기의 입력**: `ids.ts`는 모델을 직접 훑지 않고 "쓰이는지"를 답하는 작은 인터페이스(이름 공간의 ID, 쓰이는 경로의 키 집합, 예약 경로, 처음 모델의 경로 집합, 사전 폴더)를 받는다. 처음 경로 집합은 편집기의 상태다(FR-01). 한 번의 찾기에서 이미 물어본 후보 글은 다시 묻지 않는다(FR-05, FR-10). 단계 3은 인터페이스를 가짜로 채워 시험하고, 단계 5의 작업 상태가 진짜를 준다.
8. **경로의 비교 키는 함수 하나다**: `paths.ts`의 `pathKey(path)` = `path.normalize('NFKC').toLowerCase()`(스펙의 정의. `String.prototype.normalize`는 ES2022 대상에서 된다). FR-06의 "쓰이고 있다"와 처음 경로 규칙, FR-09의 (2)(같은 키의 **새 경로 둘**도 거부한다)와 (4)의 나열 이름 비교가 모두 이것을 쓴다. **`command/` 안에 다른 대소문자 접기를 두지 않는다**(`toLowerCase`와 `normalize` 호출은 `pathKey`와 슬러그의 NFKC·소문자화뿐이다). 문구는 바뀌지 않는다. **저장의 순서는 FR-09 그대로다**: 검사 다섯을 차례로 하고 저마다 첫 실패에서 멈춘 뒤, 쓰기를 먼저(경로 순) 하고 모든 쓰기가 성공한 뒤에만 지운다(경로 순). 4.3의 사례가 이 순서를 고정한다.
9. **시간 테스트는 AC-15의 방지선 하나뿐이다**(`command/editor.perf.test.ts`, 테스트 하나, 제한 시간을 `60_000`으로 명시). 묶음의 제곱 코드는 시간이 아니라 **일의 수**로 막는다(5.1). 그러려면 설계 제약이 하나 있다: **처리와 작업 상태가 목록과 색인을 고치는 일은 모두 `working.ts`의 도우미(항목 더하기·바꾸기·빼기, 색인 만들기·고치기)를 거치고**, 도우미는 훑거나 복사한 칸 수를 `work.ts`의 `noteWork`에 알린다(`'copy'`, `'scan'`, `'index-build'`와 칸 수). 처리 모듈에서 목록에 `slice`, 펼치기, `filter`, `find`를 직접 쓰지 않는다. `noteWork`는 제품에서 아무것도 하지 않고 테스트가 `vi.mock`으로 센다.
10. **`docs/stage1-backlog.md`의 F03 상태 줄**(분석 S10, 스펙 밖): 단계 8에서 F02와 같은 모양으로 더한다. PR 번호는 병합 뒤 리드가 채운다.
11. **리뷰와 올리기**: 단계마다의 리뷰, 브랜치 전체 Codex 리뷰, push, PR, `gh pr checks`는 리드가 한다. 구현 중에 요구를 바꿔야 하면 그 자리에서 리드에게 알려 Codex 확인을 붙인다(D-00).

### 제약

F02에서 이어 오는 규칙이다. 리뷰는 이 목록으로 본다.

- **적대적인 입력에 던지지 않는다.** `execute`·`undo`·`redo`는 어떤 값에도 던지지 않는다. 던지는 것은 `createEditor`의 `TypeError`(FR-01)와 `writeChanges`의 거부(FR-09)뿐이다. 입력을 읽는 반사 호출은 모두 `try` 안에 둔다.
- **사용자 데이터를 재귀로 걷지 않는다.** 명시적 스택을 쓴다. 한도로 묶인 재귀(`canonical`의 256단)만 그대로 둔다.
- **제곱 코드를 두지 않는다.** 조회는 `Map`·`Set`이다. 사용자 글(ID, 경로, 이름)을 평범한 객체의 키로 쓰지 않는다. 스펙이 허용한 비용은 FR-10 (1)의 둘뿐이다: 명령 하나에 모델 크기의 선형, 그리고 거기 적힌 상한까지의 서로 다른 ID 후보 수.
- **`@erdmaker/core`의 기본 진입점은 Node의 것을 가져오지 않는다.** `node:` 모듈, `process`, `Buffer`, `console`을 쓰지 않는다. 증거는 `pnpm test`의 "브라우저 번들"과 `tsconfig.json`의 `types: []`다.
- **ES2022까지만 쓴다.** `toSorted`, `toSpliced`, `with`, `findLast`, `structuredClone`은 타입 오류다. 사용자 키가 든 객체는 `Object.defineProperty`나 펼치기로 만들고 `Object.assign`과 `out[key] = v`를 쓰지 않는다.
- **문구는 글자 그대로 시험한다.** 부록 B의 문구와 부록 D의 `Issue`는 `toBe`·`toEqual`로 전체를 비교한다. `toContain`, 정규식으로 낮추지 않는다.
- **시간 단언은 `editor.perf.test.ts`의 하나뿐이다.** 다른 테스트에 `performance.now()` 단언을 넣지 않는다. 그 파일은 커밋 전에 혼자 15번 돌려 모두 통과해야 한다(5장).
- **`pnpm test`의 시간**: 지금 약 74초다(39개 파일 657개). 이 기능이 더하는 것은 8초 이하로 한다(목표: `unit` 4초, 시간 테스트 파일 3초). 넘으면 크기와 겹치는 사례를 줄이고 조건은 낮추지 않는다. 걸음마다는 그 파일만 돌리고 전체는 관문에서 돌린다. 단계마다 잰 값을 7장에 적는다.
- **테스트를 먼저 쓴다.** 구현 전에 한 번 돌려 실패하는 것을 본다. 핵심 규칙은 코드를 한 곳씩 깨뜨려 테스트가 실패하는지 확인한다(F02 단계 4의 방식).
- **감시는 재는 구간의 경계에서 비운다.** 편집기는 `validateModel`을 `../validate/index.js`에서, `serializeItem`을 `../model/serialize-item.js`에서 가져온다(`../index.js`를 거치지 않는다). 비우는 자리는 정해져 있다.
  - 저장을 보는 테스트: 읽기와 `execute`가 끝난 뒤, **시험하는 `writeChanges` 바로 앞에서** 어댑터 기록과 `serializeItem` 감시를 비운다(`execute`도 같은 함수를 부른다).
  - `validateModel`을 세는 테스트: **`createEditor` 뒤에 비운다**(만들 때 한 번 부른다). 모델을 바꾸는 `execute`가 **정확히 1번**임을 단언한다. 그 뒤 **`undo` 앞에서 비우고** 0번, **`redo` 앞에서 다시 비우고** 0번을 단언한다. 0번 단언은 같은 편집기, 같은 테스트 안에서 1번 단언 뒤에 온다.
- `format/`, `packages/core/src/generated/`, `spikes/`, `packages/core/package.json`, `pnpm-lock.yaml`, CLI 소스(`packages/cli/src/main.ts`, `bin.ts`), `.github/workflows/ci.yml`을 고치지 않는다. 의존성을 더하지 않는다.
- 단계 1에서는 기존 테스트 파일과 `src/testing/`의 기존 파일을 한 글자도 고치지 않는다. 그 뒤 단계에서 기존 테스트 파일을 고치는 곳은 `packages/cli/src/bundle.test.ts`(단계 7, 단계 추가)뿐이다.
- 스테이징은 경로를 지정한다. `git add -A`, `git add .`, `git clean`을 쓰지 않는다. push와 PR 생성을 하지 않는다.
- 줄인 요구를 다시 늘리지 않는다(D-05: 저장 재시도, "같은 내용이면 통과"). 관계·사전·배치 명령을 만들지 않는다(D-00). 하드 링크를 가리는 코드, 어댑터가 나열하지 않는 폴더를 찾아내는 코드를 넣지 않는다(스펙 8장).

## 3. 영향 분석 (Dry-Run)

### 전체 위험도: 중간

거의 다 새 코드다. 기존 동작에 닿는 곳은 단계 1의 `serialize.ts` 떼어 내기 하나이고 F02의 테스트 657개가 고치지 않은 채 지킨다. `writeChanges`는 파일을 지우는 첫 코드다(지우는 대상은 `before`의 `file`뿐이고, 모든 쓰기가 성공한 뒤에만 지우며, 테스트는 메모리 어댑터에서만 돈다). DB, API, 인증 변경은 없다. 지우는 파일은 없다.

### 새로 만드는 파일

| 파일 | 위험 | 단계 |
| --- | --- | --- |
| `packages/core/src/model/serialize-item.ts`, `serialize-item.test.ts`, `serialize-order.test.ts`, `readonly.test.ts` | 중간 | 1 |
| `packages/core/src/command/{types,message,copy,schemas,check}.ts`와 `{message,copy,schemas}.test.ts` | 낮음 | 2 |
| `packages/core/src/command/{slug,ids,paths}.ts`와 `{slug,ids,paths}.test.ts` | 낮음 | 3 |
| `packages/core/src/command/{model-shape,write-changes}.ts`와 `{model-shape,write-changes}.test.ts` | 중간 (파일 삭제) | 4 |
| `packages/core/src/command/{work,working,find,changes,registry,editor}.ts`, `handlers/entity.ts`, `{editor,history,batch,policy,hostile,handler-throws,handlers,cascade}.test.ts` | 중간 | 5 |
| `packages/core/src/command/handlers/{attribute,key,subject-area}.ts`, `{rename,serializable}.test.ts`, `packages/cli/src/core-entry.test.ts` | 낮음 | 6 |
| `packages/core/src/command/{undo-roundtrip,reload}.test.ts`, `editor.perf.test.ts` | 낮음 | 7 |
| `packages/core/src/testing/{commands,recording-fs,wide-model}.ts` | 낮음 | 2, 4, 7 |

### 고치는 파일

| 파일 | 위험 | 내용 | 단계 |
| --- | --- | --- | --- |
| `packages/core/src/model/serialize.ts` | 중간 | 항목 글 만들기를 `serialize-item.ts`로 옮기고 부른다. 매개변수 `ReadonlyModel` | 1 |
| `packages/core/src/model/types.ts` | 낮음 | `DeepReadonly`, `ReadonlyModel` | 1 |
| `packages/core/src/model/write.ts`, `validate/index.ts` | 낮음 | 매개변수 타입만(`writeModel`, `validateModel`, `modelItems`) | 1 |
| `packages/core/src/validate/schema.ts` | 낮음 | `ValidateFunction`을 받는 안쪽 함수로 한 겹 나눔 | 1 |
| `packages/core/src/index.ts` | 낮음 | 공개 이름 아홉(FR-01). 단계는 2장의 표 | 1, 3, 4, 6 |
| `packages/cli/src/bundle.test.ts` | 낮음 | AC-02의 단계 추가 | 7 |
| `docs/format-v0.md` | 낮음 | 70행 교체, 157행 삭제, "프로젝트, 모델, 주제영역" 절에 한 문장 | 8 |
| `CLAUDE.md`, `docs/stage1-backlog.md` | 낮음 | "지금 상태", F03 상태 줄 | 8 |
| `docs/plans/core-commands.md` | 낮음 | 체크박스와 7장. 각 단계의 커밋에 넣는다 | 전부 |

### 저장소 밖과 추적하지 않는 곳

| 대상 | 변경 |
| --- | --- |
| `docs/handoff/core-commands-spikes-before.sha256`, `core-commands-f02-tests.list` | 기준선(결정 5). 단계 8까지 고치지도 지우지도 않는다 |
| `packages/{core,cli,mcp,web}/dist` | 관문마다 지우고 다시 만든다(네 경로를 그대로 적어 `rm -rf`) |
| `node_modules/` | 바뀌지 않는다(`pnpm install`을 다시 할 일이 없다) |

### 되돌리기

브랜치를 지우지 않는다(스펙, 분석, 계획, 결정 기록이 이 브랜치에 있다). 커밋하기 전에는 고친 추적 파일을 `git restore --staged --worktree -- <경로>`로 되돌리고 새 파일은 경로를 하나씩 지정해 지운다. 커밋한 뒤에는 구현 커밋을 뒤에서부터 `git revert`한다(단계 1의 커밋까지 되돌리면 F02의 상태다). push한 뒤에는 이력을 고치지 않고 revert 커밋을 올린다(리드가 한다).

## 4. 구현 순서

모든 단계는 5장의 "단계 관문"을 통과하고 커밋 하나로 끝난다. 커밋 메시지는 영어 명령형이다. 이 파일의 체크박스와 7장 기록은 그 단계의 커밋에 넣는다. 각 걸음은 테스트 파일을 먼저 쓰고 실패를 본 뒤 구현 파일을 쓴다(예외는 1.1과 단계 7이고 거기 적었다).

일정의 목표: 첫날 단계 0~3, 둘째 날 단계 4~5, 셋째 날 단계 6~8. 넘길 것 같으면 범위나 조건을 줄이지 말고 알린다.

### 단계 0: 준비

**목표**: 기준선 둘과 시작 측정값이 있고 계획이 커밋돼 있다.
**위험**: 낮음 · **상태**: 완료 · **수용 기준**: 없음 (AC-17의 "작업 전")

- [x] 0.1 **(다른 어떤 명령보다 먼저)** 저장소 루트에서 기준선을 만든다. 종료 상태가 0이 아니면 멈추고 알린다.

  ```bash
  (set -euo pipefail
   git rev-parse --verify --quiet 'main^{commit}' > /dev/null
   mkdir -p docs/handoff
   b=docs/handoff/core-commands-spikes-before.sha256
   if [ ! -e "$b" ]; then
     { find spikes -type f -print0 | sort -z | xargs -0 sha256sum
       find spikes -type l -printf '%p -> %l\n' | sort
     } > "$b.tmp"
     test -s "$b.tmp"
     mv "$b.tmp" "$b"
   fi
   l=docs/handoff/core-commands-f02-tests.list
   if [ ! -e "$l" ]; then
     git ls-tree -r --name-only main -- packages |
       grep -E '(\.test\.ts$|^packages/core/src/testing/)' > "$l.tmp"
     test -s "$l.tmp"
     mv "$l.tmp" "$l"
   fi
   git check-ignore -q "$b"
   git check-ignore -q "$l")
  ```

- [x] 0.2 `git branch --show-current`가 `feature/core-commands`인지 본다(확인만 한다. 다르면 멈추고 알린다).
- [x] 0.3 5장의 단계 관문을 한 번 돌려 시작 값을 7장에 적는다: 테스트 파일 수와 테스트 수(기대 39개 파일 657개), `pnpm test`의 시간, 목록 파일의 줄 수.
- [x] 0.4 `git add docs/plans/core-commands.md` 뒤 커밋한다(`Add the F03 plan`). 이 커밋의 해시는 단계 1의 커밋에서 7장에 적는다.

### 단계 1: F02 바탕 정리

**목표**: 항목 하나를 글로 바꾸는 함수와 `ReadonlyModel`이 있다. 동작은 그대로다.
**위험**: 중간 · **상태**: 완료 · **수용 기준**: 없음 (AC-01의 타입 부분을 먼저) · **요구사항**: FR-02(타입, 넓히기), FR-10(감시 지점)

- [x] 1.1 **지금 동작을 먼저 고정한다**: `model/serialize-order.test.ts`, `describe('serializeModel: 예외의 경계')`. 아래 넷을 쓰고 **떼어 내기 전의 코드에 먼저 돌려 본 결과를 7장에 적는다.** 지금 코드가 아래 설명과 다르면 **지금 동작이 이긴다**: 본 그대로를 단언으로 고정하고 다른 점을 7장에 적는다. 떼어 낸 뒤에는 이 파일을 고치지 않은 채 통과해야 한다.
  - 모든 항목의 검사가 먼저다: 앞 항목의 글 만들기가 `RangeError`를 던지게 하고(`Document.prototype.toString` 감시) 뒤 항목에 JSON 값이 아닌 데이터를 두면, 뒤 항목의 `must be a JSON value` `TypeError`가 나온다.
  - `yamlText`와 `layoutJson`의 `RangeError`만 바뀌고 `cause`가 원래 오류와 `toBe`다.
  - 첫 훑기(JSON 값 검사)에서 걸리는 둘은 원래 오류가 아니라 `Cannot write <file>: <path> must be a JSON value`인 `TypeError`다: `RangeError`를 던지는 접근자 속성(접근자는 불리지 않는다), 첫 `ownKeys`에서 `RangeError`를 던지는 Proxy.
  - 정규화에서 난 오류는 그대로다: 검사 때는 평범하게 답하고 **둘째** `ownKeys` 호출에서 `RangeError`를 던지는 Proxy는 그 `RangeError` 객체가 바뀌지 않은 채 나온다(`toBe`).
- [x] 1.2 **테스트**: `model/serialize-item.test.ts`, `describe('항목 직렬화')`. 예제 29개 항목마다 `serializeItem`의 글이 `serializeModel`의 그 파일 글과 같다. 1.1의 뒤 셋이 `serializeItem`에서도 같은 결과다. **구현**: `model/serialize-item.ts`, `serialize.ts`가 그것을 부른다(결정 4).
- [x] 1.3 **테스트**: `model/readonly.test.ts`, `describe('읽기 전용 모델')`. `ReadonlyModel` 값이 `validateModel`, `serializeModel`, `writeModel`에 그대로 들어가고 결과가 `Model`로 넘긴 것과 `toEqual`이다. `Model`이 `ReadonlyModel`에 대입된다. `@ts-expect-error` 셋(항목 데이터의 필드 대입, 목록 `push`, `ext` 안쪽 대입). 타입 검사는 `pnpm lint`가 한다. **구현**: `model/types.ts`, 그리고 `validateModel`·`modelItems`·`serializeModel`·`modelFiles`·`writeModel`의 매개변수. 본문은 고치지 않는다. `index.ts`에 타입 `ReadonlyModel`.
- [x] 1.4 `validate/schema.ts`: `schemaIssues`의 몸통을 `ValidateFunction`을 받는 안쪽 함수로 옮기고 `schemaIssues`가 그것을 부른다. 새 테스트는 없다(기존 `schema.test.ts`가 지킨다).
- [x] 1.5 **검증**: 5장의 단계 관문, 그리고 `main`에 있던 테스트와 도우미 파일이 작업 폴더와 색인 양쪽에서 바이트까지 같다는 증명(종료 상태 0).

  ```bash
  (set -euo pipefail
   git rev-parse --verify --quiet 'main^{commit}' > /dev/null
   mapfile -t f < docs/handoff/core-commands-f02-tests.list
   test "${#f[@]}" -gt 0
   git diff --quiet main -- "${f[@]}"
   git diff --cached --quiet main -- "${f[@]}")
  ```

- [x] 1.6 커밋한다(`Split out the per-item serializer and add ReadonlyModel`). 0.4의 해시를 7장에 적어 함께 넣는다.

### 단계 2: 입력 층

**목표**: 믿을 수 없는 값 하나를 "검사를 통과한 평범한 사본"이나 "거부 문구 하나"로 바꿀 수 있다. `index.ts`는 바뀌지 않는다(결정 2).
**위험**: 낮음 · **상태**: 완료 · **수용 기준**: 없음 (AC-01의 스키마 부분, AC-11의 표를 먼저) · **요구사항**: FR-03

- [x] 2.1 `command/types.ts`: 부록 A의 17종, 부록 B의 코드 여덟, FR-01의 `Editor`·`CommandResult`·`Issues`. 타입만이다.
- [x] 2.2 **테스트**: `command/message.test.ts`, `describe('거부 문구: 한 줄')`. CLI `oneLine`과 같은 문자 집합의 이스케이프(분석 1.3절 마지막 줄), 역슬래시와 짝을 이룬 서로게이트는 그대로, 코드 포인트 500개는 그대로이고 501개는 500개 뒤 `…`, `AWKWARD_STRINGS`와 무작위 글에 던지지 않고 결과에 줄바꿈이 없다. **구현**: `command/message.ts`. CLI의 코드를 가져오지 않고 규칙을 옮겨 적는다.
- [x] 2.3 **테스트**: `testing/commands.ts`에 `REJECTED_INPUTS`, `ACCEPTED_INPUTS`(AC-11의 두 표 전부)를 적고, `command/copy.test.ts`, `describe('믿을 수 없는 입력: 복사')`가 FR-03의 1~2에 해당하는 줄을 돌린다: 부록 B의 첫 다섯 문구, 한도의 경계(32단/33단, 100000/100001, 1000000/1000001), 한도의 순서(깊이 → 값 → 글)와 "빼기 전에 센다", 사본이 입력과 객체를 공유하지 않는다, `__proto__`가 자기 속성이다. **구현**: `command/copy.ts`(분석 4.7).
- [x] 2.4 **테스트**: `testing/commands.ts`에 `SAMPLE_COMMANDS`(명령과 시작 모델만. 기대값은 단계 5~6에서 채운다)를 적고, `command/schemas.test.ts`, `describe('명령 스키마')`가 AC-01의 스키마 문장을 모두 단언한다: 키가 17종, 준비 과정과 `schemaAjv()`로 컴파일됨, 표본이 17종을 덮고 모두 통과, 부록 B의 스키마 문구 전부, 깊이 얼어 있음, 옮겨 적은 필드 규칙이 `schemaAt`의 것과 `toEqual`, 필수 키가 빠지고 모르는 키가 든 명령의 문구, `type` 문구 넷(없음, 글 아님, 모르는 종류, 50 코드 단위 자르기). **구현**: `command/schemas.ts`, `command/check.ts`(결정 6). 스키마 쓰는 규칙은 FR-03의 "명령 스키마" 세 항목과 분석 3.2다.
- [x] 2.5 **검증**: 5장의 단계 관문. `pnpm exec vitest run -t '명령 스키마'`에서 통과한 테스트가 1개 이상이다.
- [x] 2.6 커밋한다(`Add the command input layer: bounded copy, schemas, messages`).

### 단계 3: ID와 경로

**목표**: 이름에서 ID 후보를 만들고, 후보가 쓸 수 있는지와 그 이유를 답하고, 새 항목의 경로를 만든다. 편집기는 아직 없다.
**위험**: 낮음 · **상태**: 완료 · **수용 기준**: 없음 (AC-08, AC-09를 먼저) · **요구사항**: FR-05, FR-06, FR-10(후보 수)

- [x] 3.1 **테스트**: `command/slug.test.ts`, `describe('ID 만들기: 슬러그')`. AC-08의 이름 → ID 줄 가운데 슬러그가 비지 않는 것(`Order Item`부터 `값` 20개까지)을 슬러그 함수에 그대로, 슬러그가 비는 입력(`漢字`, `🙂`, `___`, 공백뿐, 257번째 글자부터만 영문자)은 빈 글, 부록 C의 예 여섯과 `엔터티`, 한글 음절 11172개 전부가 `^[a-z]+$`, `AWKWARD_STRINGS`와 무작위 글에 던지지 않고 결과가 빈 글이거나 `^[a-z0-9][a-z0-9_]{0,62}$`이며 `_`로 끝나지 않는다. **구현**: `command/slug.ts`(표 68개 글을 코드에 적는다).
- [x] 3.2 **테스트**: `command/ids.test.ts`, `describe('ID 만들기')`(이 단계에서는 함수 수준). 재료의 순서와 **빈 슬러그의 대체 낱말**(`entity`, `attribute`, `area`, `pk`·`ak`·`ie`. 257번째 글자 사례의 `entity`가 여기다), 후보 순서 1~3과 63자 맞추기, 스키마 접두 (가)~(바), 슬러그를 ID로 가진 엔터티가 둘인 경우(분석 I2), 거부 이유 다섯의 문구와 우선순위, Windows 이름은 엔터티와 주제영역에만, 이름 공간 넷, 3번 이유는 첫 후보에서 거부. **후보 수**(FR-10. 가짜 인터페이스가 물어본 후보 글을 적는다): 속성 `x`, `x_2`, `x_3`이 있는 엔터티의 넷째 `x`는 `x_4`이고 물어본 후보가 넷이다. AC-08의 자르기 사례(스키마 접두와 접미사가 잘려 같은 글이 다시 나오는 엔터티)에서는 물어본 후보 글에 **겹치는 것이 없고** 그 수가 FR-10의 상한 이하이며 결과가 AC-08의 값이다. **구현**: `command/ids.ts`(결정 7).
- [x] 3.3 **테스트**: `command/paths.test.ts`. `describe('새 파일 경로: 비교 키')`: `pathKey`가 대소문자만 다른 글, NFC와 NFD로 적은 `é`, 전각과 반각 글자를 같은 키로 만들고 다른 글자는 다른 키로 남기며, 외톨이 서로게이트에 던지지 않는다. `describe('새 파일 경로')`(함수 수준): `dir`이 `billing`과 `Billing`인 경로(`dir`은 그대로이고 파일 이름만 소문자다), 키가 같아 쓰이는 경로, 처음 경로와 글자는 다르고 키가 같은 경우와 문구에 적을 경로(코드 단위 순 첫 것), 사전 폴더(`dictionaries`, 없으면 `dictionary`, 절대 경로 항목 제외, 연 폴더 자신이면 `.`), 예약 경로에서 처음 모델의 경로를 뺌. `listReservedFiles`: AC-09의 `a.yaml`·폴더 `b.yaml`·깨진 `c.yaml`, `list`가 정확히 두 번, `dir`이 있는 모델. **구현**: `command/paths.ts`(결정 8).
- [x] 3.4 `index.ts`에 `listReservedFiles`.
- [x] 3.5 **검증**: 5장의 단계 관문.
- [x] 3.6 커밋한다(`Add id generation and new file paths`).

### 단계 4: 저장

**목표**: `writeChanges`가 두 모델의 차이만 쓰고 지운다. 손으로 만든 모델로 FR-09 전부가 시험된다.
**위험**: 중간 · **상태**: 완료 · **수용 기준**: 없음 (AC-05, AC-09, AC-14를 먼저) · **요구사항**: FR-09, FR-01(조건 1~4), FR-10(쓸 항목만 직렬화)

- [x] 4.1 `testing/recording-fs.ts`: 어댑터를 감싸 호출(`readText`, `writeText`, `remove`, `list`와 경로)을 순서대로 적고 기록을 비울 수 있다. 넷을 따로 켤 수 있다: 고른 폴더의 `list` 실패, 고른 경로의 `readText` 실패, 고른 경로의 `writeText` 실패(모두 `EACCES`), 읽히기는 하지만 부모의 나열에서는 빠지는 경로.
- [x] 4.2 **테스트**: `command/model-shape.test.ts`, `describe('편집기 만들기: 모델의 조건')`. AC-14의 입력 아홉마다 FR-01의 이유 문구, 받는 것 셋(`../dictionary/a.yaml`인 사전 하나, 검증 오류가 있는 모델, 매니페스트 없는 모델). **구현**: `command/model-shape.ts`. 한 번 훑고 `Set`으로 겹침을 본다.
- [x] 4.3 **테스트**: `command/write-changes.test.ts`, `describe('저장의 조건')`. 편집기 없이 `before`를 읽고 `after`를 펼치기로 만든다. 어댑터 기록과 `serializeItem` 감시는 `writeChanges` 바로 앞에서 비운다. AC-05의 "조건"과 "새 경로의 보호" 가운데 `writeChanges`만의 것 전부와 FR-09의 항목마다 하나 이상이다. **검사 다섯 단계에서 거부되는 사례**는 모두 `writeText`와 `remove`가 0번이다.
  - 조건 위반 셋(어댑터 호출 0번). 비교 키가 같은 쌍: 손댄 쌍은 거부, 손대지 않은 쌍은 성공, 걸리는 쌍이 둘이면 FR-09의 첫 쌍, **새 항목 둘 `entities/É.yaml`과 `entities/é.yaml`은 거부**(어댑터 호출 0번. 문구는 FR-09의 것 그대로다). 직렬화가 둘 실패하면 경로 순으로 첫 것의 오류이고 어댑터 호출 0번.
  - 차지된 새 경로: 파일, 같은 글의 파일, 같은 이름의 폴더, 이름의 키가 같고 글자가 다른 폴더(폴더 `entities/Customer.yaml`이 있고 `after`가 `entities/old.yaml`을 빼고 `entities/customer.yaml`을 더한다. 문구의 경로는 새 경로이고 `old.yaml`의 바이트가 그대로다), 그런 파일, **나열에는 없고 읽기에서만 보이는 파일**(4.1의 넷째).
  - **차례로 보고 첫 실패에서 멈춘다**(결정 8): 한 폴더의 나열에 차지된 새 경로가 둘이면 어댑터가 준 순서와 상관없이 경로 순으로 첫 것. `entities`에서 차지된 경로를 찾으면 `subject-areas`는 나열하지 않는다(그 `list`가 실패하게 해 두어도 `entities`의 문구다). `entities`의 `list`가 실패하면 그 오류이고 읽기는 0번. `list`와 읽기가 둘 다 실패하게 하면 `list`의 오류. 나열에서 찾은 것이 읽기에서만 보이는 것보다 먼저(읽기 쪽 경로가 앞이어도). 읽기 단계에서는 경로 순: 앞 경로의 `EACCES`가 뒤 경로의 "읽기에서만 보이는 차지"보다 먼저이고, 읽기에서만 보이는 둘 가운데는 첫 것.
  - **쓰고 나서 지운다**: 기록에서 모든 `writeText`가 모든 `remove`보다 앞이고 각각 경로 순이다. **쓰기 실패**(AC-05): `after`가 `entities/old.yaml`을 빼고 새 `entities/a.yaml`, `entities/b.yaml`을 더하며 `entities/b.yaml`의 `writeText`가 실패한다. 그 오류로 거부되고, `writeText` 호출이 **정확히 2번**(`a`, 실패한 `b`의 순)이며 `remove`가 0번이고 `old.yaml`의 바이트가 그대로다. `before`의 경로만 지움(`entities/stray.yaml`, `entities-old/x.yaml`이 남는다), 이미 없는 파일의 삭제도 `removed`에.
  - 그 밖: 매니페스트와 사전은 읽지도 쓰지도 않음, 객체가 다른 항목만 `serializeItem`되고 읽힘(같은 테스트 파일에서 1개인 저장과 0개인 저장), 글이 같으면 쓰지 않음, 나열은 새 경로가 있는 폴더만 한 번씩이고 모든 읽기보다 먼저, 결과의 정렬.
  - **구현**: `command/write-changes.ts`. 경로 비교는 `pathKey`로만 한다.
- [x] 4.4 `index.ts`에 `writeChanges`.
- [x] 4.5 **검증**: 5장의 단계 관문.
- [x] 4.6 커밋한다(`Add writeChanges: write and remove only what changed`).

### 단계 5: 편집기와 `entity.*`

**목표**: 편집기가 모듈 안에 있고 `entity.create`·`update`·`delete`와 `batch`가 실행, 검증, 실행 취소된다. `index.ts`는 바뀌지 않는다(결정 2).
**위험**: 중간 · **상태**: 완료 · **수용 기준**: AC-14 · **요구사항**: FR-01, FR-02, FR-04, FR-08, FR-07(`entity.*`와 그 연쇄), FR-10(일의 수)

- [x] 5.1 **테스트**(구현 전에 모두 쓴다. `./editor.js`에서 가져온다. `entity.*`로 되지 않는 줄은 `test.todo`로 이름만 두고 단계 6에서 채운다. 감시를 비우는 자리는 2장 제약 그대로다).
  - `command/editor.test.ts`, `describe('편집기 만들기')`: AC-14 전부(`internal`은 재진입으로 낸다). 덧붙여 처음 경로가 상태임을 보인다: `entities/Customer.yaml`을 읽어 그 엔터티를 지운 편집기와, 그 결과 모델로 새로 만든 편집기는 `id: customer`의 `entity.create`에 다른 결과를 낸다(FR-01, FR-06).
  - `command/history.test.ts`, `describe('이력')`: AC-12 가운데 `entity.*`로 되는 것(마지막 문장은 `test.todo`)과 AC-15의 뒷부분(`undo`·`redo`에서 `validateModel` 0번, 모델과 `issues`가 스냅숏의 것과 `toBe`).
  - `command/batch.test.ts`, `describe('묶음')`: AC-13 가운데 `entity.*`로 되는 것(실패의 순서 셋, 봉투, 묶음 안의 묶음, 끝의 비교, 지우기만과 그 저장, `ids`, `validateModel` 호출 수).
  - 같은 파일의 **일의 수**(결정 9). 엔터티 1000개인 모델(오류 0개)에서, `id`를 직접 준 서로 다른 `entity.create` n개의 묶음을 n = 250, 500, 1000으로 새 편집기에 한 번씩 실행한다. 감시는 `createEditor` 뒤에 비운다. **먼저** 세 묶음 모두 `ok: true`이고 모델의 엔터티가 정확히 n개 늘었음을 단언한다(거부된 묶음의 수를 세지 않게). T(n) = `noteWork`가 받은 칸 수의 합 + `serializeItem` 호출 수 + `validateModel` 호출 수, Δ250 = T(500) − T(250), Δ500 = T(1000) − T(500)이다. 단언: `validateModel` 1번, `'index-build'` 호출 수가 세 n에서 같다, `|Δ500 − 2·Δ250| ≤ tolerance`(선형이면 Δ500이 Δ250의 두 배다), `Δ500 ≤ 500 · c`(하위 명령 하나에 c칸 이하). `tolerance`(고정 비용 몫의 작은 수)와 `c`는 구현자가 통과한 실행에서 본 수로 정하고, 그 값과 T(250)·T(500)·T(1000)을 7장에 적는다. 구현 뒤 **변이 둘**을 따로 넣어 실패를 보고 되돌린다(7장에 적는다): (1) 항목을 더할 때마다 엔터티 목록 전체를 복사한다 → n = 250과 1000 사이에 알린 칸이 백만 단위로 늘어 두 Δ 단언이 모두 깨진다. (2) 하위 명령마다 색인을 다시 만든다 → `'index-build'` 호출 수가 n에 따라 달라진다.
  - `command/policy.test.ts`, `describe('검증 정책')`: 부록 D의 `entity.*` 행 셋, AC-07 (나), 문구 `The command would break the model: …`. **술어 (가)**: 거부의 `issues`에 새 오류만, 새 오류가 없으면 전부. **술어 (나)**: 바뀌지 않은 `Issue`가 앞 목록의 객체와 `toBe`이고, `severity`만 다르거나 `line`·`column`만 다른 `Issue`는 **다시 쓰이지 않는다**(다시 쓰기 순수 함수를 따로 내보내 손으로 만든 `Issue`로 시험한다. 지금 검증기는 위치 없는 오류만 낸다).
  - `command/hostile.test.ts`, `describe('믿을 수 없는 입력')`·`describe('거부 문구')`: 단계 2의 두 표를 `execute`로(모델이 전과 `toBe`), 재진입, 실행 뒤 명령 객체를 고쳐도 모델이 그대로.
  - `command/handler-throws.test.ts`: `./handlers/entity.js`를 바꿔치기해 `internal`과 `Unexpected error: <메시지>`, `Error`가 아닌 값, `String()`도 던지는 값(`unknown error`), 그 뒤의 호출이 `busy`가 아님.
  - `command/handlers.test.ts` `describe('명령 동작')`, `command/cascade.test.ts` `describe('연쇄와 대상')`: `entity.*`의 줄(AC-06의 엔터티 부분, AC-10의 첫 문장과 엔터티의 `not-found`·`ambiguous-target`).
- [x] 5.2 **구현**: `command/work.ts`, `working.ts`, `find.ts`, `changes.ts`, `handlers/entity.ts`, `registry.ts`, `editor.ts`. 지킬 것: 결정 8·9의 설계 제약, 분석 4.6의 E1~E8, 4.9, 권고 8과 2장의 권고 9 줄. 단일 명령은 하위 명령 하나의 묶음과 같은 길로 돈다. `busy`는 `try/finally`로 푼다. 모델·`issues`·이력은 끝에 한꺼번에 바꾼다. `createEditor`의 조건은 단계 4의 `checkEditable`이다.
- [x] 5.3 `SAMPLE_COMMANDS`의 `entity.*` 기대값을 채운다.
- [x] 5.4 **검증**: 5장의 단계 관문. `-t '편집기 만들기'`에서 통과가 1개 이상이고 `editor.test.ts`에 `todo`가 없다.
- [x] 5.5 커밋한다(`Add the editor: execute, undo, redo, batch and the entity commands`).

### 단계 6: 나머지 처리 13종과 공개

**목표**: 17종이 모두 있고 `@erdmaker/core`가 편집기를 내보낸다. 편집기와 처리에 대한 AC가 닫힌다.
**위험**: 중간 · **상태**: 완료 · **수용 기준**: AC-01, AC-04, AC-06, AC-07, AC-08, AC-10, AC-11, AC-12, AC-13 · **요구사항**: FR-07, FR-05·FR-06(편집기를 거쳐), FR-01(공개 이름)

- [x] 6.1 **테스트**: 단계 5의 `test.todo`를 모두 채우고 다음을 더한다.
  - `handlers.test.ts` "명령 동작": AC-06 전부(17종의 표본 기대값, 바뀐 것이 없는 사례 일곱, 빈 것 정리, `set.physical: {}`).
  - `cascade.test.ts` "연쇄와 대상": AC-10 전부(저장 결과 포함. 배치에 노드를 넣은 모델은 손으로 만들어 새 편집기에 넘긴다. 분석 V18).
  - `rename.test.ts` "이름 변경": AC-04 전부.
  - `ids.test.ts` "ID 만들기": AC-08 전부를 `execute`로(만든 뒤 `issues` 0개, `id-taken`, 지우고 다시 만들기, 자르기 사례).
  - `paths.test.ts` "새 파일 경로": AC-09의 "다시 읽기" 앞까지를 편집기로(예약 경로, 대소문자 세 사례, 폴더 `b.yaml`의 저장 거부, `old`를 지우고 `customer`를 만드는 `batch`와 폴더 `entities/Customer.yaml`의 저장 거부).
  - `history.test.ts` "이력": AC-12의 마지막 문장(AC-07 (가)의 모델, (마)의 `key.delete`, `undo` 뒤 `R03`).
  - `policy.test.ts` "검증 정책": 부록 D의 나머지 행, AC-07 (가)·(다)·(라)·(마).
  - `batch.test.ts` "묶음": 세 명령의 묶음, `pk` 지우고 다시 만들기, 다시 만든 항목이 전 항목과 `toBe`.
  - `hostile.test.ts`: 표본 명령마다 넣은 값이 명령과도 모델의 다른 곳과도 객체를 공유하지 않는다.
  - `serializable.test.ts`, `describe('명령 직렬화')`: AC-01의 왕복 문장, `-0`, 편집기에 대한 `@ts-expect-error` 셋.
  - `packages/cli/src/core-entry.test.ts`, `describe('명령 직렬화: 공개 이름')`: **빌드한 진입점** `@erdmaker/core`에서(패키지의 `exports`를 거쳐) 값 넷이 함수와 얼린 객체로, 타입 다섯이 타입 검사로 가져와진다. F02의 공개 값도 그대로 있다.
- [x] 6.2 **구현**: `handlers/attribute.ts`, `key.ts`, `subject-area.ts`(목록을 고치는 일은 결정 9의 도우미로), `registry.ts`에 등록. `SAMPLE_COMMANDS`의 나머지 기대값. `index.ts`에 `createEditor`, `commandSchemas`, 타입 넷.
- [x] 6.3 **검증**: 5장의 단계 관문. `command/` 아래에 `test.todo`가 없다(`grep -rn 'test.todo' packages/core/src/command`의 종료 상태가 1이고 출력이 없다. 2이면 실패다). 닫는 AC 아홉의 `describe` 이름마다 `-t`로 통과가 1개 이상이다.
- [x] 6.4 커밋한다(`Add the attribute, key and subject area commands and export the editor`).

### 단계 7: 통합, 번들, 시간

**목표**: 명령 → 저장 → 다시 읽기가 끝에서 끝까지 맞고, 번들과 방지선이 통과한다. 제품 코드는 바뀌지 않는 것이 정상이고, 그래서 **새 단언은 쓰자마자 통과할 수 있다.** 걸음마다 적힌 변이 하나를 제품 코드에 잠깐 넣어 그 걸음의 테스트가 적힌 단언에서 실패하는 것을 보고 되돌린다. 본 실패를 7장에 적는다. 테스트가 진짜 결함을 찾으면 실패하는 테스트를 남기고 고친 뒤 7장에 적는다.
**위험**: 낮음 · **상태**: 완료 · **수용 기준**: AC-02, AC-03, AC-05, AC-09, AC-15 · **요구사항**: FR-08~FR-10

- [x] 7.1 `command/undo-roundtrip.test.ts`, `describe('실행 취소 왕복')`: AC-03 전부(표본마다 기대 `written`·`removed`, 주석 사례의 어댑터 호출 0번). **변이**: `undo`가 스냅숏의 모델 대신 그 얕은 사본을 **`editor.model`로 내놓게** 한다(결과의 `model`도 그 사본이다). 실패해야 하는 것은 **"`editor.model`이 시작 모델과 `toBe`" 단언**이다(항목 객체는 그대로라 호출 0번 단언은 통과한다. 그것으로 실패를 확인한 것으로 치지 않는다).
- [x] 7.2 `command/write-changes.test.ts`, `describe('바뀐 파일만')`: AC-05의 명령으로 하는 사례 전부(직렬화·읽기·쓰기가 하나, 나머지 28개 바이트, `edges` 그대로, 쓰기와 지우기의 순서, `definiton` 사례와 `listReservedFiles`를 준 사례, 폴더 `entities/Customer.yaml` 사례). 감시는 `writeChanges` 바로 앞에서 비운다. 변이를 위한 사례 하나를 더한다: **AC-13의 묶음**(예제에 만든 관계 없는 엔터티를 지우고 같은 `id`와 값으로 다시 만들면서 `order.ord_dtm`의 `definition`을 바꾼다) 뒤의 저장에서 `serializeItem`된 것과 읽힌 것이 `entities/order.yaml` 하나뿐이다. **변이**: 손댔지만 글이 같은 항목을 원래 객체로 되돌리는 것을 끈다(다시 만든 엔터티도 직렬화되고 읽혀 이 단언이 깨진다).
- [x] 7.3 `command/reload.test.ts`, `describe('다시 읽기')`: AC-09의 마지막 문단. **변이**: 새 엔터티의 경로를 `entities/<id>.yml`로 만든다(다시 읽은 모델에 그 엔터티가 없다).
- [x] 7.4 `packages/cli/src/bundle.test.ts`: AC-02의 단계. 명령은 `vm` 컨텍스트 안에서 만들고 결과는 안에서 `JSON.stringify`해 꺼낸다(다른 realm의 객체는 복사에서 거부된다. 분석 4.7). **변이**: `index.ts`에서 `writeChanges`를 빼고 다시 빌드한다.
- [x] 7.5 `testing/wide-model.ts`(엔터티 n개 × 속성 m개 + 전부 든 주제영역. 오류 0개임을 테스트가 단언한다), `command/editor.perf.test.ts`: AC-15 하나. 제한 시간 `60_000`을 테스트에 적는다. 모델과 편집기 만들기, 준비 실행 1회, 실행마다의 `ok: true`와 "모델이 다른 객체" 단언은 재는 구간 밖이다. 두 값을 번갈아 주므로 실행 사이에 되돌릴 상태가 없다. **변이**: `execute` 안에 `Date.now()`로 300 ms를 채우는 빈 반복을 넣는다. 벽시계로 기다리므로 컴퓨터가 아무리 빨라도 다섯 번 모두 300 ms 이상이고 가장 빠른 것도 250 ms를 넘는다. 검증을 더 부르는 변이는 여기서 쓰지 않는다(빠른 컴퓨터에서는 250 ms 안에 들 수 있다. 그것은 5.1의 "정확히 1번" 단언이 잡는다).
- [x] 7.6 **검증**: 변이가 남지 않았다는 증명(둘 다 종료 상태 0), 5장의 단계 관문, 시간 테스트 15번. `pnpm test`를 세 번 이어 돌려 모두 통과하고 시간이 단계 0의 값 + 8초 이하다.

  ```bash
  (set -euo pipefail
   p=(packages/core/src/command packages/core/src/model packages/core/src/index.ts ':(exclude)*.test.ts')
   git diff --quiet HEAD -- "${p[@]}"
   git diff --cached --quiet HEAD -- "${p[@]}")
  ```

- [x] 7.7 커밋한다(`Add the round trip, bundle and time tests for commands`).

### 단계 8: 문서와 마무리

**목표**: 문서가 FR-11과 맞고 로컬에서 닫을 수 있는 AC가 모두 닫혔다.
**위험**: 낮음 · **상태**: 대기 · **수용 기준**: AC-16, AC-17, AC-18(로컬 부분) · **요구사항**: FR-11

- [ ] 8.1 `docs/format-v0.md`: FR-11의 셋. 5장의 AC-16 스크립트가 찾는 글을 글자 그대로 넣는다.
- [ ] 8.2 `CLAUDE.md`의 "지금 상태"에 `createEditor`와 F03까지 들어왔다는 것, `pnpm test`의 시간이 달라졌으면 "명령"의 그 문장. `pnpm exec prettier --write CLAUDE.md`. `docs/stage1-backlog.md`에 F03 상태 줄(결정 10).
- [ ] 8.3 **검증**: 5장의 단계 관문, AC-16, AC-18의 `dependencies` 확인(5장). AC-16을 돌리기 전에 스펙 6.1의 스크립트와 5장의 것을 `diff`로 본다. 차이는 스펙 쪽에만 있는 두 줄(`git rev-parse --verify --quiet 'main^{commit}'`과 `git diff --quiet main -- format/ packages/core/src/generated/`)뿐이어야 한다. 그 밖의 차이가 있으면 멈추고 알린다.

  ```bash
  (set -euo pipefail
   block() { awk -v from="$1" '$0 ~ from {s=1} s && /```bash/ {on=1; next} on && /```/ {exit} on' "$2" | sed 's/^ *//'; }
   diff <(block '^### 6\.1' docs/specs/core-commands.md) <(block '^- \[.\] AC-16' docs/plans/core-commands.md))
  ```

- [ ] 8.4 커밋한다(`Update the docs for the command API`). `git status --porcelain --untracked-files=no`가 비어야 한다. 리드에게 넘긴다(결정 11). **AC-18의 `gh pr checks`는 "리드 확인 대기"로 열어 둔다.** 리드가 PR의 마지막 머리에서 확인한 뒤 닫는다.

## 5. 품질 관문

모두 저장소 루트에서 실행한다. **판정은 괄호 묶음의 종료 상태다.** 뒤에 `echo`를 붙이지 않는다(붙이면 `echo`의 상태가 남는다). 상태를 찍어 보려면 `s=$?; echo "exit=$s"; (exit "$s")`로 한다. 명령은 한 줄에 하나씩 둔다(`&&`로 이으면 `set -e`가 가운데 실패에서 멈추지 않는다). Git 오류도 실패가 되도록 `test -z "$(git …)"` 꼴과 부정한 `grep`을 쓰지 않는다.

### 단계 관문 (모든 단계의 "검증"에서)

```bash
(set -euo pipefail
 git rev-parse --verify --quiet 'main^{commit}' > /dev/null
 rm -rf ./packages/core/dist ./packages/cli/dist ./packages/mcp/dist ./packages/web/dist
 pnpm build
 pnpm test
 pnpm lint
 pnpm validate:format
 out=$(find packages/core/dist packages/cli/dist packages/mcp/dist \
   \( -name '*.test.*' -o -path '*/testing/*' \))
 test -z "$out"
 kept=(format packages/core/src/generated packages/core/package.json pnpm-lock.yaml)
 git diff --quiet main -- "${kept[@]}"
 git diff --cached --quiet main -- "${kept[@]}"
 extra=$(git status --porcelain --ignored -- format packages/core/src/generated)
 test -z "$extra"
 test -s docs/handoff/core-commands-spikes-before.sha256
 { find spikes -type f -print0 | sort -z | xargs -0 sha256sum
   find spikes -type l -printf '%p -> %l\n' | sort
 } | diff docs/handoff/core-commands-spikes-before.sha256 - > /dev/null)
```

- 종료 상태가 0이어야 한다. 순서를 바꾸지 않는다(`test`의 번들, `lint`의 타입 검사, `validate:format`이 `dist`를 읽는다).
- `find`는 테스트와 도우미가 `dist`에 없음을 본다. `git diff --quiet`(작업 폴더)와 `--cached --quiet`(색인)는 `format/`, 생성물, 의존성이 `main`과 같음을 따로따로 본다. `git status --porcelain --ignored`는 그 두 폴더에 새 파일이 무시 대상까지 포함해 없음을 본다. 마지막은 `spikes/`가 기준선과 같음을 본다.
- 0이 아니면 뒤쪽 검사는 출력이 없으므로 하나씩 따로 돌려 어느 것인지 본다. `pnpm test`의 시간과 테스트 수를 7장에 적는다.

### 시간 테스트 (단계 7, 그 뒤 그 파일이나 편집기 코드를 고친 모든 커밋 전)

```bash
(set -euo pipefail
 for ((i = 1; i <= 15; i++)); do
   pnpm exec vitest run --project perf packages/core/src/command/editor.perf.test.ts ||
     { echo "failed at run $i" >&2; exit 1; }
 done)
```

종료 상태 0(15번 모두 통과)이어야 한다. 실패하면 한도를 올리거나 재시도를 더하지 않는다. 원인을 찾아 코드를 고치고 잰 값과 함께 7장에 적는다. 250 ms 한도는 스펙의 것이라 바꾸지 않는다.

### AC별 확인

- [ ] AC-01~AC-15: 1장의 표가 적은 `describe` 이름의 테스트가 `pnpm test`에 있고 통과한다. 닫을 때 `pnpm exec vitest run -t '<이름>'`에서 통과한 테스트가 1개 이상인지 본다(이름이 틀려 0개가 돈 것을 통과로 치지 않는다).
- [ ] AC-16 (단계 8): 아래가 종료 0이다. **이 스크립트는 스펙 6.1의 스크립트와 같은 글이어야 한다. 예외는 스펙 쪽에만 있는 형식 확인 두 줄이다**(8.3이 `diff`로 본다. 한쪽을 고치면 다른 쪽도 고친다). 형식과 생성물이 그대로인지는 단계 관문이 판정한다. "없어야 하는 글"은 `grep`의 종료 상태가 정확히 1일 때만 통과다(2는 실패).

  ```bash
  (set -euo pipefail
   absent() { local s=0; grep -q -- "$1" "$2" || s=$?; test "$s" -eq 1; }
   sec=$(awk '/^### 엔터티/{on=1;next} /^### /{on=0} on' docs/format-v0.md)
   absent '한글 이름만 있는 객체' docs/format-v0.md
   absent '나중에 만드는 쪽의 ID 앞에 스키마 이름을 붙인다' docs/format-v0.md
   grep -q '그 엔터티와 테이블명이 같고 스키마가 다르면' <<< "$sec"
   grep -q '한글은 로마자로 옮긴다' <<< "$sec"
   grep -q 'docs/specs/core-commands.md' docs/format-v0.md
   grep -q '사전 폴더를 `entities`' docs/format-v0.md
   grep -q 'createEditor' CLAUDE.md)
  ```

- [ ] AC-17 (단계 8): 단계 관문의 마지막 검사.
- [ ] AC-18 로컬 (단계 8): 단계 관문, 그리고 종료 상태 0인

  ```bash
  node -e "const d = require('./packages/core/package.json').dependencies;
  process.exit(JSON.stringify(Object.keys(d).sort()) === '[\"ajv\",\"yaml\"]' ? 0 : 1)"
  ```

- [ ] AC-18 PR (리드): `gh pr checks`. 넘길 때는 "대기"다.

## 6. 위험과 참고

### 위험

| # | 위험 | 가능성 | 대응 |
| --- | --- | --- | --- |
| 1 | **스펙의 최근 수정이 다시 리뷰받지 않았다**: D-05의 덜어내기, 분석이 찾은 빈 곳, 계획 리뷰 1~3회차의 수정(FR-01 결정성, FR-05·FR-10의 서로 다른 후보, FR-06·FR-09의 비교 키, FR-09의 검사 순서와 "쓰고 나서 지운다", AC-05, AC-08, AC-09, 6.1, 8장) | 중간 | 문장끼리, 또는 문장과 AC가 맞지 않으면 **멈추고 리드에게 알린다.** 한쪽을 골라 구현하지 않는다. 이 계획의 사례(3.2, 3.3, 4.3 등)가 스펙과 달라 보여도 같다. 스펙을 고치면 Codex 확인이 붙는다(D-00) |
| 2 | 스펙 6장의 사례는 부록 D와 AC-07의 셋 말고는 구현 전에 쓴 기대값이다(스펙 7장) | 중간 | 틀리면 같은 조건을 검사하도록 기대값을 고치고 7장에 적는다. 조건을 낮추지 않는다. 기대값이 아니라 규칙이 틀린 것이면 위험 1이다 |
| 3 | **F04 전에는 관계에 묶인 것을 거의 고치지 못한다.** 예제의 엔터티 10개가 모두 그렇고 부록 D의 명령은 거부된다 | 확실 | 정상 동작이다. 지우기와 이름·타입 변경의 성공 사례는 빈 모델이나 예제에 새로 만든 엔터티로 쓴다. 관계를 고치거나 전파하는 코드를 넣지 않는다 |
| 4 | **250 ms 방지선은 컴퓨터에 따라 다르다.** 이 컴퓨터에서 약 65 ms(여유 3.8배)이고 CI에서는 재지 않았다(분석 4.2) | 낮음 | 로컬은 15번으로 본다. CI에서 실패하면 한도, 횟수, 재시도를 고치지 말고 잰 값과 함께 리드에게 알린다 |
| 5 | 저장 전 검사가 차지된 자리를 놓친다(어댑터가 나열하지 않는 폴더: Node 어댑터의 32단 한도) | 낮음 | 찾아내는 코드를 더하지 않는다(스펙 8장). 쓰기가 먼저라 쓰기가 실패하면 아무것도 지워지지 않는다. 4.3이 그 순서와 "쓰기 실패 → `remove` 0번"을 고정한다 |
| 6 | 단계 1의 떼어 내기가 F02의 동작을 바꾼다(검사 순서, 예외의 경계, 문구, 글) | 낮음 | 1.1이 떼기 전에 지금 동작을 실행으로 확인해 고정하고, 1.5가 기존 테스트 파일이 그대로임을 Git으로 증명한다 |
| 7 | 감시 경로가 틀리거나 준비 과정의 호출이 섞여 호출 수 단언이 저절로 통과한다 | 중간 | 2장 제약의 비우는 자리. 0번 단언 앞에 같은 길의 1번 단언 |
| 8 | 일의 수 테스트가 도우미를 거치지 않는 목록 복사를 보지 못한다. 구현자가 정하는 `tolerance`와 `c`가 넉넉하면 단언이 무뎌진다 | 중간 | 결정 9의 설계 제약을 리뷰에서 본다(처리 모듈에 `slice`·펼치기·`filter`·`find`가 목록에 직접 쓰이지 않는다). 5.1의 변이 둘이 정한 값에서 실패해야 한다. 값과 본 수를 7장에서 리뷰한다 |
| 9 | 손으로 쓴 `Command` 타입과 스키마가 어긋난다. 읽기 전용 타입 때문에 타입 단언 뒤에서 공유 객체를 고친다 | 중간 | 표본 명령에 `Command` 타입을 주고 스키마로 검사한다(AC-01). 받은 모델을 깊이 얼린 사본으로 표본 명령을 한 번 돌리는 테스트를 "명령 동작"에 둔다 |
| 10 | 다른 realm의 객체가 복사에서 거부된다 | 낮음 | 번들 테스트는 컨텍스트 안에서 명령을 만든다(7.4) |
| 11 | 처리 13종과 AC 아홉이 하루(단계 6)에 몰린다 | 중간 | 사흘을 넘길 것 같으면 알린다. 표본과 사례를 줄이지 않는다 |
| 12 | `pnpm test`가 8초보다 많이 는다 | 낮음 | 큰 모델은 시간 테스트 파일과 일의 수 테스트에서만 만든다. 예제를 읽는 테스트는 파일마다 한 번 읽은 글 맵을 다시 쓴다(모델은 테스트마다 새로 읽는다) |
| 13 | 단계 5의 커밋에서 편집기가 `entity.*`만 처리한다 | 확실 | 공개하지 않으므로 밖에서 보이지 않는다(결정 2). 단계 5와 6을 따로 병합하지 않는다 |

### 알려진 한계 (이 기능에서 고치지 않는다)

스펙 8장 그대로다. 구현하다 고치고 싶어지는 것만 적는다: 이미 오류가 있는 모델에서 느슨한 거부 규칙(D-02), 쓰기 시작한 뒤의 실패는 되살리지 않음(D-05, F10), 비교 키가 같은 경로 쌍에 든 파일은 저장되지 않음(D-03), 하드 링크인 파일은 다른 이름의 내용도 함께 바뀜, 어댑터가 나열하지 않는 폴더는 저장 전에 찾지 못함. 덧붙여 F08에 넘길 것 하나: `commandSchemas`는 `urn:`을 `$ref`로 가리켜 MCP 클라이언트가 그대로는 풀지 못한다(분석 4.3).

### 구현할 때 참고

- 피할 것(분석 7장): 모델 전체를 직렬화해 바뀜을 판정하기, 사용자 ID로 평범한 객체 키 만들기, `Object.assign`으로 복사, ES2023 배열 메서드, 처리마다 역연산, 처리와 레지스트리를 한 파일에, `../index.js`를 거쳐 `validateModel` 가져오기, `generated/`에 명령 스키마 넣기, `pathKey` 밖에서 경로의 대소문자 접기.
- 헷갈리기 쉬운 것: 속성의 `scope: both`는 바뀐 것이고 엔터티와 키의 것은 아니다(분석 V11). 편집기 모델에서 새 항목은 목록의 끝이고 다시 읽은 모델은 이름순이지만 `serializeModel`의 결과는 같다(V14). `unknown command type`의 50은 코드 단위이고 문구의 500은 코드 포인트다. 새 경로에서 소문자인 것은 파일 이름이고 `dir`은 모델의 것 그대로다. 저장은 쓰고 나서 지운다(`writeModel`에는 지우기가 없었다). 분석이 `toLowerCase()`라고 적은 경로 비교는 모두 `pathKey`다.
- 테스트 도우미는 `src/testing/`에만 둔다. 밖에 두면 `dist`에 들어가고 관문이 놓친다.
- 상대 경로 가져오기에 `.js` 확장자를 쓴다. 테스트의 `describe`는 스펙의 한국어 이름, `test`는 영어다.
- 분석의 실험 스크립트 폴더(분석 머리말)는 사라졌을 수 있다. 없으면 분석 본문만으로 진행한다.

## 7. 구현 기록

(구현하면서 적는다: 0.3의 시작 값, 계획 커밋 해시(단계 1의 커밋에서), 1.1에서 지금 코드에 돌려 본 결과, 단계마다 테스트 수와 `pnpm test` 시간, 5.1의 `tolerance`·`c`와 T(250)·T(500)·T(1000), 시간 테스트 15번의 결과와 잰 값, 5.1과 단계 7의 변이마다 본 실패, 깨뜨려 확인한 것, 고친 기대값이나 검사 스크립트, 스펙이 정하지 않아 정한 것, 계획과 달라진 점. 이 절의 변경은 각 단계의 커밋에 넣는다)

### 단계 0 (2026-11-28)

- 0.1: 다른 명령(브랜치·상태 확인의 읽기 명령 하나 뒤)보다 먼저 실행했다. `exit=0`. 두 기준선이 없어서 새로 만들었다: `docs/handoff/core-commands-spikes-before.sha256`(866줄), `docs/handoff/core-commands-f02-tests.list`(44줄). 둘 다 `git check-ignore` 통과.
- 0.2: `feature/core-commands` 확인.
- 0.3: 단계 관문 `exit=0`. 39개 파일 657개 통과, `pnpm test` 73.99초. 목록 파일 44줄.
- 0.4: 계획과 스펙은 리드가 이미 `b7a0350`(`Add the F03 plan and the spec changes from its review`)으로 커밋했다. 이 걸음은 한 것으로 치고 따로 커밋하지 않았다. 계획 커밋의 해시는 `b7a0350`이다.

### 단계 1 (2026-11-28)

- 1.1: `model/serialize-order.test.ts`, `describe('serializeModel: 예외의 경계')`, 테스트 7개. 떼어 내기 전의 코드에 먼저 돌려 7개 모두 통과했다. 본 동작은 계획의 설명과 같다(다른 점 없음).
  - 검사가 먼저: `Document.prototype.toString`이 `RangeError`를 던지게 하고 뒤 항목 `entities/b.yaml`에 함수 값 `x`를 두면 `TypeError('Cannot write entities/b.yaml: /x must be a JSON value')`이고 `toString`은 한 번도 불리지 않는다.
  - `yamlText`·`layoutJson`의 `RangeError`는 `Cannot write <file>: it is too large or too deeply nested to write`인 `TypeError`가 되고 `cause`가 원래 오류와 `toBe`다. `layoutJson`의 다른 `Error`는 그대로 나온다(`toBe`. 계획의 넷에 더한 하나. `yamlText` 쪽은 F02의 `serialize-too-large.test.ts`가 이미 본다).
  - `RangeError`를 던지는 접근자 `/definition`: 불리지 않고 `Cannot write entities/e.yaml: /definition must be a JSON value`. 첫 `ownKeys`에서 `RangeError`를 던지는 Proxy `/ext`: `Cannot write entities/e.yaml: /ext must be a JSON value`.
  - 첫 `ownKeys`는 답하고 둘째에서 `RangeError`를 던지는 Proxy(`/ext`, 대상 `{ a: 1 }`): 그 `RangeError`가 그대로(`toBe`) 나오고 `ownKeys`는 정확히 2번 불린다(검사에서 1번, `canonical`의 `Object.keys`에서 1번).
- 1.2: `model/serialize-item.ts`에 `checkItemData(file, data)`(JSON 값 검사의 첫 오류를 `TypeError`로), `itemText(file, data, schema)`(`canonical`은 `try` 밖, `RangeError`만 바꿈), `serializeItem(file, data, schema)`(둘을 차례로)를 두었다. `yamlText`와 그 도우미(`YAML_OPTIONS`, `isBlankLines`, `keyNode`, `yamlNode`, `lastScalar`)는 글자 그대로 옮겼다. `serializeModel`은 모든 항목에 `checkItemData`를 부른 뒤 `itemText`를 부른다. `serialize-item.test.ts`, `describe('항목 직렬화')`, 테스트 7개: 예제 29개 항목의 글이 `serializeModel`의 것과 같고, 1.1의 뒤 셋(과 `layoutJson`의 다른 오류)이 `serializeItem`에서도 같다. 구현 전에 모듈이 없어 실패하는 것을 봤다.
- 1.3: `model/types.ts`에 `DeepReadonly<T>`(배열 → `readonly DeepReadonly<U>[]`, 객체 → `readonly` 필드)와 `ReadonlyModel = DeepReadonly<Model>`. `validateModel`, `modelItems`, `serializeModel`, `modelFiles`, `writeModel`의 매개변수만 `ReadonlyModel`로 넓혔다(본문 그대로). `index.ts`에 타입 `ReadonlyModel`. `readonly.test.ts`, `describe('읽기 전용 모델')`, 테스트 2개: `Model`이 `ReadonlyModel`에 대입되고, 세 함수의 결과가 `Model`로 넘긴 것과 `toEqual`(`writeModel`은 새 엔터티 하나를 더한 모델을 두 메모리 어댑터에 써서 비교). `@ts-expect-error` 셋(항목 데이터의 `name` 대입, `entities.push`, `ext` 안 객체의 키 대입)은 부르지 않는 함수 안에 두었다. 타입을 넣기 전 `tsc -p tsconfig.test.json`이 `TS2305`와 `TS2578` 셋으로 실패했고, 타입만 넣고 넓히기 전에는 `TS2345` 셋으로 실패했다.
- 1.4: `validate/schema.ts`에 `validatorIssues(file, validate: ValidateFunction, data)`를 두고 `schemaIssues`가 `validatorIssues(file, schemaValidator(name), data)`를 부른다. 몸통은 그대로 옮겼다.
- 1.5: 단계 관문 `exit=0`, 불변 증명 `exit=0`. 42개 파일 673개 통과(657 + 7 + 7 + 2), `pnpm test` 73.97초(단계 0과 거의 같다).
- 계획과 달라진 점: (1) 모듈 표의 `serialize-item.ts`에 `itemText`, `serializeItem` 말고 `checkItemData`도 내보낸다. `serializeModel`이 "모든 항목을 먼저 검사한 뒤 글을 만든다"를 지키려면 검사만 따로 불러야 한다. 편집기와 `writeChanges`는 계획대로 `serializeItem`만 부른다. (2) 1.1과 1.2에 `layoutJson`의 다른 오류가 그대로 나오는 사례를 하나씩 더했다.

### 단계 2 (2026-11-28)

- 2.1: `command/types.ts`에 명령 17종의 인터페이스(`batch`의 `commands`는 `batch`를 뺀 16종의 `SubCommand`), `Command`, `CommandType`, `RejectionCode`(여덟), `Issues`, `CommandResult`, `Editor`. 목록 필드는 `readonly` 배열이라 읽기 전용 배열도 넘길 수 있다.
- 2.2: `message.test.ts`, `describe('거부 문구: 한 줄')`, 테스트 18개. 구현 전에 모듈이 없어 실패하는 것을 봤다. `message.ts`의 `oneLineMessage`는 CLI `oneLine`의 문자 집합과 이스케이프를 옮겨 적고(코드는 가져오지 않는다), 이스케이프한 **뒤의** 글을 코드 포인트 500개로 자른다.
- 2.3: `testing/commands.ts`에 `REJECTED_INPUTS`(44줄: `shape` 5, `copy` 22(문구가 500 코드 포인트를 넘는 줄 포함), `type` 4, `schema` 13)와 `ACCEPTED_INPUTS`(7줄). 줄마다 입력을 만드는 함수와 `execute`가 돌려줄 최종 문구(한 줄 처리와 자르기 뒤)를 든다. `copy.test.ts`, `describe('믿을 수 없는 입력: 복사')`, 테스트 52개: `shape`·`copy` 27줄을 `copyCommand`와 `readCommand` 양쪽으로, 받는 7줄은 사본과 `toEqual`, 그 밖에 객체 공유 없음, `__proto__` 서술자, `-0`·`1e300`·`5e-324`, `Infinity`·bigint·심벌·`Map`·박싱한 글, 키의 포인터 이스케이프, 폐기된 Proxy, 길이가 거짓인 배열 Proxy, 속성과 `length`를 한 번씩 읽음, 첫 실패 뒤에는 읽지 않음, 한 방문 안의 한도 순서, 배열 항목과 키가 값 하나씩, 20만 단 중첩과 길이 1000만의 빈 배열이 스택을 키우지 않고 곧 거부됨, 무작위 JSON 300개가 그대로 복사됨. `copy.ts`의 `copyCommand`는 명시적 스택으로 깊이 우선 한 번 걷는다. 색인 경로는 실패할 때만 부모 고리를 따라 만든다(경로 글을 컨테이너마다 만들면 긴 키가 겹쳐 제곱이 된다).
- 2.4: `SAMPLE_COMMANDS` 17개(종류마다 하나. `entity.delete`와 `batch`는 빈 모델, 나머지는 예제. `entity.delete`는 `before`에 `entity.create`). `schemas.test.ts`, `describe('명령 스키마')`, 테스트 65개. `schemas.ts`의 `commandSchemas`(손으로 쓴 TS, 모듈을 읽을 때 스택으로 깊이 얼림)와 `check.ts`의 `commandValidator`(종류마다 처음 쓸 때 `schemaAjv().compile(prepareSchema(s, s))` 한 번), `checkCommand`(FR-03 3~4), `readCommand`(1~4, `batch`는 봉투까지). 오류 고르기는 `validatorIssues`의 결과를 `compareIssues`로 한 번 훑어 가장 작은 것이다(정렬하지 않는다).
  - 동기화: 명령 스키마의 모델 필드(자기 필드와 `set` 안)를 모두 훑어 셋 가운데 하나임을 본다. (1) 공통 정의 일곱 가운데 하나를 가리키는 홀로 선 `$ref`이고, 형식의 같은 자리도 같은 `$ref`다. (2) ID 목록(`{ type: array, items: { $ref: …id }, uniqueItems: true }`, `minItems: 1`은 키의 `attributes`와 `addEntities`·`removeEntities`에만). (3) 옮겨 적은 규칙이고 `schemaAt`의 그 자리와 `toEqual`이다. 옮겨 적은 것은 18자리(엔터티의 `name`·`definition`·`note`·`nameSource`·`physical`, 속성의 `name`·`definition`·`note`·`scope`·`nullable`·`physical`·`nameSource`, 키의 `kind`·`name`·`physical`, 주제영역의 `name`·`definition`·`order`)이고 테스트가 이 목록을 고정한다. 부록 A의 필드, `set`의 키, `unset`의 이름 목록도 종류마다 글자 그대로 비교한다.
  - 컴파일: `schemaAjv()`의 `compile`을 감시해 17종에 정확히 17번 불리고, 결과가 `commandValidator`의 것과 `toBe`이며, 컴파일한 스키마가 `prepareSchema(s, s)`와 `toEqual`이다. ID 목록의 `uniqueItems`가 준비 과정의 `erdmakerUniqueItems`로 바뀌는 것도 본다.
- 2.5: 단계 관문 `exit=0`. 45개 파일 808개 통과(673 + 18 + 52 + 65), `pnpm test` 74.60초(단계 1보다 0.6초. 새 세 파일은 따로 돌리면 약 1.5초). `-t '명령 스키마'`에서 65개 통과.
- 깨뜨려 확인한 것(각각 되돌림. 실패한 테스트 수): 깊이보다 값 한도를 먼저 봄(1), 값을 세지 않음(5), `undefined`인 값을 세지 않음(1), 속성을 두 번 읽음(1), 받지 않는 값을 글 한도보다 먼저 봄(처음에는 살아남아 "글 한도를 넘는 키의 값이 `NaN`" 사례를 더했다. 그 뒤 1), `Object.defineProperty` 대신 대입(3), Ajv가 낸 순서의 첫 오류(2), 모르는 종류에서 `…`를 뺌(2), 격리 제어 문자를 이스케이프하지 않음(1), 코드 단위로 자름(1), 옮겨 적은 `description` 한 글자 바꿈(2), 주제영역 `name`의 `minLength`를 뺌(2), 일부만 얼림(1). 살아남은 변이 하나: 배열 색인의 서술자에서 `value` 확인을 빼는 것. 접근자 서술자에는 `value`가 없어 값이 `undefined`가 되고 어차피 거부되므로 결과가 같은 변이다.
- 스펙과 계획이 정하지 않아 정한 것:
  1. **읽다가 난 예외의 자리**: 속성 값을 읽다 난 것(`get` 트랩, 던지는 getter)과 배열 색인의 서술자를 읽다 난 것(서술자 트랩)은 그 속성이나 색인의 경로(`/type`, `/ext/a`, `/ext/0`), 키를 나열하거나 종류를 보다 난 것(`ownKeys`, 객체의 서술자 트랩, 폐기된 Proxy, `getPrototypeOf`)은 컨테이너의 경로(`/`, `/ext`)다(단계 2 리뷰 뒤 바로잡음: 서술자 트랩이 컨테이너의 경로인 것은 객체에서만이다). F02의 `checkJsonValue`가 접근자를 그 속성 경로로 알리는 것과 같다.
  2. **한 방문 안의 순서**: 스펙은 한도 셋의 순서만 정한다. 깊이 → 값 → 글 → 그 값 자신의 실패(읽기 예외, 받지 않는 값) 순으로 했다. "빼기 전에 센다"와 같은 생각으로, 세는 일이 판정보다 먼저다. 깊이를 알려면 값을 읽어 종류를 봐야 하므로 값은 한도를 보기 전에 한 번 읽는다(그래서 "33단계째 컨테이너가 값 한도도 넘기는 입력"이 깊이다).
  3. **`unknown command type`의 `…`**: 부록 B의 "앞 50 코드 단위(넘으면 뒤에 `…`)를 `JSON.stringify`한 것"을 자른 글에 `…`를 붙인 뒤 `JSON.stringify`한다고 읽었다. 그래서 `…`는 따옴표 안에 있다(`"xxx…"`).
  4. **배열 Proxy의 `length`**: 음이 아닌 안전한 정수가 아니면 그 배열 자리의 `must be a JSON value`다.
  5. **사본의 모양**: 프로토타입이 `null`인 입력 객체도 사본은 `Object.prototype` 객체다. 수는 유한하면 받는다(`1e300` 포함. F02의 `checkJsonValue`는 안전하지 않은 정수를 거부하지만 FR-03은 "유한한 수"다).
  6. **옮겨 적기**: 형식 스키마의 조각을 `description`, 속성 `nullable`의 `default: true`, `physical`의 `required: []`까지 글자 그대로 옮겨, 동기화 테스트가 아무것도 빼지 않고 `toEqual`한다. 스펙이 꼽은 여덟 말고 `definition`·`note`(`{ type: string }`)도 옮겨 적은 것으로 보고 비교한다. 공통 `scope`는 기본값이 있어 속성의 `scope`만 옮겨 적었다(엔터티와 키는 `$ref`).
  7. **문구의 마무리 자리**: `readCommand`와 `checkCommand`는 한 줄 처리 전의 문구를 돌려준다. `commands[<i>]: ` 접두를 붙인 뒤 한 번 처리하도록 편집기(단계 5)가 `oneLineMessage`를 부른다. 표의 `message`는 최종 문구이고 단계 2의 테스트는 `oneLineMessage`를 거쳐 비교한다.
  8. **물려받은 색인의 줄**: 배열의 프로토타입은 `Array.prototype`이어야 하므로 진짜로 물려받게 하려면 `Array.prototype[0]`을 잠깐 정의해야 한다. 그 줄은 `cleanup`을 갖고 테스트가 `finally`에서 부른다.
- 계획과 달라진 점: (1) `ACCEPTED_INPUTS`의 줄은 기대 모델 대신 입력 층이 남길 사본(`copy`)을 든다. 모델의 기대는 편집기가 생기는 단계 5에서 이것으로 만든다. (2) `copy.test.ts`가 `check.ts`의 `readCommand`도 부르므로 2.3의 테스트는 2.4의 구현 뒤에 통과했다(실패는 구현 전에 봤다). (3) `check.ts`가 `commandValidator`도 내보낸다(컴파일 테스트용. `index.ts`에는 없다). (4) **`batch` 안의 `batch`** (`commands[<i>]: a batch cannot hold a batch`)는 `checkCommand`에 넣지 않았다. 하위 명령의 차례(FR-08 (2))에서 색인과 함께 보는 일이라 단계 5의 편집기에서 한다.

### 단계 3 (2026-11-28)

- 3.1: `command/slug.ts`의 `slugify`(앞 256 코드 단위 → NFKC → 코드 포인트마다, `A`~`Z`는 코드 산술로 소문자, 한글 음절은 부록 C), `fitId`(63자로 자르고 끝의 `_`를 뗀다), `MAX_ID_LENGTH`. 부록 C의 세 줄은 스펙의 글 그대로(`-` 포함) 코드에 적고 나눈다(68개). `slug.test.ts`, `describe('ID 만들기: 슬러그')`, 테스트 32개: AC-08의 비지 않는 줄 17개, 빈 슬러그 7개, 256 코드 단위, 63자 자르기와 끝 `_`, NFKC(분해된 음절, 합자, 켈빈 기호, `①`), 부록 C의 예 여섯과 `엔터티`, 표의 모든 자리(초성 19·중성 21·종성 28을 음절 하나씩), 음절 11172개, `AWKWARD_STRINGS`와 무작위 글 2000개. 구현 전에 모듈이 없어 실패하는 것을 봤다.
- 3.2: `command/ids.ts`의 `IdSpace`(이름 공간 넷의 판별 합집합. `hasId`, 엔터티는 `physicalsOf`, 엔터티와 주제영역은 `files: FileSpace`), `idBase`(재료와 대체 낱말), `idProblem`(직접 준 `id`: 이유 1~5의 첫 문구), `chooseId`(만드는 `id`). `ids.test.ts`, `describe('ID 만들기')`, 테스트 31개(AC-09 바로잡기 뒤). 가짜 인터페이스는 `paths.ts`의 `fileSpace`와 `InitialPaths`에 `Set`을 넣고 `hasId`가 물어본 후보를 적는다. 구현 전에 모듈이 없어 실패하는 것을 봤다.
  - 후보 수: 속성 `x`, `x_2`, `x_3`에서 `x_4`, 물어본 후보 `[x, x_2, x_3, x_4]`. AC-08 (아): `s_4`, 물어본 후보 `[s_3, s_2, s_4]`(겹침 없음, FR-10 상한 이하).
  - AC-08의 기대 ID는 모두 FR-05와 부록 C로 따로 셈해 맞춰 봤다(로마자는 손으로 셈하고 스크립트로 다시 셈했다. (아)의 접두 후보가 `s_2`와 같은 글임도 셈했다).
- 3.3: `command/paths.ts`의 `pathKey`(결정 8), `pathKeys`, `newItemFile`, `InitialPaths`(경로 집합과 키마다 코드 단위 순 앞의 두 경로. `otherCase`는 상수 시간), `reservedPaths`, `dictionaryFolders`(`isAbsoluteEntry`를 다시 씀), `dictionaryFolderOf`, `FileSpace`·`fileSpace`, `listReservedFiles`. `paths.test.ts`, `describe('새 파일 경로: 비교 키')` 3개와 `describe('새 파일 경로')` 12개. 구현 전에 돌려 보지 않고 구현했다(모듈이 없어 실패하는 것은 같다). 대신 아래 변이로 확인했다.
- 3.4: `index.ts`에 `listReservedFiles`.
- 3.5: 단계 관문 `exit=0`. 48개 파일 887개 통과(바로잡기 전. 810 + 32 + 30 + 15. 810은 단계 2의 808에 리뷰 마무리 커밋 `6d311df`의 2개), `pnpm test` 74.66초. 새 세 파일은 따로 돌리면 0.18초.
- 깨뜨려 확인한 것(각각 되돌림. 실패한 테스트 수): NFKC를 뺌(2), 257 코드 단위를 읽음(4), 끝 `_`를 떼지 않음(2), 앞 구분자를 남김(4), 종성 `j` → `z`(처음에는 살아남아 "표의 모든 자리" 테스트를 더했다. 그 뒤 1), 초성 `kk` → `k`(2), 중성 두 자리 바꿈(1), 이미 본 후보를 다시 물음(1), 테이블명 비교를 뺌(3), 접두 조건을 뺌(3), 접두 후보를 건너뜀(3), 접두를 바탕으로 쓰지 않음(1), Windows 이름 검사를 뺌(1), 속성에도 Windows 이름(1), 사전 폴더를 첫 후보에서 보지 않음(1), 자른 바탕의 `_`를 남김(1), `otherCase`가 늘 첫 경로(3), 같은 이름의 폴더를 안으로 침(1), `listReservedFiles`를 정렬하지 않음(처음에는 메모리 어댑터가 정렬해 살아남아 순서를 섞어 주는 어댑터 사례를 더했다. 그 뒤 1), `pathKey`에서 NFKC를 뺌(3), 예약 경로에서 처음 경로를 빼지 않음(1), 사전 폴더를 글자로 비교(1), `InitialPaths`가 코드 단위 순을 보지 않음(1). 살아남은 변이 하나: 2단계의 스키마 비교에서 `?? ''`를 빼는 것. 새 스키마가 없거나 빈 글이면 접두의 슬러그가 비어 2단계가 없으므로 결과가 같은 변이다.
- **AC-09 바로잡기(리드 결정)**: 구현 중에 AC-09의 한 줄이 FR-05·FR-06과 맞지 않는 것을 찾아 멈췄다. 옛 글: "`Customer.yaml`, `cUstomer.yaml`, `customer.yaml`(ID `a`, `b`, `customer`)을 읽어 온 편집기에서는 `customer`를 지운 뒤 `id: customer`가 `id-taken`이고 문구의 경로가 `entities/Customer.yaml`이며". 지운 뒤에도 `a`와 `b`의 파일이 같은 비교 키라 새 경로가 쓰이고 있고(FR-06), FR-05의 순서로 넷째 이유가 먼저다. 리드가 FR-05의 순서를 그대로 두고 AC-09를 고쳤다: `customer`만 지우면 넷째 이유 `entity id "customer" cannot be used: entities/customer.yaml is already in use`, 셋을 모두 지우면 다섯째 이유이고 경로가 `entities/Customer.yaml`(`undo` 뒤 다시 지워도 같다). 스펙의 고침은 이 단계의 커밋에 든다. `ids.test.ts`에 이 두 경우(함수 수준. 편집기 수준은 단계 5)와 "4번이 5번보다 먼저"를 넣었고, 4번과 5번의 순서를 바꾸면 3개가 실패한다. 단계 관문을 다시 돌려 `exit=0`, 48개 파일 888개 통과(`ids.test.ts` 31개), `pnpm test` 74.30초.
- 스펙과 계획이 정하지 않아 정한 것:
  1. **만드는 ID의 3번 이유**: 첫 후보의 경로를 검사하기 전에 먼저 보고, 걸리면 첫 후보의 ID와 경로로 3번 문구를 낸다. 첫 후보가 1번에도 걸리는 경우(이미 있는 ID)도 같다. 3번은 ID와 상관없다(FR-05)는 문장과 "첫 후보에서 거부한다"를 그대로 따랐다.
  2. **"사전 폴더 안"**: 폴더의 구성요소가 경로의 **앞쪽 일부**(경로 자신보다 짧은 것)와 같을 때다. 경로 자신과 같은 이름의 폴더는 안이 아니다. 그래야 3번이 ID와 상관없다는 FR-05의 문장이 맞는다. 폴더가 여럿 걸리면 매니페스트 순서로 첫 것을 문구에 적는다.
  3. **예약 경로에서 빼는 처음 경로**: 정규화한 글이 처음 항목의 `file`과 글자까지 같은 것만 뺀다(비교 키로 빼지 않는다). 대소문자만 다른 처음 경로는 5번 이유가 따로 지킨다.
  4. **2단계의 "슬러그"**: 첫 후보(재료가 모두 비면 대체 낱말)다. 그 ID를 가진 엔터티가 둘 이상이면 하나라도 맞으면 접두를 붙인다(분석 I2).
  5. **`listReservedFiles`의 순서**: 두 폴더를 `entities`, `subject-areas` 순으로 한 번씩 나열하고 결과를 코드 단위 순으로 정렬한다(FR-01의 결정성. 편집기는 어차피 정규화한다). 어댑터 오류는 그대로 나간다.
  6. **`reservedFiles`의 글이 아닌 값**: `reservedPaths`는 글만 받는다. 편집기가 받은 값을 어떻게 다룰지(FR-01은 모델의 조건 말고는 던지지 않는다)는 단계 5에서 정한다.
- 계획과 달라진 점: (1) `paths.ts`가 `FileSpace`와 `fileSpace`를 내보내고 `ids.ts`가 그것을 받는다(결정 7의 "작은 인터페이스"를 함수 넷으로 둔 것). (2) `slug.ts`가 `fitId`와 `MAX_ID_LENGTH`를 내보낸다(접두와 접미사의 63자 맞추기에 쓴다).

### 단계 2 리뷰 메모 반영 (2026-11-28)

단계 2 코드 리뷰(심각 0, 경고 0)의 메모 아홉을 한 커밋에 넣었다. 단계 관문 `exit=0`, 48개 파일 901개 통과(888 + 13), `pnpm test` 74.17초.

- `schemas.test.ts`, `describe('ID lists the spec ties to the format')`, 테스트 6개: 키의 `attributes`(`key.create`, `key.update`의 `set`)와 `subjectArea.create`의 `entities`가 형식의 그 자리와 `minItems`, `maxItems`, `items`가 같다. 메모리의 형식 스키마 사본을 고쳐(`minItems: 2`, `maxItems: 5`, 다른 `items`, `items` 없음) 차이가 그 키로 잡히는지 본다. `addEntities`·`removeEntities`는 자기 `minItems: 1`이라 넣지 않았다.
- `message.ts`: 한 번 걸으며 코드 포인트마다 이스케이프하고, 이 함수가 쓴 이스케이프(`\n`, `\r`, `\t`, `\u{…}`)가 500개 안에 다 들어가지 않으면 그 앞에서 자르고 `…`를 붙인다. 500개에 닿으면 멈춘다(줄바꿈 100만 개도 251번째에서 멈춘다). `message.test.ts`에 테스트 3개(497개 `a` + U+2028과 이웃들, 글 자신의 역슬래시, 줄바꿈 100만 개). 보통 글의 결과는 그대로다(기존 테스트 그대로 통과).
- `copy.test.ts`: `cleanup` 뒤 `Object.hasOwn(Array.prototype, 0)`이 거짓.
- `testing/commands.ts`: `RejectedInput.raw`(입력 층이 한 줄 처리 전에 돌려주는 문구. 단계 5의 `execute`가 `oneLineMessage`로 `message`를 만들어야 하는 줄)를 더하고 `type`에 U+2028이 든 줄(`raw`는 날 U+2028, `message`는 `\u{2028}`)을 더했다. `schemas.test.ts`가 `raw`와 `message`를 둘 다 단언한다. 함수인 명령(`shape`, `command must be an object`)과 `Date`인 명령(`copy`, `/ must be a JSON value`) 두 줄도 더했다. `REJECTED_INPUTS`는 47줄(`shape` 6, `copy` 23, `type` 5, `schema` 13).
- 스펙: FR-03 1(함수는 1, 평범하지 않은 객체는 2), 2의 받는 값(안전한 정수 범위 밖의 수는 복사를 통과하고 검증이 `validation`으로 거부), 읽기 예외의 자리, 한 자리에서의 순서(한도 먼저, 그 값은 이미 한 번 읽혔다), 한 줄 처리의 자르기(이스케이프 앞에서), 부록 B의 잘린 종류 예(`…`가 따옴표 안). 줄 수는 그대로 380줄.
- 리드의 메모와 다른 점: 메모는 "함수(또는 평범하지 않은 객체)인 명령 전체는 `command must be an object`"였으나 지금 코드와 FR-03의 1·2는 평범하지 않은 객체를 `/ must be a JSON value`로 낸다. 스펙에는 코드대로 적고 두 경우를 표의 줄로 고정했다.

### 단계 4 (2026-11-28)

- 4.1: `testing/recording-fs.ts`의 `recordingFileSystem(files, inner?)`. 호출(`readText`, `writeText`, `list`, `remove`와 경로)을 **넘기기 전에** 적고(실패한 호출도 든다) `clear()`로 비운다. `faults`의 네 집합(`list`, `read`, `write`, `unlisted`)을 따로 켠다. 앞 셋은 `code: 'EACCES'`인 `Error`(`accessError`), `unlisted`는 읽히지만 부모의 나열에서 빠지는 경로다. 나열 순서를 뒤집는 어댑터는 테스트가 `inner`로 넘긴다.
- 4.2: `model-shape.test.ts`, `describe('편집기 만들기: 모델의 조건')`, 테스트 9개: AC-14의 입력 아홉과 이유 문구, 받는 것 셋(밖의 사전 하나, 검증 오류가 있는 모델, 매니페스트 없는 예제), 조건 1~4마다의 경계와 순서, 던지는 getter·트랩·폐기된 Proxy, 자리마다 한 번만 읽음, 항목 10만 개. 구현 전에 모듈이 없어 실패하는 것을 봤다. **구현**: `command/model-shape.ts`의 `readModelShape(model)`(조건 1~4를 차례로 보고 첫 이유, 또는 한 번 읽은 자리들: `dir`, 매니페스트, 다섯 목록의 항목, 사전), `checkEditable(model)`(이유 또는 `undefined`), `SAVED_LISTS`(다섯 목록과 스키마). 겹침은 `Set` 하나로 한 번 훑는다.
- 4.3: `write-changes.test.ts`, `describe('저장의 조건')`, 테스트 33개(모델 4, 대소문자 5, 직렬화 3, 새 경로 9, 다섯 검사의 순서 7, 쓰고 나서 지우기 5). 편집기 없이 `before`를 `loadModel`로 읽고 `after`를 펼치기로 만든다. 어댑터 기록과 `serializeItem` 감시(`vi.mock('../model/serialize-item.js')`)는 `writeChanges` 바로 앞에서 비운다. 검사에서 거부되는 사례는 모두 `writeText`·`remove`가 0번이고, (1)~(3)에서 거부되는 사례는 어댑터 호출 자체가 0번이다. 쓰기 실패는 `writeText`가 정확히 `a`, 실패한 `b` 두 번이고 `remove` 0번, `old.yaml`의 바이트가 그대로다. 구현 전에 모듈이 없어 실패하는 것을 봤다. **구현**: `command/write-changes.ts`. 경로의 접기는 `pathKey`뿐이다(`command/` 안의 `toLowerCase`·`normalize`는 여전히 `pathKey`와 슬러그 둘). 조회는 모두 `Map`·`Set`이고 짝 비교가 없다: 대소문자 쌍은 키마다 경로를 모아 둘 이상인 무리만 정렬해 무리마다 후보 쌍 하나를 고른다.
- 테스트를 처음 돌렸을 때 실패한 넷은 모두 테스트의 잘못이었다(실패 뒤 `snapshot`의 읽기가 기록에 섞임, 읽어 온 항목 대신 새 객체를 넘김). 테스트를 고쳤고 구현은 그대로다.
- 4.4: `index.ts`에 `writeChanges`.
- 4.5: 단계 관문 `exit=0`. 50개 파일 943개 통과(901 + 9 + 33), `pnpm test` 74.66초(단계 3 리뷰 반영 뒤 74.17초. 새 두 파일은 따로 돌리면 약 0.6초).
- 깨뜨려 확인한 것(각각 되돌림. 실패한 테스트 수). `write-changes.ts`: 지우기를 쓰기 앞으로(2), 부모 나열을 뺌(12), 나열 이름을 `pathKey` 없이 비교(2), 새 경로를 읽지 않음(5), 새 경로에 같은 글이면 통과(1), 새 경로 둘의 대소문자 쌍을 봐주기(3), 검사 순서 바꾸기 넷: 대소문자를 직렬화 뒤로(1), 직렬화를 나열 뒤로(3), 읽기를 나열 앞으로(9), `dir` 비교를 `after`의 조건 앞으로(처음에는 1. "before, after, 폴더 순" 테스트에 `after`만 틀린 사례를 더해 2), 지운 파일의 폴더에서 `after`에 없는 파일도 지움(`before`가 갖지 않은 경로를 지움, 1), `before`와 같은 객체도 씀(6), 대소문자 쌍의 키에서 NFKC를 뺌(2), 나열 키에서 NFKC를 뺌(1), 나열 이름 대신 경로 전체를 키로(8). `model-shape.ts`: `dir` 안을 구성요소가 아닌 글 앞부분으로(2), 정규화보다 겹침을 먼저(1), 빈 `file`을 받음(1), `dir`의 정규화를 보지 않음(2), 사전도 `dir` 안이어야 함(1), 읽기의 `try`를 뺌(1). 살아남은 변이는 없다.
- 스펙과 계획이 정하지 않아 정한 것:
  1. **한 번 읽기**: `readModelShape`가 `dir`, 여섯 목록, `length`, 색인, 항목의 `file`을 저마다 한 번 읽고 `writeChanges`는 그 값만 쓴다. 읽을 때마다 값이 바뀌는 getter가 검사와 저장에서 다른 경로를 내지 못한다. 항목의 `data`는 (3)에서 쓸 항목에만 한 번 읽는다(`before`의 `data`는 읽지 않는다).
  2. **읽다가 난 예외**: 그 자리의 조건을 어긴 것으로 친다. `dir`이면 `dir is not a normalized path`, 목록·`length`·폐기된 배열 Proxy면 `<목록> is not a list`, 색인·항목·`file`이면 `<목록>[<i>] is not an item`, 매니페스트면 `manifest is not an item`. 모든 읽기가 던지는 폐기된 Proxy 모델은 첫 자리인 `dir`의 문구다(`typeof`가 `object`라 조건 1은 통과한다). `length`가 음이 아닌 안전한 정수가 아니면 목록이 아니다. `data` getter가 던지면 (3)의 직렬화 실패로 보고 그 오류를 그대로 내며, 경로 순 차례도 직렬화와 같다(어댑터 호출 0번).
  3. **매니페스트의 문구**: FR-01의 `<목록>[<i>] is not an item`에 색인이 없으므로 `manifest is not an item`이다. 없는(`undefined`) 매니페스트는 받는다.
  4. **조건 안의 순서**: 조건 2는 여섯 목록이 모두 배열인지(`Model`의 순서: `entities`, `relationships`, `subtypes`, `subjectAreas`, `layouts`, `dictionaries`)를 먼저 보고, 그다음 매니페스트, 그다음 목록마다 항목이다. 조건 3은 모든 항목(매니페스트, 다섯 목록, 사전 순)의 정규화를 먼저 보고 그 뒤에 겹침을 본다. 겹침의 문구는 두 번째로 나온 항목의 `file`이다(글이 같다). 빈 `file`의 문구는 글자 그대로 ` is not a normalized file path`다(앞이 빈 글).
  5. **조건 4의 "안"**: 구성요소를 글자 그대로 비교한다(비교 키가 아니다). `dir`과 같은 `file`은 밖이다. `dir`이 빈 글이면 `..`로 시작하지 않는 모든 경로가 안이다.
  6. **대소문자 쌍의 대상**: 두 모델의 다섯 목록에 든 서로 다른 `file` 글 전부이고, 쌍의 두 경로 가운데 하나 이상이 이번 저장이 쓰거나 지우는 것일 때 걸린다. 매니페스트와 사전의 경로는 넣지 않는다(FR-09의 "다섯 목록").
  7. **같은 객체가 다른 목록으로 옮긴 경우**: `before`의 같은 `file`에 같은 객체가 있으면 목록이 달라도 쓰지 않는다(FR-09의 "같은 객체가 아닌 것" 그대로). 명령은 이런 모델을 만들지 않는다.
  8. **부모 폴더**: 마지막 `/` 앞이고, `/`가 없는 경로의 부모는 연 폴더(`""`)다. 나열한 이름은 `pathKey`한 집합으로 들고 새 경로의 마지막 구성요소의 키를 찾는다.
- 계획과 달라진 점: (1) `model-shape.ts`가 `checkEditable` 말고 `readModelShape`와 `SAVED_LISTS`도 내보낸다. `writeChanges`가 검사한 값을 다시 읽지 않으려면 읽은 자리가 필요하다. 단계 5의 `createEditor`는 `checkEditable`을 쓰면 된다. (2) 4.3의 "같은 글의 파일"은 나열에 보이는 것과 읽기에서만 보이는 것 둘로 넣었다(나열에 보이면 읽기 전에 걸려 "같은 글이면 통과" 변이를 잡지 못한다). (3) AC-05 가운데 명령으로 만드는 사례(예제의 `attribute.update`·`subjectArea.*`, `listReservedFiles`를 준 편집기)는 계획대로 단계 7이다. `definiton` 사례와 `Customer.yaml` 세 파일 사례는 손으로 만든 `after`로 여기에 넣었다.

### 단계 5 (2026-11-28)

- 앞선 커밋 `d1ddb1f`(`Close the Phase 3 review`)가 단계 3 리뷰의 경고 1건과 메모 6건을 닫았다: 슬러그가 NFKC 전에 256 코드 단위를 자르는 사례 둘과 호환 자모 사례, 연 폴더이거나 그 위인 사전 폴더(`.`, `..`, `../..`)는 모든 경로를 품음, `reservedPaths`가 글의 배열만 받고 그 밖에는 `TypeError('Cannot edit the model: reservedFiles is not a list of paths')` 하나만 던짐(빈 글로 정규화되는 항목은 무시), 스펙 FR-01·FR-03·FR-05·FR-06의 문장. 그래서 단계 3 기록의 "정한 것" 6(`reservedFiles`의 글이 아닌 값)은 스펙이 정했고, 이 단계의 `createEditor`가 그 도우미를 부른다. FR-01의 서명도 `reservedFiles?: readonly string[]`로 맞췄다.
- 5.1: 테스트 파일 여덟, 테스트 110개와 `test.todo` 11개(모두 단계 6의 종류가 필요한 줄. `editor.test.ts`에는 없다). 구현 전에 돌려 모듈이 없어 실패하는 것을 봤다. 테스트 도우미 `testing/editing.ts`(예제의 글 맵을 파일마다 한 번 읽음, 빈 모델, 손으로 만든 모델, `succeeded`)를 더했다.
  - `editor.test.ts` "편집기 만들기" 7개: FR-01의 이유 아홉(`TypeError`와 문구), 밖의 사전 하나, 오류가 있는 모델, `reservedFiles`의 계약(`Set`, 글, 글이 아닌 항목, 던지는 getter, `options: null`, 모델의 이유가 먼저, 빈 항목 무시), 거부 코드 여덟마다 `model`·`issues`·`canUndo`·`canRedo`가 그대로(`canUndo`와 `canRedo`가 둘 다 참인 상태에서), 같은 두 편집기의 결과가 호출마다 `toEqual`(`undo`·`redo` 포함 13번), 처음 경로가 상태임(`entities/Customer.yaml`을 지운 편집기는 `id: customer`를 다섯째 이유로 거부하고, 그 모델로 새로 만든 편집기는 받는다).
  - `history.test.ts` "이력" 6개 + todo 1(AC-12의 마지막 문장). AC-15의 뒷부분: 모델을 바꾸는 `execute`가 `validateModel` 정확히 1번, 그 뒤 `undo`·`redo`가 각각 0번이고 `model`·`issues`가 스냅숏의 것과 `toBe`.
  - `batch.test.ts` "묶음" 10개 + todo 3. 실패의 순서 셋(`not-found` `index` 1 → 바꾸면 `invalid-command` `index` 1 → 봉투의 모르는 키), 묶음 안의 묶음(안쪽이 스키마에 어긋나도 이 문구), 한 줄 처리 전의 접두, 끝이 오류면 `index` 없는 `validation`, 가운데 상태는 보지 않음, `ids`와 `validateModel` 1번과 `undo` 한 번, 만들고 지우기(`ids` `[baesong, null]`, 같은 모델, 이력·검증 없음), 지우고 다시 만들기, 지우기만과 그 저장, 일의 수.
  - `policy.test.ts` "검증 정책" 8개 + todo 2, `hostile.test.ts` "믿을 수 없는 입력"·"거부 문구" 56개 + todo 3, `handler-throws.test.ts` 7개, `handlers.test.ts` "명령 동작" 11개 + todo 1, `cascade.test.ts` "연쇄와 대상" 5개 + todo 1.
- 5.2: `work.ts`(`noteWork`), `working.ts`(`Working`: 목록마다 처음 고칠 때 한 번 복사하고, 지운 자리는 구멍으로 남겨 위치가 바뀌지 않는다. ID 색인 `entities`·`subjectAreas`와 경로 키의 개수 맵은 처음 물을 때 한 번 만들고 고칠 때마다 이어 고친다. 항목은 처음 고칠 때 새 항목으로 복사해 이 상태가 가지고, 그 뒤로는 제자리에서 고친다. 주제영역의 `entities`는 처음 고칠 때 `Set`을 함께 만든다), `changes.ts`(끝의 비교 `endModel`, `errorCount`, 술어 (가) `rejectionIssues`, 술어 (나) `reuseIssues`), `find.ts`, `handlers/entity.ts`, `registry.ts`, `editor.ts`. 단일 명령도 하위 명령 하나의 길로 돈다. 처리 모듈은 목록에 `slice`·펼치기·`filter`·`find`를 쓰지 않는다(목록과 색인은 모두 `Working`의 도우미를 거친다).
- 5.3: `SampleCommand.items`(명령 직전 모델에서 만드는 기대 데이터, `null`은 그 파일의 항목이 없음)를 더하고 `entity.*` 셋을 채웠다.
- 5.4: 단계 관문 `exit=0`. 58개 파일 1056개 통과, todo 11개, `pnpm test` 75.62초(단계 4의 74.66초 + 약 1초. 새 여덟 파일은 따로 돌리면 1.52초). `-t '편집기 만들기'`에서 16개 통과(모델의 조건 9 + 편집기 7), `editor.test.ts`에 `todo`가 없다.
- **일의 수**: T(250) = 5501, T(500) = 6001, T(1000) = 7001(Δ250 = 500, Δ500 = 1000. 하위 명령 하나에 2칸: 더하기 1, 끝의 훑기 1). `'index-build'`는 세 n 모두 3번(엔터티 색인, 경로 키, 끝의 비교의 파일 맵), `validateModel` 1번, `serializeItem` 0번. 고른 값: `tolerance` = 2, `c` = 4. 변이 (1) 더할 때마다 엔터티 목록 전체를 복사: `|Δ500 − 2·Δ250|` = 187500 > 2로 실패, 그 단언을 빼면 `Δ500` = 875250 > 2000으로 실패. 변이 (2) 찾을 때마다 색인을 다시 만듦: `'index-build'`가 n = 250에서 252번, 500에서 502번이라 실패. 둘 다 되돌렸다.
- 깨뜨려 확인한 것(각각 되돌림. 실패한 테스트 수): 검증 전에 모델을 바꿈(5), 거부된 명령에 이력(3), 바뀐 것이 없는 명령에 이력(2), 오류가 하나 늘어도 받음(3), 묶음의 하위 명령마다 검증(6), 바뀐 것이 없는 묶음에 새 모델 객체(3), 재진입 허용(2), 거부된 명령이 다시 실행 목록을 비움(2), 이력 101칸(1), 부르는 쪽의 명령 객체를 처리에 넘김(2). 덧붙여: `Issue`를 다시 쓰지 않음(2), 네 필드로 다시 씀(2), 끝의 비교에서 원래 항목으로 되돌리지 않음(3), 거부의 `issues`에 모든 오류(2), 비운 `physical`을 남김(1), 주제영역에 같은 ID를 두 번 붙임(1). 살아남은 변이는 없다.
- 스펙과 계획이 정하지 않아 정한 것(아홉):
  1. **하위 명령의 처리가 던진 예외**: 그 하위 명령의 거부로 보고 `internal`에 `index`와 `commands[<i>]: ` 접두를 붙인다(`commands[1]: Unexpected error: boom`). 부록 B의 "`batch`의 하위 명령이 낸 거부는 위 문구 앞에 접두가 붙는다"를 `internal`에도 적용했다. 처리 밖(끝의 비교, 검증)에서 난 예외는 `index` 없는 `internal`이다. 단일 명령에는 접두가 없다.
  2. **`options`**: `undefined`이면 예약 경로가 없다. `reservedFiles` 읽기가 던지면(던지는 getter, `options: null`) `reservedFiles is not a list of paths`의 `TypeError`다. 모델의 조건을 먼저 본다.
  3. **거부의 `issues`**: `validation`이 아닌 거부와 재진입은 새 빈 배열이다. 바뀐 것이 없는 성공도 `id`·`ids`를 돌려준다.
  4. **묶음 안의 묶음**: 하위 명령 사본의 자기 속성 `type`이 `'batch'`이면 그 스키마 검사 전에 거부하고 `index`를 붙인다(리드의 결정 그대로).
  5. **술어 (가)의 "전 목록"**: `editor.issues` 전부(경고 포함)의 `rule`, `file`, `path`, `message`와 비교한다. 거부의 `issues`에는 오류만 든다.
  6. **사전 폴더**: 편집기를 만들 때 매니페스트의 `dictionaries`(글인 항목만, 배열이 아니면 없는 것)로 한 번 정한다. F03의 명령은 매니페스트를 바꾸지 않는다.
  7. **색인의 수명**: `execute` 한 번의 작업 상태가 만들고 버린다. 모델마다 캐시하지 않는다(이력의 칸이 색인을 붙들지 않게. 계획 2장 권고 9).
  8. **`physical`의 정리**: `unset`이 실제로 키를 지웠고 끝에 `physical`이 비었을 때만 지운다. 없는 키의 `unset`은 건드리지 않은 것으로 본다.
  9. **처리가 없는 종류**: 이 단계에서 스키마를 통과한 나머지 13종은 `internal`(`Unexpected error: no handler for <type>`)이다. 공개하지 않으므로 밖에서 보이지 않고 단계 6이 채운다.
- 계획과 달라진 점: (1) 테스트 도우미 `testing/editing.ts`를 더했다(모듈 표에 없다. 빌드에서 빠진다). (2) 술어 둘과 오류 수는 따로 파일을 두지 않고 `changes.ts`에서 내보낸다. (3) AC-13의 "지우고 다시 만들면서 `order.ord_dtm`의 `definition`도 바꾸는 묶음"은 `attribute.update`가 단계 6이라, 같은 조건을 `entity.update`(`order`의 `note`)로 시험하고 스펙의 줄은 todo로 남겼다. (4) `paths.ts`의 `fileSpace`가 `used`로 `has`만 있는 객체를 받는다(작업 상태의 경로 키 개수 맵). (5) `ACCEPTED_INPUTS` 가운데 `subjectArea.create`의 두 줄은 todo다.

### 단계 4 리뷰 메모 반영 (2026-11-28)

단계 4 리뷰(실제 파일과 Node 어댑터로 본 `writeChanges`. 명령으로 닿는 데이터 손실 0, 경고 2, 메모 4)를 한 커밋에 넣었다. 고칠 때마다 실패하는 테스트를 먼저 쓰고 실패를 본 뒤 고쳤다. 단계 관문 `exit=0`, 58개 파일 1060개 통과, todo 11개, `pnpm test` 77.57초.

- A1(경고) `model-shape.ts`의 `isInside`: `dir: '..'`에서 `../../precious.yaml`이 안으로 통과했다(실제 파일에서는 모델 폴더 위의 파일을 쓰고 지웠다). 규칙: `dir + '/'`로 시작하고 **`dir` 바로 뒤의 구성요소가 `..`이 아니어야** 안이다. `dir`이 빈 글이면 첫 구성요소가 `..`이 아니어야 한다(지금 규칙과 같고 그대로 옳다). 테스트: `model-shape.test.ts` 조건 4에 `('..', '../../precious.yaml')`, `('..', '../../m/a.yaml')`, `('../..', '../../../a.yaml')`, `('..', '../..')`, `('', '../../a.yaml')`은 밖, `('..', '../..a/b.yaml')`, `('', '..a/b.yaml')`은 안. `write-changes.test.ts`의 "hostile models"에 `dir: '..'`과 `file: '../../x.yaml'`인 `after`와 `before` 두 줄(`Cannot save: ../../x.yaml is outside the model folder`, 어댑터 호출 0번). `editor.test.ts`의 이유 표에 한 줄. 스펙 FR-01 조건 4에 한 구절, AC-14의 입력에 한 줄.
- A2(경고) `model-shape.ts`: 여섯 목록을 항목을 보기 전에 통째로 읽어, `a.length = 2 ** 32 - 1`인 빈 칸 배열이 약 13초와 1 GB를 쓰고 잡힌 `RangeError` 때문에 `entities is not a list`를 냈다. 이제 (1) 여섯 목록이 배열이고 `length`가 0 이상 2³² − 1 이하의 정수인지만 `Model` 순서로 보고(목록의 다른 것은 읽지 않는다), (2) 매니페스트, (3) 목록마다 색인을 하나씩 읽어 처음 항목이 아닌 것에서 멈춘다. 목록을 미리 펼치지 않고, 잡는 예외는 자리 하나의 읽기뿐이라 `RangeError`가 "목록이 아니다"가 되지 않는다. 문구와 조건의 순서는 그대로다. 테스트 셋: 길이 `2 ** 32 - 1`과 `1e8`의 빈 칸 배열이 `entities[0] is not an item`(항목 둘 뒤가 빈 칸이면 `layouts[2]`), 그런 배열이 있어도 뒤 목록이 목록이 아니면 그 문구. 색인을 세는 Proxy로 읽은 키가 `['length', '0', '1', '2']`, 뒤 목록이 목록이 아니면 앞 목록은 `['length']`만 읽힘. `length`가 `2 ** 53 - 1`이고 모든 색인이 항목인 Proxy와 `length`가 `2 ** 32`인 Proxy는 `<목록> is not a list`이고 읽은 키가 `['length']`뿐.
  - **정한 것(한도)**: 리드의 메모는 "한도(예: 1,000,000)를 넘는 목록은 `<목록> is not a list`"였다. 1,000,000을 (1)에서 보면 같은 메모가 요구한 `1e8` 빈 칸 배열 → `entities[0] is not an item`과 맞지 않는다. 그래서 한도를 **2³² − 1**(어떤 배열도 그보다 길 수 없다)로 두었다. 진짜 배열은 모두 (1)을 지나고, 그보다 길다고 답하는 Proxy만 색인을 하나도 읽지 않고 거부된다. 일은 실제로 든(읽히는) 항목 수에 선형이다. 스펙 FR-01 조건 2에 한 구절로 적었다.
  - **계획과 다른 점**: 리드의 메모는 "200 ms 안"이었으나 계획 2장 제약이 `editor.perf.test.ts` 밖의 시간 단언을 막는다. 시간 대신 읽은 키를 세는 결정적 단언을 두었다(고치기 전 코드에서 빈 칸 배열 테스트는 단언 실패와 OOM으로 작업자가 죽었다).
- A3(메모) `write-changes.ts`: 지우지 않을 경로가 다섯 목록뿐이라, `before`가 엔터티로 갖던 경로를 `after`가 매니페스트나 사전으로 가지면 지워졌다. `after`의 매니페스트와 사전 경로를 지우지 않는 집합에 더했다(글자 그대로 비교). 대소문자 쌍(2)은 여전히 다섯 목록만 본다(단계 4의 정한 것 6). 테스트: 메모리 어댑터에서 매니페스트, 사전 각각 `removed: []`, 어댑터 호출 0번, 바이트 그대로. 스펙 FR-09 "지우는 것"에 한 구절.
- A4(메모, 스펙만): 8장에 둘(`writeChanges`는 스키마를 보지 않아 손으로 만든 `after`의 스키마 오류 항목을 쓰고 원래 파일을 지울 수 있음. 명령이 만든 모델은 언제나 통과. 메모리 어댑터의 `writeText`는 새 경로마다 저장된 경로를 모두 훑음). FR-01 조건 2·3에 문구 `manifest is not an item`과 빈 `file`의 ` is not a normalized file path`(앞이 빈 칸). 스펙은 383줄.
  - **다른 점**: 메모는 메모리 어댑터 줄을 "8장의 `list` 줄 옆"이라 했으나 그 줄은 이 스펙이 아니라 F02 스펙(`core-model-io.md` 8장)에 있다. F02 스펙은 고치지 않고 이 스펙 8장에 "F02 8장의 `list`와 같다"로 이어 적었다.

### 단계 5 리뷰 메모 반영 (2026-11-28)

단계 5 리뷰(심각 0, 경고 1, 메모 8)를 한 커밋에 넣었다. 단계 관문 `exit=0`, 60개 파일 1066개 통과, todo 11개, `pnpm test` 74.88초. 단계 6의 처리가 있어야 시험할 수 있는 줄(다른 종류를 섞은 얼린 모델의 묶음, 17종의 무작위 명령, 섞은 묶음의 일의 수)은 단계 6의 커밋에 든다.

- 경고 `working.ts`의 `own`: 처음 부른 쪽의 복사 함수만 쓰여, 얕은 `copyEntity`로 먼저 가진 엔터티는 `attributes`와 `keys`가 처음 모델과 같은 배열이었다(`[entity.update X, attribute.create X]`가 처음 모델의 배열에 넣을 수 있었다). 부르는 쪽의 `copy` 매개변수를 없애고 목록마다 하나인 `copyData`를 두었다: 엔터티는 데이터와 `physical`, `attributes`, `keys`(한 단계 아래의 새 배열과 객체. 처리가 바꾸는 속성과 키는 도우미가 새 객체로 바꾼다), 주제영역은 데이터와 `entities`, 배치는 데이터와 `nodes`, 나머지는 데이터. `entity.ts`의 `copyEntity`와 `ownArea`·`removeNodes`의 복사 함수를 지웠다. 테스트: `working.test.ts`, `describe('작업 상태')` 2개(깊이 얼린 모델에서 `entity.update`로 가진 엔터티의 `physical`·`attributes`·`keys`가 새 배열과 객체이고 값은 같다. 고치기 전에 실패했다. `entity.delete`의 연쇄로 가진 주제영역과 배치), `batch.test.ts`에 깊이 얼린 모델의 `[entity.update x, entity.delete x, entity.create y (subjectArea s)]`(처음 모델이 미리 뜬 사본과 같고 `undo`가 처음 모델 객체를 돌려준다).
- 메모 1: `source-guard.test.ts`, `describe('일의 수: 목록을 고치는 길')` 2개. `handlers/`의 파일과 `editor.ts`를 글로 읽어 `.slice(`, `.filter(`, `.find(`, `.findIndex(`, `.map(`, `.concat(`, `.some(`, `.every(`, `.includes(`, `.indexOf(`, `.splice(`, `.sort(`, `.reverse(`, `[...`를 찾는다. 줄 끝의 `// work-ok: <이유>`만 허용하고 이유 없는 표시는 실패다. `entity.ts`에 `[...`를 한 줄 넣으면 실패하는 것을 봤다. 섞은 묶음의 일의 수는 단계 6.
- 메모 2: 스펙 부록 B `internal` 줄에 하위 명령의 처리가 던지면 `index`와 접두, 처리 밖이면 `index` 없음.
- 메모 3: `createEditor`의 `options`가 객체가 아니면(`undefined`, `null`, 수, 글, 불리언, 함수) 옵션이 없는 것이다. 객체일 때만 `reservedFiles`를 읽는다(단계 5의 정한 것 2에서 `options: null`이 던지던 것을 바꿨다). 테스트를 먼저 고쳐 실패를 봤다. 스펙 FR-01에 한 구절.
- 메모 4: 술어 (가)가 전 목록의 **오류**만 견준다(경고는 견주지 않는다. 단계 5의 정한 것 5를 바꿨다). `policy.test.ts`의 순수 함수 사례를 먼저 고쳐 실패를 봤다. 스펙 FR-04.
- 메모 5: 묶음에서 지우고 다시 만든 항목은 원래 객체이고 목록의 끝에 있다(`batch.test.ts`의 `memo` 사례에 단언). 스펙 FR-08에 한 구절. 코드는 그대로다.
- 메모 7: `handler-throws.test.ts`에 작업 상태를 바꾼(`append`, `own`) 뒤 던지는 처리 사례. `editor.model`이 같은 객체다(고치기 전에도 통과했다).
- 메모 8: "넣은 값이 객체를 공유하지 않는다"는 단계 6에서 표본 17종 모두에 돈다.
- 단계 5 기록의 "정한 것" 수는 아홉이다(위 절의 제목에 적었다. 이 계획의 본문에는 여덟이라 적힌 곳이 없었다).

### 단계 6 (2026-11-28)

- 6.1 테스트(구현 전에 돌려 처리가 없어 33개가 실패하는 것을 봤다). `test.todo` 11개를 모두 채웠다(`grep -rn 'test.todo' packages/core/src/command`의 종료 상태 1).
  - `testing/commands.ts`: `SAMPLE_COMMANDS` 17종 모두에 `items`(기대 데이터)를 채웠다. `handlers.test.ts` "명령 동작"이 표본의 종류가 `commandSchemas`의 17종과 같고 모두 `items`를 가졌음을 단언한다.
  - `handlers.test.ts` "명령 동작" 37개: AC-06 전부(속성의 `unset`과 `physical` 정리, `set.domain`/`set.type`, `unset: ['domain']`+`set.type`, `set.ext`·`physical.types` 통째, `before`와 이동(앞으로, 끝으로, 뒤로), 바뀐 것이 없는 사례 14줄, `physical.types` 순서와 속성의 `scope: both`는 바뀜, `physical: {}`·`keys: []` 그대로, 키 없는 엔터티의 `key.create` → `key.delete`, `subjectArea.create`의 `entities: []`·없음, 생성 셋의 모든 필드, `key.update`·`subjectArea.update`), 깊이 얼린 예제에서 표본을 모두 실행하고 되돌림.
  - `cascade.test.ts` "연쇄와 대상" 12개: AC-10 전부(`attribute.delete`의 키 연쇄와 빈 키·빈 `keys`, 이주된 속성의 세 변경과 이동, `set.migratedFrom`, `not-found` 15줄, 저장만 하는 참조(`R02`, 뒤 명령이 만드는 `batch`), 쓰이는 `id`+없는 `subjectArea`, 없는 엔터티+스키마 위반, `ambiguous-target` 8줄, `subjectArea.delete`·`removeEntities`의 배치 연쇄).
  - `rename.test.ts` "이름 변경" 8개(AC-04), `serializable.test.ts` "명령 직렬화" 20개(AC-01의 왕복, 타입을 준 `attribute.create`, `-0`, `@ts-expect-error` 셋), `ids.test.ts` "ID 만들기"의 편집기 사례 10개(AC-08), `paths.test.ts` "새 파일 경로"의 편집기 사례 5개(AC-09의 "다시 읽기" 앞까지), `history.test.ts`(AC-12 마지막 문장), `policy.test.ts`(부록 D의 나머지 7줄을 글자 그대로. 지금 검증기가 모두 그대로 냈다. AC-07 (가)·(다)·(라)·(마)), `batch.test.ts`(세 명령의 묶음, `pk` 지우고 다시 만들기, 스펙 꼴의 `attribute.update` 묶음과 `order.yaml` 하나만 직렬화·쓰기), `hostile.test.ts`(`subjectArea.create`의 받는 두 줄, 표본 17종마다 넣은 값이 명령과도 모델의 다른 곳과도 객체를 공유하지 않음), `packages/cli/src/core-entry.test.ts` "명령 직렬화: 공개 이름"(빌드한 `@erdmaker/core`에서 값 넷, 타입 다섯, F02의 값).
  - 단계 5 리뷰에서 넘어온 것: `batch.test.ts`에 깊이 얼린 예제의 섞인 묶음 넷(`[entity.update X, attribute.create X]`, `[attribute.update X.a, key.create X, key.update, attribute.delete]`, `[subjectArea.update S, addEntities S, removeEntities S]`, `[entity.create, entity.update, entity.delete, entity.create (subjectArea), subjectArea.delete]`. 처음 모델이 미리 뜬 사본과 같고 `undo`가 처음 모델 객체, `redo`가 결과 모델), 한 묶음 안의 삽입·삭제·이동 뒤의 찾기, 섞인 묶음의 일의 수. `random.test.ts` "명령 동작: 무작위": 깊이 얼린 예제에 17종(묶음 포함)의 무작위 명령과 `undo`·`redo` 2500번(씨앗 20261128). 던지지 않고 `internal`이 없으며 오류가 늘지 않고 처음 모델이 그대로다.
- 6.2 구현: `handlers/attribute.ts`, `key.ts`, `subject-area.ts`, 공통 `handlers/members.ts`(엔터티·멤버·`before` 찾기, 멤버 ID, 수정, 이동, 필드 옮기기), `handlers/update.ts`(`applyUpdate`: `unset` 다음 `set`, `physical` 키 단위, 바꾸면 지우는 짝). `entity.update`도 `applyUpdate`를 쓴다. `find.ts`에 `findMember`. `working.ts`에 멤버 도우미(`memberPositions`, `memberSpace`, `insertMember`, `removeMember`, `moveMember`, `ownMember`, `removeFromKeys`, `dropEmptyKeys`)와 주제영역 도우미(`subjectAreaSpace`, `ownSubjectArea`, `removeFromArea`, `removeAreaNodes`, `removeLayoutsOf`). `registry.ts`에 13종. `index.ts`에 `createEditor`, `commandSchemas`, 타입 `Command`, `CommandResult`, `Editor`, `RejectionCode`. 처리 모듈은 목록을 도우미로만 고친다(`source-guard.test.ts`가 새 파일까지 본다. 허용 표시 0개).
- 6.3 단계 관문 `exit=0`. 64개 파일 1187개 통과, todo 0, `pnpm test` 75.75초(단계 0의 73.99초 + 1.8초). `-t`로 닫는 AC의 `describe`마다 통과: 명령 스키마 73, 명령 직렬화 21, 이름 변경 8, 명령 동작 38, 검증 정책 20, ID 만들기 74, 연쇄와 대상 13, 믿을 수 없는 입력 128, 거부 문구 23, 이력 7, 묶음 20.
- **섞인 묶음의 일의 수**: 다섯 명령(생성한 ID의 `entity.create`, 그 엔터티의 `attribute.create`, `key.create`, 있는 엔터티의 `entity.update`, `entity.delete`)을 n/5번. T(250) = 5401, T(500) = 5801, T(1000) = 6601(Δ250 = 400, Δ500 = 800. 하위 명령 하나에 1.6칸). `tolerance` = 2, `c` = 4.
- 깨뜨려 확인한 것(각각 되돌림. `command/` 테스트의 실패 수): 키 연쇄를 뺌(5), 빈 키를 남김(3), 키를 통째로 지움(2), 빈 `keys`를 남김(1), 주제영역 삭제의 배치 연쇄를 뺌(6), 모든 배치를 지움(1), `removeEntities`의 노드 연쇄를 뺌(6), 모든 배치의 노드를 뺌(2), 이름 바꾸면 `id`도 바뀜(14), 자기 앞으로의 이동이 끝으로 감(1), 끝의 비교에서 원래 항목으로 되돌리지 않음(5), 없는 멤버를 받음(2), 없는 주제영역을 받음(5), `attribute.create`의 `before`가 한 칸 뒤(2), `key.create`의 `before`를 무시(1), 이동의 자리 보정을 뺌(2), `key.move`의 `before`를 무시(5), `set.domain`이 `type`을 남김(1), `unset`을 무시(5), 빈 `physical`을 남김(3), `set.physical: {}`를 바뀐 것으로(2), `subjectArea.create`의 `entities`를 무시(4), 명령의 `entities`를 다른 필드와 공유(8), 이미 든 것도 넣음(2), `removeEntities`를 무시(2), 멤버를 제자리에서 고침(15), 키의 `attributes`를 공유(1), 엔터티 사본이 `attributes`를 공유(16. 단계 5 리뷰의 경고), 삽입·삭제·이동 뒤 멤버 색인을 버리지 않음(1, 2, 1. 처음에는 삽입이 살아남아 "한 묶음 안의 삽입·삭제·이동 뒤의 찾기"를 더했다), 생성 ID가 이름 공간을 보지 않음(2), 주제영역 ID의 경로 검사를 뺌(1), `keys`를 만들지 않음(11), `dataType`을 버림(4), 다른 키를 고침(9), 처음 주제영역을 제자리에서 고침(5). 살아남은 변이는 없다.
- 스펙과 계획이 정하지 않아 정한 것:
  1. **`removeEntities`의 노드**: 연쇄 표의 글 그대로, 명령이 준 엔터티 모두의 노드를 그 주제영역의 배치에서 뺀다(영역에 없던 엔터티의 노드도. 그런 노드는 `R09` 오류라 오류 없는 모델에서는 결과가 같다).
  2. **자기 앞으로의 이동**: `id`와 `before`를 먼저 찾고(`not-found`·`ambiguous-target`은 그대로 낸다) 바꾸지 않는다.
  3. **멤버 찾기**: 엔터티마다 속성·키의 ID 색인을 처음 물을 때 만들고, 끝에 붙이면 이어 고치며, 가운데 넣기·빼기·이동에서는 버리고 다음에 물을 때 다시 만든다(그 명령의 자리 옮기기가 이미 엔터티 크기에 선형이다. FR-10 (1)).
  4. **`attribute.delete`의 키**: 그 속성을 가진 키에서만 빼고, 그래서 빈 키만 지우며, 그 결과 키가 하나도 남지 않을 때만 `keys`를 지운다. 속성을 갖지 않은 키는 건드리지 않는다.
  5. **만든 데이터의 필드 순서**: 형식 스키마의 순서로 넣는다(쓴 글은 스키마 순이라 결과는 같다). `subjectArea.create`의 `entities`는 받은 순서다(쓸 때 정렬된다).
  6. **생성 명령의 찾기 순서**: `entity`, 다음 `before`(부록 A의 필드 순), 그다음 `id-taken`.
- 계획과 달라진 점: (1) 처리 셋 말고 공통 모듈 `handlers/members.ts`, `handlers/update.ts`를 더했다. (2) 단계 5 리뷰의 항목 가운데 단계 6의 처리가 있어야 하는 것(섞인 얼린 묶음, 무작위 시험, 섞인 일의 수)을 이 커밋에 넣었다. (3) AC-08 (아)의 "찾아본 후보 셋"은 단계 3의 함수 수준 테스트가 세고, 편집기 수준은 결과 `s_4`만 본다. (4) 단계 5의 계획과 다른 점 (3)·(5)(AC-13의 `entity.update` 대신 `attribute.update`, `subjectArea.create`의 받는 두 줄)는 스펙의 줄 그대로 채웠다(단계 5의 `entity.update` 사례는 남겨 두었다).

### 단계 7 (2026-11-28)

제품 코드는 바뀌지 않았다(7.6의 증명). 새 테스트가 찾은 결함은 없다. 변이마다 넣어 실패를 본 뒤 `git checkout`으로 되돌렸다.

- 7.1 `undo-roundtrip.test.ts`, `describe('실행 취소 왕복')`, 테스트 20개: 표본 17종이 모두 `items`를 가짐, 표본마다(시작 모델은 `before`를 실행해 저장한 것) 실행 → 저장(기대 `written`·`removed`는 표본의 `items`에서: 값이 있는 파일은 쓰고 `null`인 파일은 지운다) → `undo` → 저장 뒤 어댑터의 파일과 바이트가 처음과 같고 `editor.model`이 시작 모델과 `toBe` → `redo` → 저장 뒤 가운데 상태와 같음, 스펙에 적힌 두 목록(`entity.create` 이름 `배송` → `written: [entities/baesong.yaml]`, `subjectArea.delete sales` → `removed` 둘), 주석 사례(어댑터 호출 0번, 주석이 남음). 어댑터의 파일을 모으는 도우미 `adapterFiles`를 `testing/editing.ts`에 더했다. **변이**(`undo`가 스냅숏 모델의 얕은 사본을 `editor.model`과 결과로 내놓음): 18개 실패, 모두 "`editor.model`이 시작 모델과 `toBe`"(`undo-roundtrip.test.ts` 61행과 88행)에서. 주석 사례(호출 0번)는 계획대로 통과했다.
- 7.2 `write-changes.test.ts`, `describe('바뀐 파일만')`, 테스트 9개: `attribute.update`(직렬화·읽기·쓰기가 `entities/order.yaml` 하나, 나열·지우기 0번, 나머지 28개 바이트 그대로), `subjectArea.removeEntities`(쓴 것 둘, `edges` 그대로), `subjectArea.delete`(쓴 것 0, 지운 것 둘), 쓰기와 지우기가 든 묶음(`writeText` 셋이 모두 `remove` 둘보다 앞이고 각각 경로 순), 새 경로의 `writeText` 실패(거부, `remove` 0번, 지우려던 두 파일의 바이트 그대로), `entities/stray.yaml`·`entities-old/x.yaml`이 저장 두 번 뒤에도 남고 밖에서 이미 지운 `layouts/sales.json`도 `removed`에 듦, `definiton` 사례(`reservedFiles` 없이는 `customer`와 저장 거부, `listReservedFiles`를 주면 `customer_2`와 저장 성공), 폴더 `entities/Customer.yaml` 사례, AC-13의 묶음. 모든 사례에서 바뀌지 않은 항목(매니페스트와 사전 포함)이 전 항목과 `toBe`이고, 예제의 사례에서 `model.yaml`과 `dictionary/`는 어댑터 호출에 나오지 않는다. **변이**(끝의 비교에서 글이 같은 항목을 원래 객체로 되돌리지 않음): AC-13 묶음 사례 1개 실패, `serializeItem`된 파일이 `['entities/memo.yaml', 'entities/order.yaml']`(1378행).
- 7.3 `reload.test.ts`, `describe('다시 읽기')`, 테스트 2개: 예제에서 `entity.create`(`배송`)와 `subjectArea.create`(`entities: [product, address]`) 뒤 저장하고 다시 읽으면 `issues`·`validateModel`이 0개, `serializeModel`이 같고 `baesong`이 `address`와 `category` 사이다. `dictionaries: [entities]`인 빈 모델에서 `entity.create`가 부록 B 3번 문구의 `id-taken`, `subjectArea.create`는 같은 다시 읽기 단언을 통과한다. **변이**(새 엔터티의 경로를 `entities/<id>.yml`로): 2개 실패. 첫째는 다시 읽은 모델에 그 엔터티가 없어 `serializeModel`이 30개 대 31개(29행), 둘째는 문구의 경로가 `.yml`이 되어 거부 결과가 다름(71행).
- 7.4 `packages/cli/src/bundle.test.ts`: 있던 테스트에 단계를 더했다. 컨텍스트 안에서 `loadModel`, `createEditor`, `execute({ type: 'entity.create', name: '배송' })`, `writeChanges`, `validateProject`를 부르고 결과를 안에서 `JSON.stringify`한다. `ok: true`, `id: baesong`, `written: ['entities/baesong.yaml']`, 오류 0개, 엔터티 11개. **변이**(`index.ts`에서 `writeChanges`를 빼고 다시 빌드): `TypeError: erdcore.writeChanges is not a function`(124행)으로 1개 실패. 되돌리고 다시 빌드해 통과를 봤다.
- 7.5 `testing/wide-model.ts`의 `wideModel(entities, attributes)`(속성은 `type: { base: string, length: 40 }`, 주제영역 `all`에 전부, 매니페스트 있음), `editor.perf.test.ts`, 테스트 하나(제한 시간 `60_000`). 오류 0개와 엔터티 1000개를 단언하고, `e500.a7`의 `definition`을 두 값으로 번갈아 바꾸는 `attribute.update`를 준비 1회 뒤 5회 잰다. 매번 재는 구간 밖에서 `ok: true`, 결과의 `model`과 `editor.model`이 전과 다른 객체임을 단언한다. 잰 다섯 값은 `annotate`로 남긴다(`--reporter=verbose`에 보인다. 판정에는 쓰이지 않는다). **변이**(`execute` 앞에 `Date.now()`로 300 ms를 채우는 빈 반복): 다섯 값 353~360 ms, 가장 빠른 것 353.3 ms ≥ 250으로 실패.
- 7.6 변이 증명 `exit=0`. 단계 관문 `exit=0`, 67개 파일 1219개 통과(1187 + 20 + 9 + 2 + 1), `pnpm test` 78.05초. 시간 테스트 15번 `exit=0`(15번 모두 통과). 따로 `--reporter=verbose`로 15번 더 돌려 잰 값: 실행마다 가장 빠른 값이 56.0 / 57.6 / 58.5 ms(최소 / 중앙 / 최대), 잰 75개 전부는 56.0 / 59.2 / 73.3 ms(한도의 약 4.4배 여유). `pnpm test`를 세 번 이어 돌려 모두 통과: 81.18, 81.93, 81.32초(단계 0의 73.99초 + 8초 = 81.99초 이하. 여유가 작다). 새 테스트 파일은 따로 돌리면 합쳐 약 2초이고(`undo-roundtrip`·`reload`·`write-changes` 1.00초, 번들 0.67초, 시간 테스트 약 0.8초), 나머지는 같은 날의 실행마다의 흔들림이다(관문의 실행은 78.05초).
- 계획과 달라진 점: (1) 표본의 기대 `written`·`removed`를 따로 적지 않고 단계 6이 채운 `items`의 파일에서 만든다(`items`는 "명령 동작"이 실제 데이터와 비교한다). (2) `testing/editing.ts`에 `adapterFiles`를 더했다. (3) 시간 테스트의 `describe` 이름은 스펙에 없어 `편집기: 시간`으로 했다.

---

마지막 수정: 2026-11-28 11:20
상태: 진행 중 (단계 7/8 완료)
