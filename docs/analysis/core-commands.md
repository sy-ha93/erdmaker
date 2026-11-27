# F03 `core-commands` 분석 보고서

**분석일**: 2026-11-28
**대상**: 메모리 모델을 고치는 길을 `@erdmaker/core`의 명령 API 하나(`createEditor`)로 만들고, 실행 취소·다시 실행, ID와 파일 경로 만들기, 명령마다 검증, 바뀐 파일만 쓰고 지우는 `writeChanges`를 낸다 (브랜치 `feature/core-commands`)
**스펙**: [docs/specs/core-commands.md](../specs/core-commands.md) FR-01~FR-11, AC-01~AC-18, 부록 A~D. 결정 기록 [docs/decisions/core-commands.md](../decisions/core-commands.md) D-00~D-05
**환경**: Node 22.23.3, typescript ~6.0.3, ajv 8.20.0, yaml 2.9.1, vitest 5.1.2 (모두 `node_modules`의 설치본). 측정은 이 개발 컴퓨터(WSL2, 10코어)에서 `pnpm --filter @erdmaker/core build`로 새로 만든 `dist`로 했다.

표기: **[확인: 방법]** 이 세션에서 실행하거나 파일을 읽어 확인함. **[미확인]** 확인하지 못함. 구현 중에 실행해서 확인해야 한다.
실험 스크립트는 `/tmp/claude-1000/-home-pc-workspace-erdmaker/b8f44d43-ccc8-4fde-9628-61167fb5c8ee/scratchpad/f03-analysis/` 아래에 있다(저장소 밖, 재부팅하면 사라질 수 있다): `perf.mjs`(시간·스냅숏 메모리), `issues-mem.mjs`(오류 목록 메모리), `schema.mjs`(명령 스키마 시제품), `case.mjs`(대소문자·확장자), `ts/probe.ts`·`ts/lib.ts`(타입 검사).

## 0. 요약

1. **명령마다 `validateModel` 한 번은 관문(250 ms) 안에 넉넉히 든다.** 엔터티 1000개 × 속성 15개 + 전부 든 주제영역에서 `validateModel` 65.1 ms, `serializeModel` 679 ms. 4000개에서 249 ms, 2715 ms. 엔터티 하나를 복사하고, 항목 하나를 전후로 직렬화해 견주고, 새 모델을 검증하는 `attribute.update` 흉내가 64.8 ms(5회 최솟값)다. 관문까지 약 3.8배 여유가 있다. 스펙 2장의 관찰(60/603 ms, 237/2410 ms)과 맞는다. [확인: `perf.mjs`]
2. **항목 하나를 직렬화하는 함수가 없다.** `serializeModel`은 모델 전체만 받고, 항목 하나의 글은 `serialize.ts` 229~249행의 익명 화살표 함수 안에서 만든다. "바뀌었는지"(FR-02), 묶음 끝의 비교(FR-08), `writeChanges`(FR-09), 직렬화 감시 테스트(FR-10, AC-05)가 모두 이것을 부른다. **`serializeItem(file, data, schema)`를 따로 모듈로 떼어야 한다.** 엔터티 하나를 글로 바꾸는 데 0.64 ms, 1000개를 든 주제영역 하나는 2.1 ms다. [확인: 코드 읽기, `perf.mjs`]
3. **`validateModel`·`serializeModel`·`writeModel`은 지금 `ReadonlyModel`을 받지 못한다.** 깊은 읽기 전용 타입을 넘기면 셋 모두 `TS2345`다(`readonly …[]`를 `…[]`에 넣을 수 없다). 매개변수 타입을 넓히는 것은 스펙(FR-02)대로이고, 세 함수의 본문은 이미 모델을 고치지 않으므로 동작은 그대로다. AC-01의 `@ts-expect-error` 세 줄은 간단한 `DeepReadonly`로 모두 성립한다(`ext` 안쪽까지). [확인: `ts/probe.ts`]
4. **`prepareSchema`는 공통 스키마의 `$defs`를 `$ref`로 가리키는 명령 스키마를 그대로 받는다.** `$ref`는 형식 스키마 8개의 `$id` 맵으로 풀리고 전부 펼쳐진다. 같은 Ajv 인스턴스(`schemaAjv()`)로 `compile`하면 부록 B의 문구가 글자 그대로 나온다: `/ must NOT be valid`, `/entities must NOT have duplicate items (items ## 0 and 1 are identical)`, `/commands must NOT have fewer than 1 items`, `/commands/0 must be object`, `/commands must NOT have more than 1000 items`. 세 스키마 컴파일에 7.7 ms. [확인: `schema.mjs`]
5. **ID 패턴은 `^[a-z0-9][a-z0-9_-]{0,62}$`(공통 스키마 `$defs.id`)다.** 63자, 소문자·숫자로 시작, `_`와 `-` 허용. 슬러그는 `-`를 만들지 않지만 직접 준 `id`에는 `-`가 올 수 있다. 숫자로 시작하는 `123`도 된다(AC-08). [확인: `format/v0/schema/common.schema.json`]
6. **예제의 파일 이름은 모두 `<id>.yaml`이다.** 엔터티 10개와 주제영역 3개 모두 그렇고, 배치는 `layouts/<주제영역 id>.json`이다. 모델 전체 배치(`subjectArea` 없음)는 예제에 없다. [확인: 파일 목록과 `id:` 줄]
7. **`loadModel`은 파일 이름의 대소문자를 그대로 둔다.** `Customer.yaml`, `cUstomer.yaml`, `customer.yaml`이 모두 엔터티로 읽히고(코드 단위 순), 확장자 비교는 대소문자를 가린다: `Upper.YAML`과 `x.yml`은 **말없이 읽히지 않고 `issues`도 없다.** `listReservedFiles`(FR-06)는 이런 파일도 돌려주므로 ID가 그 자리를 피한다. [확인: `case.mjs`]
8. **오류가 많은 모델에서 이력 100칸의 메모리가 크다.** 정상 모델에서는 100칸이 857 KB였다. 그러나 오류 15000개(1000×15 속성마다 모르는 도메인)인 모델에서 `validateModel` 결과 목록 하나가 약 2.8 MB이고, 칸마다 새 `Issue` 객체를 들면 100칸에 **약 278 MB**다. 같은 오류는 앞 목록의 객체를 다시 쓰도록(인터닝) 권한다(4.4). [확인: `perf.mjs`, `issues-mem.mjs`]
9. **새 경로가 폴더이면 `writeChanges`의 "새 경로의 보호"가 놓친다.** 두 어댑터 모두 폴더를 `readText`하면 `FileNotFoundError`를 낸다(`memory.ts` 49~53행, Node 어댑터 `fs.ts` 271행). 그래서 검사를 통과하고, 지우기를 마친 뒤 쓰기가 `Is a directory`로 실패한다(디스크가 반쯤 바뀐 상태). AC-09의 "폴더 `b.yaml`"이 바로 그 모양이다(예약 경로를 주지 않은 편집기에서). [확인: 코드 읽기. 실패 자체는 실행하지 않음]
10. **명령 스키마는 생성하지 말고 TypeScript로 쓴다.** AC-16이 `format/`과 `packages/core/src/generated/`의 차이가 없어야 한다고 못박는다. 명령은 형식의 일부가 아니다. [확인: 스펙 6.1 읽기]
11. **코어의 `lib`은 ES2022다.** `toSorted`, `toSpliced`, `with`, `findLast`, `structuredClone`은 타입 오류다. 불변 갱신은 `slice`와 펼치기로, 명령 복사는 손으로 쓴다. `String.prototype.normalize('NFKC')`와 `Object.hasOwn`은 된다. [확인: `ts/lib.ts`]

## 1. 관련 코드 탐색 결과

### 1.1 기존 파일

| 파일 | 지금 내용 | 이 기능과의 관계 |
| --- | --- | --- |
| `packages/core/src/index.ts` | F02의 공개 이름(어댑터, `loadModel`, `serializeModel`, `validateModel`, `writeModel`, 타입들, `findModels`, `validateProject`) | `createEditor`, `writeChanges`, `listReservedFiles`, `commandSchemas`, 타입 `Editor`, `Command`, `CommandResult`, `RejectionCode`, `ReadonlyModel`을 더한다 |
| `src/model/types.ts` | `Model`, `ModelItem<T>`, `Issue`, 데이터 타입들. 모두 고칠 수 있는 타입. `manifest`는 선택(`model.yaml`이 빠지면 없다) | `DeepReadonly`와 `ReadonlyModel`을 더한다 |
| `src/model/serialize.ts` | `modelFiles`(147~181행: 모양 검사, `TypeError`), `serializeModel`(212행: 경로 중복 검사 → 항목마다 `checkJsonValue` → `canonical` + `yamlText`/`layoutJson`, `RangeError`를 `TypeError`로) | 항목 하나의 직렬화(229~249행)를 떼어 낸다. 매개변수를 `ReadonlyModel`로 |
| `src/model/canonical.ts` | 스키마 순서와 기본값으로 쓸 모양을 만든다. 깊이 256으로 묶인 재귀. 이미 빈 객체(`physical: {}`)는 남기고, 기본값만 들어 비게 된 선택 객체는 뺀다(185~193행) | 그대로. "바뀌었다"의 판정이 이 규칙을 따른다 |
| `src/model/layout-json.ts` | 배치 JSON을 직접 찍는다(`-0` 유지, 숫자 키 순서 유지) | 그대로 |
| `src/model/write.ts` | `writeModel(fs, model: Model)`(22행): 전체 직렬화 → 경로마다 읽기 → 다른 것만 쓴다. 지우지 않는다 | 매개변수만 `ReadonlyModel`로. `writeChanges`의 참고 구현 |
| `src/model/load.ts` | `loadModel`: `filesUnder`가 명시적 스택으로 걷는다. 목록은 이름의 코드 단위 순(67행), 확장자는 `endsWith`(73행, 대소문자 구별). 실패한 파일은 빼고 `issues`에 | 그대로. `listReservedFiles`의 짝 |
| `src/validate/index.ts` | `modelItems(model: Model)`(17행), `validateModel(model: Model, positions?)`(57행). 게터를 부르지 않고(`field`) 던지지 않는다 | 두 매개변수를 `ReadonlyModel`로 |
| `src/validate/schema.ts` | `schemaIssues(file, name, data)`(12행): Ajv 오류 → `Issue`. 모르는 키는 `path`에 키를 붙이고 문구는 `<instancePath 또는 "/"> <message>` | 명령 스키마 오류의 문구를 같은 꼴로 만든다. `SchemaName`에 묶여 있어 그대로는 못 쓴다(4.3) |
| `src/validate/issues.ts` | `finishIssues`: 위치를 넣고 파일·위치·규칙·문구 순으로 정렬. 위치 색인이 없으면 `line`·`column`이 없다 | 편집기는 위치 없이 부른다. FR-01의 "`line`·`column`이 없다"가 그대로 성립한다 |
| `src/validate/json-value.ts` | `checkJsonValue`(146행): 명시적 스택, 프로토타입 검사(`Object.prototype`/`null`), 배열 하위 클래스는 클래스 인스턴스로 봄, 공유 객체 한도 | 명령 복사기의 참고. 재사용은 하지 않는다(D-02: 한도에서 일찍 멈추지 않고 Proxy를 막지 못한다) |
| `src/validate/rules/*.ts` | R01~R12. 모든 조회가 `Map`/`Set`. R11은 스키마 없음과 `""`를 같은 칸으로 본다(`rules/index.ts` 217~235행). R10은 매니페스트에 `schemas`가 있을 때만 | FR-05 2단계(스키마 접두)의 "없는 것은 빈 글"과 맞다 |
| `src/schema/ajv.ts` | `prepareSchema(schema, root)`(124행): `$ref`를 모두 펼치고 `uniqueItems`를 선형 키워드로 바꾼다. `$ref` 옆에는 주석 키워드만(156~163행). `schemaAjv()`(330행)는 인스턴스 하나 | 명령 스키마를 이것으로 준비하고 같은 인스턴스로 `compile`한다 |
| `src/schema/resolve.ts` | `rootSchema`, `schemaAt`, `objectSchema`, `itemSchema` | 명령 스키마와 형식 스키마의 동기화 테스트에 쓸 수 있다(4.3) |
| `src/fs/path.ts` | `normalizePath`(6행: 빈 구성요소와 `.` 제거, 앞의 `..` 유지, 앞의 `/` 제거), `joinPath`, `relativePath` | FR-01 조건과 FR-06 경로에 그대로 |
| `src/fs/memory.ts` | 대소문자를 가리는 `Map`. 폴더를 읽으면 `FileNotFoundError`. `list`는 전체를 훑는다 | 테스트의 어댑터. 호출 기록용 감싸개를 `testing`에 더한다 |
| `src/testing/*` | `example.ts`(`exampleFiles`, `replaceOnce`, `exampleFileSystem`), `cases.ts`(F02 부록 A 사례), `big-model.ts`(관계·서브타입이 든 큰 모델), `timing.ts`(`expectLinearTime`, `bestTime`), `generate.ts`(무작위 문자열·JSON·모델). 빌드에서 빠진다(`tsconfig.json`의 `exclude`에 `src/testing`) | 표본 명령, 1000×15 모델, 호출 기록 어댑터를 여기에 둔다 |
| `packages/core/tsconfig*.json` | 기본 `lib ES2022`, `types []`. `tsconfig.test.json`이 테스트까지 타입 검사(`pnpm lint`의 `typecheck`) | 그대로. AC-01의 `@ts-expect-error`가 여기서 검사된다 |
| `vitest.config.ts` | `unit`과 `perf` 두 프로젝트. `*.perf.test.ts`는 다른 테스트 뒤에 한 파일씩 | 새 시간 테스트는 `command/*.perf.test.ts` (AC-15의 이름 그대로) |
| `packages/cli/src/bundle.test.ts` | Vite IIFE를 `vm`에서 돌려 예제의 `validateProject` | AC-02의 단계를 더한다 |
| `packages/cli/src/main.ts` | `oneLine`(38행), `describeError`(500 코드 포인트 자르기) | 코어에 같은 규칙의 작은 도우미를 따로 둔다(FR-03, D-03). CLI는 고치지 않는다 |
| `docs/format-v0.md` | 70행(스키마 접두 문장), 157행(열린 질문의 한글 ID), 20~35행(프로젝트·모델·주제영역) | FR-11 |
| `CLAUDE.md` | 13행 "지금 상태" | FR-11 (`createEditor`) |
| `docs/stage1-backlog.md` | 96행(F01), 103행(F02)에 상태 줄 | 스펙 밖. F02처럼 끝에 F03 상태 줄을 더할지 정한다 |

### 1.2 F02의 흐름 (명령이 얹힐 자리)

```
loadModel(fs, dir) → { model, issues(빠진 파일·주석), positions }
        │
        ▼
createEditor(model, { reservedFiles })   ← 새로 만든다
   ├─ 모양 검사(FR-01 조건 1~4) → TypeError
   ├─ issues = validateModel(model)       (위치 없이)
   └─ 처음 경로 집합, 예약 경로(소문자), 이력 []
        │
execute(command: unknown)
   ├─ 재진입 검사 → busy
   ├─ copyCommand(command)  ─ 한도·Proxy·프로토타입 → invalid-command
   ├─ type 확인 → 종류의 스키마(prepareSchema + schemaAjv().compile, 처음 쓸 때)
   ├─ handler(작업 모델, 사본) ─ 찾기(not-found / ambiguous-target) → id-taken → 불변 갱신(연쇄 포함)
   │     (batch: 하위 명령마다 3·4단계와 handler. 실패하면 index와 접두)
   ├─ 끝의 비교: 손댄 항목을 serializeItem으로 전후 비교 → 같으면 원래 객체로
   │     모두 같으면 → ok, 전 모델 그대로, 이력·검증 없음
   ├─ validateModel(새 모델) → 오류 수 비교 → validation 거부 또는 받음
   └─ 커밋: model, issues, 이력에 (전 모델, 전 issues), 다시 실행 목록 비움
        │
writeChanges(fs, before, after)          ← 새로 만든다
   ├─ 조건(두 모델의 FR-01 조건, 같은 dir) → TypeError
   ├─ 대소문자만 다른 경로 쌍 → Error
   ├─ 다섯 목록에서 객체가 다른 항목만 serializeItem
   ├─ 쓸 경로를 코드 단위 순으로 한 번씩 readText (새 경로가 읽히면 거부)
   └─ remove(before에만 있는 경로) → writeText(글이 다르거나 없는 것)
```

### 1.3 재사용할 것

| 대상 | 위치 | 쓰는 곳 |
| --- | --- | --- |
| `normalizePath`, `joinPath` | `fs/path.ts` 6, 19행 | FR-01 조건("`normalizePath(x) === x`"), FR-06 새 경로, 사전 폴더 비교, 예약 경로 정규화 |
| `prepareSchema`, `schemaAjv` | `schema/ajv.ts` 124, 330행 | 명령 스키마 준비와 컴파일. 사용자 정의 키워드(`erdmakerUniqueItems`)가 이 인스턴스에만 있으므로 **반드시 같은 인스턴스**여야 한다 |
| 항목 직렬화 | `serialize.ts` 225~248행 (떼어 낼 것) | 바뀜 판정, 묶음 끝 비교, `writeChanges` |
| `validateModel` | `validate/index.ts` 57행 | 명령마다 한 번. `createEditor`에서 한 번 |
| `escapePointerToken` | `parse/pointer.ts` 2행 | 복사 실패의 `<path> must be a JSON value` |
| `compareCodeUnits` | `compare.ts` | 문구의 "코드 단위 순", 쓸 경로 순서, `written`/`removed` 정렬 |
| `FileNotFoundError` | `fs/adapter.ts` 27행 | `writeChanges`의 읽기에서 "없음"과 다른 실패를 가른다 |
| `isAbsoluteEntry` | `validate/manifest.ts` | FR-06의 "절대 경로 항목은 뺀다" |
| `createMemoryFileSystem` | `fs/memory.ts` | 모든 테스트, AC-02 번들 |
| `exampleFiles`, `replaceOnce`, `exampleFileSystem` | `testing/example.ts` | "예제"와 "빈 모델" 시작 모델, AC-03의 주석 넣은 사례, AC-05의 깨진 `customer.yaml` |
| `expectLinearTime`, `bestTime` | `testing/timing.ts` | AC-15는 `bestTime`(준비 1회 + 5회 최솟값). "제곱이 없다"를 보이고 싶은 곳(묶음 1000개, ID 후보)은 `expectLinearTime` |
| `Random`, `randomString`, `AWKWARD_STRINGS` | `testing/generate.ts` | 슬러그와 한 줄 처리의 성질 테스트 |
| `bigModel` | `testing/big-model.ts` | **AC-15에는 맞지 않는다**(엔터티 대부분이 속성 2개). 1000×15 모델 만드는 도우미를 따로 둔다 |
| CLI `oneLine`의 규칙 | `cli/src/main.ts` 23~44행 | 코어 도우미가 같은 문자 집합(`[\u0000-\u001f\u007f-\u009f -‮⁦-⁩\ud800-\udfff]`, `u` 플래그)과 같은 이스케이프를 쓴다. 코드는 복사하고 가져오지 않는다 |

외부 의존성은 더하지 않는다(AC-18: `dependencies`가 `ajv`, `yaml` 그대로). 로마자 표는 68개 글(초성 19, 중성 21, 종성 28)이라 코드에 직접 적는다.

## 2. 영향 범위

### 2.1 만들 파일 (제안하는 배치)

```
packages/core/src/
  model/
    serialize-item.ts        serializeItem(file, data, schema): string  (serialize.ts에서 뗀 것. 감시 지점)
  command/
    types.ts                 Command(17종 합집합), CommandResult, RejectionCode, Editor, Issues
    schemas.ts               commandSchemas: 종류 → 준비 전 스키마 (손으로 쓴 TS 객체, 얼림)
    check.ts                 종류별 지연 컴파일, 오류 고르기(경로, 문구 순), 문구 만들기
    copy.ts                  copyCommand: 한도 셋, Proxy·게터·프로토타입, 명시적 스택
    message.ts               oneLineMessage: 제어 문자 이스케이프 + 500 코드 포인트 자르기
    slug.ts                  slugify(text), 한글 음절 로마자 표
    ids.ts                   후보 순서, 이름 공간, Windows 예약 이름, 거부 이유 다섯
    paths.ts                 새 항목 경로, 대소문자 접은 경로 집합, 사전 폴더 판정, listReservedFiles
    find.ts                  대상 찾기(not-found / ambiguous-target), 부록 B 문구
    working.ts               작업 모델: 목록별 쓰기 시 복사(copy-on-write), 항목 바꾸기·더하기·빼기
    handlers/entity.ts       entity.create / update / delete
    handlers/attribute.ts    attribute.create / update / delete / move
    handlers/key.ts          key.create / update / delete / move
    handlers/subject-area.ts subjectArea.create / update / delete / addEntities / removeEntities
    registry.ts              종류 → { schema, handle } (batch 제외 16종)
    changes.ts               끝의 비교(원래 객체로 되돌리기), 두 모델의 같음
    editor.ts                createEditor, execute/undo/redo, batch, 재진입, 거부 규칙, 이력 100칸
    write-changes.ts         writeChanges
    *.test.ts                AC별 (아래 3.4)
    editor.perf.test.ts      AC-15 (이름은 command/*.perf.test.ts 꼴)
  testing/
    commands.ts              표본 명령(17종 × 시작 모델과 기대값), 덮음 단언용 목록
    recording-fs.ts          호출을 기록하는 어댑터 감싸개(읽기·쓰기·지우기·list 순서)
    wide-model.ts            엔터티 n개 × 속성 m개 + 전부 든 주제영역 하나
```

- 처리(handler)를 종류 묶음마다 모듈로 나누는 이유: AC-11의 "처리 하나가 던지도록 모듈을 바꿔치기"는 `vi.mock('./handlers/entity.js', …)`로 한다. 처리와 레지스트리가 한 파일이면 바꿔치기가 닿지 않는다.
- `serializeItem`을 따로 두는 이유도 같다. F02의 `serialize-too-large.test.ts`가 쓰는 `vi.mock(path, async (importOriginal) => …)` 꼴로 감시하려면 부르는 쪽과 다른 모듈이어야 한다.
- `validateModel` 호출 수(AC-13, AC-15)는 `vi.mock('../validate/index.js', …)`로 센다. 편집기는 `validateModel`을 반드시 `../validate/index.js`에서 가져와야 한다(`../index.js`를 거치면 감시 경로가 달라진다).

### 2.2 고칠 파일

| 파일 | 변경 | 위험 |
| --- | --- | --- |
| `src/model/types.ts` | `DeepReadonly<T>`(배열 → `readonly DeepReadonly<U>[]`, 객체 → `{ readonly [K]: … }`), `ReadonlyModel = DeepReadonly<Model>` | 낮음 (`ts/probe.ts`로 확인) |
| `src/model/serialize.ts` | 항목 직렬화를 `serialize-item.ts`로 옮기고 부른다. `serializeModel(model: ReadonlyModel)`, `modelFiles(model: ReadonlyModel)` | 중 (F02 직렬화 테스트 1436줄과 `serialize-too-large.test.ts`가 그대로 통과해야 한다) |
| `src/model/write.ts` | `writeModel(fs, model: ReadonlyModel)` | 낮음 |
| `src/validate/index.ts` | `modelItems(model: ReadonlyModel)`, `validateModel(model: ReadonlyModel, …)` | 낮음 (본문이 `field`로만 읽는다) |
| `src/index.ts` | FR-01의 공개 이름 아홉 | 낮음 |
| `packages/cli/src/bundle.test.ts` | AC-02: 번들 안에서 `createEditor` → `entity.create` `배송` → `writeChanges` → `validateProject` | 낮음 |
| `docs/format-v0.md` | 70행 교체, 157행 삭제, 20~35행 절에 사전 폴더 한 문장. AC-16의 `grep` 문자열을 글자 그대로 넣는다(`그 엔터티와 테이블명이 같고 스키마가 다르면`, `한글은 로마자로 옮긴다`, `docs/specs/core-commands.md`, ``사전 폴더를 `entities` ``) | 낮음 |
| `CLAUDE.md` | 13행에 `createEditor` | 낮음 |
| `docs/stage1-backlog.md` | (스펙 밖, 선택) 114행 절 끝에 F03 상태 줄 | 낮음 |

바꾸지 않는 것: `format/`, `packages/core/src/generated/`(AC-16), `packages/core/package.json`의 `dependencies`(AC-18), CLI 소스(D-03), `spikes/`(AC-17), CI.

### 2.3 순서 제약

| # | 제약 | 근거 |
| --- | --- | --- |
| C1 | `serializeItem` 떼기와 타입 넓히기는 F02 테스트가 그대로 통과하는 커밋 하나로 먼저 한다 | 뒤 단계가 모두 이것을 쓴다. 동작이 바뀌면 안 된다 |
| C2 | `spikes/` 기준선은 첫 명령으로 만든다(`repo-scaffold.md` 6.5). F02는 `docs/handoff/core-model-io-spikes-before.sha256`에 두었다 | AC-17. `spikes/`는 지금 추적하지 않는 폴더다(`git status`의 `??`) |
| C3 | AC-02(번들)는 `pnpm build` 뒤에만 의미가 있다 | 번들은 `packages/core/dist/index.js`를 묶는다. F02 분석 C5와 같다 |
| C4 | 처리 모듈보다 `copy`·`check`·`message`가 먼저다 | 처리는 검사를 통과한 사본만 받는다 |
| C5 | 명령 스키마의 `$ref`는 형식 스키마가 Ajv에 들어간 뒤에 풀린다 | `prepareSchema`가 `schemaRoots`(모듈을 읽을 때 만든다)로 푼다. `schemaAjv()`를 먼저 불러 인스턴스를 만든 뒤 `compile` |

## 3. 아키텍처 분석과 따를 규칙

### 3.1 F01·F02에서 이어지는 규칙

| 규칙 | 근거 | 새 코드에 |
| --- | --- | --- |
| ESM, 상대 import에 `.js` | NodeNext | 그대로 |
| 코어는 `lib ES2022`, `types []` | `tsconfig.json` | `toSorted`·`toSpliced`·`with`·`findLast`·`structuredClone`·`console` 없음 [확인: `ts/lib.ts`] |
| 사용자 데이터를 걷는 코드는 재귀하지 않고 명시적 스택 | `json-value.ts`, `load.ts` `filesUnder`, `canonicalJson` | 복사기(깊이 한도가 32라 재귀도 되지만, Proxy 트랩과 한도 순서를 한 곳에서 다루기에 스택이 낫다) |
| 사용자 글을 키로 쓰는 곳은 `Map`/`Set` | F02 D-11 F(`__proto__`), `ajv.ts` `duplicateScalars` | ID·경로·이름 공간 색인은 모두 `Map`/`Set`. `{}`에 `obj[id] = …`를 쓰지 않는다 |
| 사용자 키가 든 객체를 만들 때 `Object.assign`과 `out[key] = v`를 쓰지 않는다 | F02 분석 4.2 끝 | 복사기는 `Object.defineProperty`(값, 쓰기·열거·설정 가능)로. 펼치기(`{...x}`)는 자기 속성을 만들므로 된다. `set`의 키는 스키마가 정한 이름뿐이라 대입해도 된다 |
| 정렬은 `compareCodeUnits` | `compare.ts` | 문구의 "코드 단위 순" 전부 |
| 형식 위반은 `Issue`로, 호출하는 코드의 잘못은 `TypeError`로 | F02 D-06, D-07 | 편집기: 모델 모양은 `createEditor`의 `TypeError`, 명령은 거부 결과(던지지 않음). `writeChanges`: 조건은 `TypeError`, 대소문자·차지된 경로는 `Error` |
| 던지지 않는 함수는 바깥에서 한 번 `try`로 감싼다 | `validateModel`, CLI `describeError` | `execute`/`undo`/`redo` 전체를 감싸 `internal`로. `Unexpected error: <메시지>`의 메시지 꺼내기도 던질 수 있으니 `describeError`처럼 다시 감싼다 |
| 문구는 글자 그대로 테스트 | F02 부록 A, `rules.test.ts` | 부록 B의 모든 문구, 부록 D의 `Issue` 전체를 `toEqual` |
| 시간 테스트는 `*.perf.test.ts`, `expectLinearTime`(비 8, 백스톱) | `vitest.config.ts`, `timing.ts` | AC-15는 `bestTime`. 선형성 확인을 더한다면 `expectLinearTime` |
| 테스트 이름: `describe`는 한국어(스펙의 테스트 이름), `test`는 영어 | `write.test.ts` `describe('바뀐 파일만 쓰기')` | AC의 이름 그대로: "명령 직렬화", "명령 스키마", "실행 취소 왕복", "이름 변경", "바뀐 파일만", "저장의 조건", "명령 동작", "검증 정책", "ID 만들기", "새 파일 경로", "다시 읽기", "연쇄와 대상", "믿을 수 없는 입력", "거부 문구", "이력", "묶음", "편집기 만들기" |
| 고치기 전에 실패하는 테스트를 먼저 | F02 계획 7장 | 그대로 |
| 요구를 바꾸는 곳에는 그 자리에서 Codex 리뷰 | F02 D-11 "돌아볼 점", F03 D-00 | 계획에 적는다 |

### 3.2 명령 스키마: 생성할지, TypeScript로 쓸지

- **TypeScript로 쓴다.** `generated/schemas.ts`는 `format/v0/schema/*.json`을 박는 생성물이고 AC-16이 그 폴더의 변경을 막는다. 명령은 형식이 아니라 코어의 API다.
- `commandSchemas`는 공개 값이라 부르는 쪽이 고칠 수 있다. 컴파일을 처음 쓸 때 하므로 그 전에 고치면 검사가 바뀐다. **깊게 얼린 객체로 내보낸다**(`Object.freeze`를 재귀로, 모듈을 읽을 때 한 번).
- 모델 값은 공통 정의 일곱을 `$ref`로 가리키되, `name`(`minLength: 1`), `physical.name`(`minLength: 1`), `physical.schema`(글), `order`(정수, 0 이상), `nullable`(불리언), `nameSource`(열거), 키 `kind`(열거), 속성 `scope`(기본값 없는 열거)는 엔터티·주제영역 스키마의 것을 **옮겨 적어야 한다**(스펙: "가리키는 형식 스키마는 이것 하나다"). 옮겨 적은 조각이 형식과 어긋나지 않는지 `resolve.ts`의 `schemaAt`으로 꺼내 비교하는 동기화 테스트를 둔다(F02의 `schemas.test.ts`와 같은 생각).
- `type` 필드는 `{ const: '<종류>' }`로 두어도 문구에 영향이 없다(종류 확인이 스키마보다 먼저다).
- 공통 `scope`에는 `default: both`가 있다. 명령 스키마의 속성 `scope`가 이것을 `$ref`로 가리켜도 Ajv는 `useDefaults` 없이 기본값을 넣지 않는다. 데이터에도 영향이 없다.
- 수동 TS 타입(`Command`)과 스키마는 원본이 둘이다. 표본 명령을 `Command`로 타입을 주고 스키마로 검사하는 AC-01이 둘의 어긋남을 일부 잡는다.

### 3.3 공통 관심사

| 관심사 | 방식 |
| --- | --- |
| 파일 접근 | `writeChanges`와 `listReservedFiles`만 어댑터를 쓴다. 편집기는 파일에 닿지 않는다 |
| 오류 처리 | 거부 결과 여덟 코드. 예외는 `createEditor`의 `TypeError`와 `writeChanges`의 거부뿐 |
| 검증 | 명령 모양: Ajv(명령 스키마). 모델: `validateModel` 전체를 명령마다 한 번 |
| 캐시 | 종류별 컴파일 함수. 선택: 항목 → 글(`WeakMap`), 오류 목록 → 키 집합(`WeakMap`), 모델 → 경로 집합(`WeakMap`) |
| 로깅 | 없다 |
| 인증·권한 | 없다 |

### 3.4 컴포넌트 사이의 계약

| 보내는 쪽 → 받는 쪽 | 계약 |
| --- | --- |
| F10 화면, F08 MCP, CLI → core | `createEditor(model, { reservedFiles })`, `editor.execute(command)`, `undo`, `redo`, `writeChanges(fs, before, after)`, `listReservedFiles(fs, dir)` |
| F04, F05, F10 → core 안 | 종류 하나 = `registry.ts`의 `{ schema, handle }` 한 쌍. 입력 검사·검증·이력·결과는 `editor.ts` 한 곳 |
| F08 → core | `commandSchemas`를 MCP 도구 입력 스키마의 원본으로 쓴다. 단 4.3의 "`$ref`가 urn을 가리킨다" 주의 |
| editor → validate | `validateModel(model)` (위치 없음) |
| editor·writeChanges → model | `serializeItem(file, data, schema)` |

## 4. 위험과 확인 결과

### 4.1 스펙의 주장과 코드 대조

| # | 스펙의 주장 | 코드에서 본 것 | 판정 |
| --- | --- | --- | --- |
| V1 | 2장: 1000개에서 `validateModel` 60 ms, `serializeModel` 603 ms. 4000개에서 237, 2410 ms | 65.1/679, 248.9/2715 ms (모델 모양이 조금 다르다: 속성마다 `type`, `definition`, `physical.name`) | 맞다 [확인: `perf.mjs`] |
| V2 | FR-02·FR-10: 손댄 항목을 직렬화해 비교한다, "항목 하나를 글로 바꾸는 내부 함수"를 감시한다 | 그런 함수가 없다. `serialize.ts` 229~249행의 익명 함수 | **떼어 내야 한다** (2.1) |
| V3 | FR-02: `validateModel`, `serializeModel`, `writeModel`의 매개변수를 넓힌다(동작 그대로) | 셋 모두 `Model`. 넘기면 `TS2345`. 본문은 읽기만 한다(`field`, `modelFiles`의 `unknown` 읽기) | 넓히면 된다 [확인: `ts/probe.ts`] |
| V4 | FR-03: 명령 스키마는 공통 정의를 `$ref`로, 같은 준비 과정과 Ajv | `prepareSchema`가 urn을 `schemaRoots`로 풀고 펼친다. 부록 B 문구 다섯을 글자 그대로 냈다 | 맞다 [확인: `schema.mjs`] |
| V5 | FR-03: ID 목록은 `{ type: array, items: { $ref }, uniqueItems: true }`, `$ref` 옆에 다른 키워드 없음 | `prepareSchema`는 `$ref` 옆에 주석 키워드만 받는다(156~163행). `items`가 `$ref`뿐이면 `hashedTypes`가 `undefined`라 `erdmakerUniqueItems`(정렬 키 비교)가 된다. 문구는 Ajv와 같다 | 맞다 [확인: `schema.mjs`] |
| V6 | FR-05: 결과는 63자 | `$defs.id`의 패턴이 63자, 첫 글자 `[a-z0-9]` | 맞다. 슬러그의 앞뒤 `_`를 떼므로 첫 글자도 맞다 |
| V7 | FR-06: 새 엔터티는 `entities/<id>.yaml` | 예제가 모두 그 꼴 | 맞다 |
| V8 | FR-06: 대소문자만 다른 처음 경로 | `loadModel`은 대소문자를 그대로 둔다. `.YAML`, `.yml`은 읽지도 알리지도 않는다(73행) | 맞다. `.YAML` 파일은 `listReservedFiles`로만 보호된다 [확인: `case.mjs`] |
| V9 | FR-09: 새 경로에서 "무엇이든 읽히면" 거부 | 폴더는 두 어댑터 모두 `FileNotFoundError` | **폴더를 놓친다** (4.5 W1) |
| V10 | FR-07: 건드리지 않은 `physical: {}`, `keys: []`는 그대로 | `canonical`이 이미 빈 객체를 남긴다(185~193행). 빈 배열도 남는다 | 맞다 |
| V11 | FR-02: 기본값을 적은 값(`scope: both`)은 바뀐 것이 아니다 | 엔터티·키의 `scope`는 공통 정의를 가리켜 기본값 `both`가 있다. **속성의 `scope`는 F02 FR-07로 기본값이 없다** → 속성에 `scope: both`를 넣으면 바뀐 것이다. 속성 `nullable: true`, `rolenamed: false`는 기본값이라 바뀐 것이 아니다 | 스펙의 예(엔터티)는 맞다. 테스트에서 속성 쪽을 헷갈리지 않게 |
| V12 | FR-05 2단계: 스키마 없음은 빈 글 | R11이 같은 규칙(`rules/index.ts` 232행) | 맞다 |
| V13 | FR-01: 성공의 `issues`에 `line`·`column`이 없다 | `placeIssue`가 색인이 없으면 뺀다 | 맞다 |
| V14 | AC-09: 예제에 `배송`을 만들면 `baesong`이 `address`와 `category` 사이 | 편집기 모델에서는 끝에 붙고, 다시 읽은 모델은 이름순. `serializeModel`이 파일순으로 내므로 두 직렬화가 같다 | 맞다 |
| V15 | 부록 C 표 | 초성 19·중성 21·종성 28이 유니코드 자모 순서와 맞다. `ㄼ`과 `ㄿ`이 둘 다 `lp`, 종성 `ㅈ`·`ㅊ`·`ㅎ`이 `j`·`ch`·`h`(소리 규칙이 아닌 글자 옮김)다. 예 여섯(`gogaek`, `jumunbeonho`, `gaps`, `dalk`, `ilkgi`, `baesong`)을 손으로 따라가 맞음을 봤다. `엔터티` → `enteoti`도 맞다 | 맞다. 표 크기 68개 [확인: 손 계산] |
| V16 | AC-08: 전각 `ＡＢＣ１` → `abc1`, `café` → `caf` | NFKC가 `ABC1`, `é`는 합쳐진 한 글자(구분자)로 남는다 | 맞다 [확인: `case.mjs`] |
| V17 | AC-03: `subjectArea.delete`(`sales`) → `removed: [layouts/sales.json, subject-areas/sales.yaml]` | `layouts/sales.json`의 `subjectArea: sales`. 다른 배치는 `catalog` | 맞다 |
| V18 | AC-10: "`layouts/catalog.json`에 그 노드를 넣은 모델" | 배치 명령이 없으므로 테스트가 손으로 모델을 만들어 새 편집기에 넘겨야 한다 | 맞다(테스트 작성 주의) |

### 4.2 명령마다 전체 검증의 비용 (FR-04, FR-10, AC-15)

| 모델 | `validateModel` | 항목 하나 직렬화 | `attribute.update` 흉내 |
| --- | --- | --- | --- |
| 1000 × 15 | 65.1 ms | 엔터티 0.64 ms, `canonical`만 0.06 ms, 1000개 든 주제영역 2.1 ms | 64.8 ms |
| 4000 × 15 | 248.9 ms | 엔터티 0.67 ms, 주제영역 8.6 ms | 249.5 ms |

- 비용의 거의 전부가 `validateModel`이다. 항목 직렬화는 YAML `Document.toString`이 대부분이다(`canonical`의 10배).
- 관문 250 ms까지 이 컴퓨터에서 3.8배. GitHub Actions 러너가 2~3배 느려도 통과한다고 본다. [미확인: CI에서 재지 않음]
- 첫 `execute`는 그 종류의 스키마 컴파일(2~3 ms)이 더해진다. `createEditor`는 `validateModel`을 한 번 부르므로 첫 호출이면 형식 스키마 컴파일(약 85 ms, F02 분석)도 든다. AC-15는 준비 실행 1회가 있어 영향이 없다.
- 4000개 모델에서는 명령 하나가 약 250 ms다(알려진 한계 8장에 이미 있다). F10의 입력 반응에 부담이 되면 증분 검증은 뒤 기능이다.
- **권고**: AC-15는 스펙대로 `bestTime(5)`과 250 ms. 덧붙여 묶음 1000개(`entity.create` 1000개)의 시간을 `expectLinearTime`으로 한 번 보면 4.6의 제곱 위험을 잡는다.

### 4.3 명령 스키마와 오류 고르기

- **"경로"의 뜻이 둘이다.** FR-03 4단계는 "경로, 문구의 코드 단위 순으로 첫 것"이라고 한다. Ajv의 `instancePath`로 보면 `{ type: 'attribute.create', entity: 'order', foo: 1 }`의 두 오류가 모두 `""`이고 문구 순으로 `/ must NOT have additional properties`가 먼저다(`N` < `h`). F02 `schemaIssues`의 `path`(모르는 키는 `/foo`)로 보면 `/ must have required property 'name'`이 먼저다. [확인: `schema.mjs`] 부록 B와 AC는 한 번에 한 오류만 만드는 사례라 어느 쪽인지 정하지 않는다. **권고**: F02의 `path` 규칙을 그대로 쓴다(스펙이 "F02의 `schema` 오류와 같은 꼴"이라 하므로). `schemaIssues`를 `ValidateFunction`을 받는 함수로 한 겹 일반화해 형식과 명령이 같은 코드를 쓴다.
- `oneOf`(`default`)는 오류 네 개를 낸다: `/default must be string,number,boolean`, `/default must have required property 'expression'`, `/default must NOT have additional properties`, `/default must match exactly one schema in oneOf`. F02의 `path` 규칙이면 모르는 키의 것만 `path`가 `/default/x`라 뒤로 가고, 남은 셋 가운데 문구 순 첫 것 `/default must be string,number,boolean`이 고른 오류다. 부록 B가 계약으로 정하지 않은 문구라 테스트로 고정하지 않아도 된다.
- **F08로 넘길 주의**: `commandSchemas`는 `urn:erdmaker:format:0.1:common#/$defs/…`를 가리킨다. MCP 클라이언트는 이 urn을 풀 수 없다. 준비한 스키마는 표준이 아닌 키워드(`erdmakerUniqueItems`)를 담아 그대로 내보낼 수도 없다. F08에서 "`$ref`만 펼치고 `uniqueItems`는 그대로 둔" 사본을 만드는 도우미가 필요하다. F03의 일은 아니지만 `commandSchemas`의 모양을 정할 때 알고 있어야 한다.

### 4.4 이력 100칸의 메모리 (FR-02, FR-08)

| 경우 | 100칸이 더 붙드는 힙 |
| --- | --- |
| 1000 × 15, 오류 없음, 칸마다 엔터티 하나 수정 | 857 KB (대부분 `entities` 배열 사본 1000칸 × 8바이트 × 100) |
| 주제영역 `entities` 1000개를 칸마다 복사 | 796 KB |
| 오류 15000개 모델, 칸마다 `validateModel` 결과 | 약 2.8 MB × 100 = **약 278 MB** |

- 정상 모델에서는 문제없다. 오류가 많은 모델(가져오기 직후, F07)에서 칸마다 새 `Issue` 객체와 새 문구 글을 들어 메모리가 커진다. [확인: `issues-mem.mjs`]
- **권고**: `validateModel`의 결과에서 앞 목록(`editor.issues`)과 `rule`, `file`, `path`, `message`, `severity`가 모두 같은 `Issue`는 앞 객체로 바꿔 든다. FR-04의 "새 오류" 계산에 그 키 집합이 어차피 필요하므로 추가 비용이 없다. 칸마다 배열만 새것(15000 × 8바이트 = 120 KB)이 되어 100칸에 약 12 MB다. FR-03의 "`Issue`는 `validateModel`이 낸 그대로다"는 값이 같다는 뜻으로 읽힌다. 객체 동일성까지 요구하는지 확인이 필요하다(열린 질문 Q3).
- 키는 `JSON.stringify([rule, file, path, message])`로 만든다. 문구에 사용자 글(테이블명 등)이 들어가 구분 문자를 넣어 잇는 방식은 겹칠 수 있다.

### 4.5 저장(`writeChanges`)

| # | 위험 | 권고 |
| --- | --- | --- |
| W1 | 새 경로가 **폴더**이면 `readText`가 `FileNotFoundError`라 보호를 통과하고, 지우기 뒤 쓰기에서 `Is a directory`(메모리)나 쓰기 거부(Node)로 실패한다. 스펙이 약속한 "검사에서 거부되면 아무것도 바뀌지 않는다"의 밖이다 | 새 경로의 부모 폴더를 `list`해(새 경로가 생기는 폴더는 `entities/`, `subject-areas/` 둘뿐) 같은 이름의 `directory` 항목이 있으면 같은 문구로 거부한다. 쓸 경로가 새 경로일 때만 부르므로 AC-05의 `attribute.update` 사례(읽기 하나)에 영향이 없다. 스펙을 고쳐야 한다(열린 질문 Q1) |
| W2 | 대소문자 규칙이 `before`와 `after`의 경로 전부에 걸린다. 대소문자를 가리는 파일 시스템(Linux)에서 `entities/A.yaml`과 `entities/a.yaml`을 둘 다 가진 모델을 읽으면, 그 둘과 상관없는 편집도 **영원히 저장되지 않는다.** AC-09의 세 파일 사례(`Customer`, `cUstomer`, `customer`)가 바로 그런 모델이다 | 스펙은 "손으로 만든 모델을 막는 규칙"이라 했지만 읽은 모델에서도 생긴다. (가) 알려진 한계에 한 줄 적는다 (나) 쓰거나 지울 경로가 낀 쌍만 거부한다. (나)가 사용자에게 낫지만 스펙 변경이다(열린 질문 Q2) |
| W3 | "쓸 항목"은 객체 동일성으로 고른다. 편집기를 거치지 않고 손으로 만든 `after`는 모든 항목이 다른 객체라 전부 직렬화·읽기한다 | 스펙대로다. 비용은 `writeModel`과 같다 |
| W4 | `remove`가 `writeText`보다 먼저다(AC-05). 쓰기에서 실패하면 지운 파일은 이미 없다 | 스펙 8장의 한계. 그대로 |
| W5 | 매니페스트와 사전은 보지 않는다 | `writeChanges`가 다섯 목록만 훑으면 AC-05의 "매니페스트와 사전 경로는 읽히지 않는다"가 성립한다 |

### 4.6 편집기 안의 비용과 모양

| # | 위험 | 권고 |
| --- | --- | --- |
| E1 | FR-10의 "쓰이는 경로의 집합을 편집기마다 한 번 만들어 두고"와 "모델의 경로가 명령마다 바뀐다"가 부딪친다. 묶음 안에서는 작업 모델의 경로도 하위 명령마다 바뀐다 | 예약 경로 집합(소문자)은 편집기를 만들 때 한 번. 모델 경로 집합은 모델 객체마다 처음 필요할 때 만들어 `WeakMap`에 둔다. 묶음의 작업 상태에서는 만든 경로를 더하고 지운 경로를 빼며 이어 쓴다. 한 명령에 모델 크기의 선형이라 FR-10을 지킨다 |
| E2 | 묶음 1000개 × 명령마다 O(n) 색인 다시 만들기 = 1000 × n. 4000개 모델이면 수백만 번의 `toLowerCase`와 `Map` 만들기 | E1의 이어 쓰기와 같은 방식으로 ID 색인(엔터티 ID → 항목들)도 작업 상태에 둔다. `expectLinearTime`으로 묶음 크기에 대해 선형임을 본다 |
| E3 | ID 후보 고르기: 같은 이름으로 k번째 만들 때 후보 k개. 묶음 1000개면 50만 번 조회 | 스펙의 상한("쓰이는 경로의 수 + 1")대로이고 집합 조회라 빠르다. 그대로 |
| E4 | 처리마다 목록 배열 사본: 엔터티 목록 1000칸을 하위 명령마다 복사하면 묶음 1000개에 100만 칸 | 작업 상태에서는 목록을 처음 고칠 때 한 번만 복사하고 이어서 제자리에서 고친다(쓰기 시 복사). 처음 모델의 배열은 건드리지 않는다 |
| E5 | 끝의 비교: 손댄 항목만 전후로 직렬화한다. 손대지 않은 항목은 객체가 같아 바로 넘어간다 | 끝 모델의 다섯 목록을 훑어 같은 `file`의 시작 항목과 객체가 다를 때만 직렬화. `file` → 시작 항목 `Map` |
| E6 | 바뀐 항목이 없는 목록도 새 배열이 되면 `toBe` 단언과 메모리에 손해 | 바뀐 목록만 새 배열. 나머지는 전 모델의 배열을 그대로 |
| E7 | 끝의 비교 뒤 항목 순서: 지우고 같은 값으로 다시 만든 엔터티는 목록 끝에 있다. 스펙은 항목 **집합**으로 같음을 본다 | 집합이 같으면 시작 모델을 돌려준다(순서 무시). 집합은 같지 않지만 일부가 되돌려진 경우의 순서는 끝 모델의 순서(되돌린 객체가 끝에 있음)로 둔다. 파일에는 영향이 없다 |
| E8 | 단일 명령과 묶음의 경로가 둘이면 FR-02·FR-08의 판정이 갈라질 수 있다 | 단일 명령도 "하위 명령 하나의 묶음"과 같은 길(작업 상태 → 끝의 비교 → 같음 → 검증)로 돌린다. 문구 접두와 `index`만 다르다 |

### 4.7 입력 복사기 (FR-03)

- `Object.keys`(=`ownKeys` + 키마다 `getOwnPropertyDescriptor`)로 키를 얻고 `obj[key]`로 한 번 읽는다. 객체의 게터는 불리고(AC-11의 재진입 사례가 이것에 기댄다), 배열 색인은 자기 데이터 속성이어야 한다(`getOwnPropertyDescriptor`의 `value`). 배열은 `length`를 한 번 읽는다.
- 프로토타입 검사는 `Object.getPrototypeOf`(Proxy의 `getPrototypeOf` 트랩)이고, 배열은 `Array.isArray`(폐기된 Proxy면 던진다). 모든 단계를 한 `try`로 감싸 "그 자리의 실패"로 바꾼다.
- **다른 realm의 평범한 객체는 실패다**(`Object.prototype`이 다르다). F02의 `checkJsonValue`도 같다. AC-02의 번들은 명령과 코어가 같은 `vm` 컨텍스트에 있어 문제가 없다. 화면이 iframe이나 `postMessage`로 명령을 넘기면 구조화 복제가 받는 쪽 realm의 객체를 만드므로 괜찮다. [미확인: 추론]
- **배열의 하위 클래스**: 스펙은 "배열"을 받고 "클래스 인스턴스"는 실패라고만 한다. F02 `json-value.ts`는 `Array.prototype`이 바로 위가 아닌 배열을 클래스 인스턴스로 본다. 같은 규칙을 권한다(AC-11의 `Object.assign(['product'], { toJSON… })`는 평범한 배열이라 받는다).
- 한도 순서(깊이 → 값 → 글)와 "빼기 전에 센다"는 한 번의 방문에서 셋을 차례로 보면 된다. 순환은 깊이 33에서 걸린다(별도 방문 집합이 필요 없다).
- `unknown command type <t>`의 `<t>`는 앞 50 코드 단위를 자른다. 서로게이트 쌍 가운데서 잘리면 `JSON.stringify`가 `\ud83d`처럼 이스케이프한다(ES2019 well-formed stringify). 문제없다.
- `message`의 한 줄 처리 뒤 500 코드 포인트 자르기는 `\u{2028}` 같은 이스케이프 가운데서 끊을 수 있다. 스펙은 "끝난 문구"를 자른다고 했으니 그대로다. 테스트는 이 경계를 만들지 않게 한다.

### 4.8 ID와 경로 (FR-05, FR-06)

| # | 내용 | 권고 |
| --- | --- | --- |
| I1 | FR-05 2단계 "`physical.name`이 같고": 둘 다 없을 때 같다고 보면 AC-08의 "테이블명 없이 세 번 → `x`, `x_2`, `x_3`"과 결과는 같지만(스키마 슬러그가 비어 2단계가 없다), 새 엔터티에 스키마만 있고 테이블명이 없으면 접두가 붙는다 | "둘 다 있고 같다"로 읽는다. 스펙 문장에 "있고"를 넣기를 권한다 |
| I2 | 2단계의 "슬러그를 ID로 가진 엔터티"가 둘 이상(R01이 있는 모델) | 어느 하나라도 맞으면 2단계를 한다. 테스트 하나 |
| I3 | 사전 폴더가 연 폴더 자신(`dictionaries: ['.']`)이면 모든 새 엔터티·주제영역이 `id-taken`(3번 이유) | 스펙대로. 그런 모델은 읽을 때 모든 YAML이 사전으로도 읽혀 이미 깨져 있다 |
| I4 | `entity.create`의 `subjectArea`에 붙일 ID가 이미 그 영역의 `entities`에 있을 수 있다(없는 엔터티를 가리키던 R02 모델에서 그 ID로 만들 때) | 붙이기 전에 있는지 본다(`addEntities`와 같은 규칙). 그러지 않으면 `uniqueItems` 스키마 오류가 생겨 `validation`으로 거부된다 |
| I5 | `set.physical: {}`를 `physical`이 없는 엔터티에 주면 `physical: {}`가 생겨 글이 바뀐다(`canonical`이 빈 객체를 남긴다) | "`physical` 안의 키 단위로 바꾼다"이므로 바꿀 키가 없으면 아무것도 하지 않는다(`physical`을 만들지 않는다)로 정한다 |
| I6 | `toLowerCase`는 파일 시스템의 대소문자 접기와 다르다(켈빈 기호 `K`, `ß` 등) | 새 경로의 ID 부분은 언제나 ASCII 소문자라 영향은 `dir` 부분뿐이고, `dir`은 모든 경로에 같다. 그대로 |
| I7 | NFKC가 글을 늘린다(`㈜` → `(주)`, 한 글자가 18자까지) | 앞 256 코드 단위를 먼저 자르므로 상한이 있다. 그대로 |
| I8 | 앞 256 코드 단위 자르기가 서로게이트 쌍을 가른다 | 외톨이 서로게이트는 구분자가 된다. 그대로 |

### 4.9 실행 취소, 재진입, 예외

- 이력 칸은 `(전 모델, 전 issues)`. `undo`/`redo`는 검증을 부르지 않으므로 AC-15의 "`validateModel` 0번"은 구조로 성립한다.
- 재진입 표시(`busy`)는 `try/finally`로 반드시 풀어야 한다. 바깥 호출이 `internal`로 끝나도 다음 호출이 `busy`가 되면 안 된다.
- AC-11 재진입 사례: 안쪽 호출이 `busy`를 받고 게터가 던지면, 바깥은 복사 실패로 `invalid-command`(`/name must be a JSON value`)다. 예외는 복사기의 `try`가 잡으므로 `internal`이 아니다.
- `Unexpected error: <메시지>`: `error instanceof Error`도 다른 realm이면 거짓이다. 스펙대로 `String(값)`으로 떨어진다. 그대로.

## 5. 스펙이 정하지 않았거나 코드와 맞지 않는 것

| # | 내용 | 제안 |
| --- | --- | --- |
| S1 | 새 경로가 폴더인 경우 (4.5 W1) | `list`로 막고 스펙 FR-09에 한 줄 |
| S2 | 읽은 모델의 대소문자만 다른 쌍이 저장을 영원히 막음 (4.5 W2) | 알려진 한계에 적거나 규칙을 좁힌다 |
| S3 | 스키마 오류 고르기의 "경로" (4.3) | F02 `schemaIssues`의 `path` |
| S4 | 오류 객체 재사용이 "그대로다"와 맞는지 (4.4) | 값이 같으면 된다고 스펙에 적는다 |
| S5 | `physical.name`이 둘 다 없을 때의 2단계 (4.8 I1) | "둘 다 있고 같다" |
| S6 | `set.physical: {}` (4.8 I5) | 바뀌는 것 없음 |
| S7 | `entity.create`의 `subjectArea`에 이미 든 ID (4.8 I4) | 겹치면 붙이지 않음 |
| S8 | 배열 하위 클래스 (4.7) | F02와 같이 실패 |
| S9 | `commandSchemas`를 고칠 수 있는가 (3.2) | 깊게 얼린다 |
| S10 | `docs/stage1-backlog.md`의 F03 상태 줄 | F02 관례대로 더한다(스펙 밖) |

설치된 도구로 스펙에 적힌 대로 할 수 없는 것은 찾지 못했다.

## 6. 기술 부채

| 자리 | 문제 | 권장 | 우선 |
| --- | --- | --- | --- |
| `serialize.ts` 229~249행 | 항목 직렬화가 익명 함수 안에 있다 | `serialize-item.ts`로 뗀다(이 기능) | 높음 |
| `validate/schema.ts` 12행 | `schemaIssues`가 `SchemaName`에 묶여 있다 | `ValidateFunction`을 받는 안쪽 함수로 한 겹 나눈다 | 중 |
| `testing/big-model.ts` | AC-15 모양(1000 × 15)이 없다 | `wide-model.ts`를 더한다. 기존 시간 테스트 둘(`validate/index.perf.test.ts`, `serialize.perf.test.ts`)이 각자 비슷한 생성기를 갖고 있다. 합치는 것은 선택 | 낮음 |
| `fs/memory.ts` `list` | 전체를 훑는다 | 테스트용이라 그대로(F02 D-11) | 낮음 |
| `cli/src/main.ts` `oneLine` | 코어와 같은 규칙이 두 곳에 | D-03대로 둔다. 테스트 하나가 두 함수의 출력을 같은 입력으로 견주면 어긋남을 잡는다(cli 테스트에서 코어 `dist`를 가져올 수 있다) | 낮음 |

## 7. 권장 접근

1. 준비: `spikes/` 기준선, F02 바탕 정리(`serializeItem` 떼기, `ReadonlyModel`과 타입 넓히기). F02 테스트 전부 통과가 관문.
2. 입력 층: 복사기, 한 줄 문구, 명령 스키마 17종과 종류별 컴파일, 오류 고르기, `commandSchemas`.
3. ID와 경로: 슬러그·로마자, 후보 순서, 거부 이유 다섯, 새 경로, 예약 경로, `listReservedFiles`.
4. 편집기 뼈대와 처리 16종: 작업 상태, 찾기, 연쇄, 끝의 비교, 거부 규칙, 이력, 묶음, 재진입.
5. `writeChanges`, 번들 테스트, 시간 테스트.
6. 문서와 마무리.

피할 것: 모델 전체를 직렬화해 바뀜 판정하기, 사용자 ID로 평범한 객체 키 만들기, `Object.assign`으로 복사, ES2023 배열 메서드, 처리마다 역연산, 처리와 레지스트리를 한 파일에, `../index.js`를 거쳐 `validateModel` 가져오기, `generated/`에 명령 스키마 넣기.

## 8. 꼭 읽을 파일 (yyy-plan 전에)

| 파일 | 이유 | 우선 |
| --- | --- | --- |
| `docs/specs/core-commands.md` | 요구, AC, 부록 A~D | 필수 |
| `docs/decisions/core-commands.md` | D-00~D-05. 줄인 요구(D-05)를 다시 늘리지 않는다 | 필수 |
| `packages/core/src/model/serialize.ts` | 떼어 낼 함수, 오류 문구 | 필수 |
| `packages/core/src/schema/ajv.ts` | `prepareSchema`의 제약(`$ref` 옆 키워드), 인스턴스 하나 | 필수 |
| `packages/core/src/validate/index.ts`, `validate/schema.ts` | 넓힐 매개변수, 오류 문구 꼴 | 필수 |
| `packages/core/src/validate/json-value.ts` | 명시적 스택 걷기와 프로토타입 규칙의 본보기 | 필수 |
| `format/v0/schema/common.schema.json`, `entity.schema.json`, `subject-area.schema.json` | 명령 스키마가 가리키고 옮겨 적을 정의 | 필수 |
| `packages/core/src/fs/memory.ts`, `fs/path.ts` | 폴더 읽기, 정규화 규칙 | 필수 |
| `packages/core/src/testing/{example,timing}.ts`, `model/serialize-too-large.test.ts` | 테스트 도우미, `vi.mock` 꼴 | 권장 |
| `packages/cli/src/bundle.test.ts`, `cli/src/main.ts` 15~60행 | AC-02, `oneLine` 규칙 | 권장 |
| `docs/plans/core-model-io.md` 7장, `docs/decisions/core-model-io.md` D-06·D-07·D-11 | 검증과 저장의 경계, 리뷰 대응의 교훈 | 권장 |

## 9. 계획에 넘길 권고

1. `model/serialize-item.ts`에 `serializeItem(file, data, schema): string`을 두고 `serializeModel`이 그것을 부르게 한다. 같은 `TypeError` 문구(`Cannot write <file>: …`)와 `RangeError` 변환을 그 안으로 옮긴다. F02 테스트가 바뀌지 않고 통과하는 것을 단계 1의 관문으로 둔다.
2. `model/types.ts`에 `DeepReadonly`와 `ReadonlyModel`을 두고 `validateModel`, `modelItems`, `serializeModel`, `modelFiles`, `writeModel`의 매개변수를 넓힌다. 본문은 고치지 않는다. `tsconfig.test.json` 타입 검사로 AC-01의 `@ts-expect-error` 세 줄을 확인한다.
3. 명령 스키마는 `command/schemas.ts`에 TypeScript 객체로 쓰고 깊게 얼려 `commandSchemas`로 낸다. `generated/`에 넣지 않는다(AC-16). 옮겨 적은 형식 조각(`name`, `physical.*`, `order`, `nullable`, `nameSource`, `kind`, 속성 `scope`)은 `schemaAt`과 견주는 동기화 테스트로 묶는다.
4. 명령 스키마는 `prepareSchema(s, s)` → `schemaAjv().compile`로 종류마다 처음 쓸 때 한 번 컴파일하고 캐시한다. 다른 Ajv 인스턴스를 만들지 않는다(사용자 정의 키워드가 그 인스턴스에만 있다).
5. 스키마 오류 고르기는 F02 `schemaIssues`의 `path`(모르는 키는 키까지) → 문구의 코드 단위 순으로 한다. `schemaIssues`를 `ValidateFunction`을 받는 안쪽 함수로 나눠 두 곳이 같은 코드를 쓰게 한다. 스펙에 "경로"의 뜻을 한 줄 적는다.
6. 복사기는 명시적 스택으로 한 번 걷고, 방문마다 깊이 → 값 → 글 순으로 한도를 보며, 모든 반사 호출을 `try`로 감싼다. 객체는 `Object.defineProperty`로 만든다. 배열 하위 클래스는 F02처럼 실패로 둔다.
7. 처리를 종류 묶음마다 모듈(`handlers/*.ts`)로, 레지스트리를 따로 둔다. 테스트는 `vi.mock`으로 처리 하나(AC-11), `validate/index.js`(AC-13, AC-15), `serialize-item.js`(AC-05)를 감싼다.
8. 단일 명령도 묶음과 같은 길로 실행한다: 작업 상태(목록별 쓰기 시 복사, ID·경로 색인 이어 쓰기) → 끝의 비교(`file` → 시작 항목 `Map`, 객체가 다른 것만 직렬화) → 같음 → 검증 → 커밋. 바뀐 목록만 새 배열로 만든다.
9. 거부 규칙의 "새 오류"는 `JSON.stringify([rule, file, path, message])` 키 집합으로 계산하고, 같은 키의 `Issue`는 앞 목록의 객체를 다시 써서 이력 메모리를 줄인다(4.4). 스펙의 "그대로"가 값의 같음이면 된다는 확인을 받는다.
10. `writeChanges`는 쓸 경로를 정렬해 하나씩 읽은 뒤, 새 경로마다 부모 폴더를 `list`해 같은 이름의 폴더가 있으면 거부한다(4.5 W1). 스펙 변경이 필요하므로 계획 리뷰 전에 스펙 FR-09에 한 줄을 넣고 Codex 확인을 붙인다(D-00의 진행 방식).
11. 대소문자 쌍 규칙(4.5 W2)은 최소한 스펙 8장 알려진 한계에 "읽은 모델에도 생긴다"를 적는다. 좁힐지는 열린 질문 Q2.
12. FR-05 2단계를 "둘 다 `physical.name`이 있고 같다"로, `set.physical: {}`를 "바뀌는 것 없음"으로, `entity.create`의 `subjectArea`에 이미 든 ID는 붙이지 않음으로 구현하고 각각 테스트 하나를 둔다(4.8 I1, I4, I5).
13. 테스트 도우미 셋(`testing/commands.ts` 표본 명령, `testing/recording-fs.ts`, `testing/wide-model.ts`)을 단계 2에서 먼저 만든다. 표본 명령 목록이 17종을 덮는지 단언하는 테스트를 같이 둔다(6장).
14. AC-15 외에 `command/editor.perf.test.ts`에 묶음 크기(예: 하위 명령 250/1000개)에 대한 `expectLinearTime` 하나를 둔다. E2·E4의 제곱을 막는다.
15. `createEditor`의 조건 검사(FR-01 1~4)와 `writeChanges`의 조건 검사는 한 함수(`checkEditable(model) → 이유 | undefined`)로 두고, 두 곳이 접두(`Cannot edit the model: `, `Cannot save: `)만 다르게 붙인다.
16. 계획에 F02의 관문을 이어 쓴다: 단계마다 `pnpm build && pnpm test && pnpm lint && pnpm validate:format`, 시간 테스트 파일은 따로 여러 번(F02는 15번) 돌린다.

## 10. 단계 나눔 (제안)

| 단계 | 내용 | 독립 확인 | 의존 |
| --- | --- | --- | --- |
| 0 | `spikes/` 기준선(AC-17), 브랜치 확인 | 기준선 파일 | — |
| 1 | `serializeItem` 떼기, `ReadonlyModel`, F02 세 함수 넓히기, 공개 타입 자리 | F02 테스트 전부 통과, `@ts-expect-error` 탐침 | 0 |
| 2 | 입력 층: `copy.ts`, `message.ts`, `schemas.ts`(17종), `check.ts`, 테스트 도우미 셋 | AC-11의 거부·받는 표, AC-01의 스키마 부분(키 17종, 컴파일, 부록 B 스키마 문구), 동기화 테스트 | 1 |
| 3 | ID와 경로: `slug.ts`, `ids.ts`, `paths.ts`, `listReservedFiles` | AC-08 전부, AC-09의 경로·대소문자·예약 경로 부분(순수 함수로) | 1 |
| 4 | 편집기와 처리 16종, 묶음, 이력, 거부 규칙 | AC-01(나머지), AC-04, AC-06, AC-07, AC-10, AC-12, AC-13, AC-14 | 2, 3 |
| 5 | `writeChanges`, 번들(AC-02), 시간(AC-15), 왕복·저장(AC-03, AC-05, AC-09 다시 읽기) | 해당 AC | 4 |
| 6 | 문서(FR-11, AC-16), 백로그 상태 줄, 전체 관문(AC-18), Codex 브랜치 리뷰 | 6.1 스크립트, `gh pr checks` | 5 |

단계 2와 3은 서로 의존하지 않아 순서를 바꿔도 된다. 단계 4가 가장 크다(처리 16종). 나누려면 4A(뼈대, `entity.*`, 이력, 묶음)와 4B(속성·키·주제영역)로 나눈다.

## 11. 열린 질문

- **Q1**: 새 경로에 폴더가 있으면 `writeChanges`가 검사 단계에서 거부하게 스펙을 고칠까(4.5 W1)? 고치지 않으면 지운 뒤 쓰기가 실패해 디스크가 반쯤 바뀐다.
- **Q2**: 대소문자만 다른 경로 쌍 규칙을 "쓰거나 지울 경로가 낀 쌍"으로 좁힐까, 아니면 Linux에서 읽은 그런 모델은 저장할 수 없다는 한계로 둘까(4.5 W2)?
- **Q3**: 결과의 `issues`에서 앞 목록과 값이 같은 `Issue`를 앞 객체로 바꿔 드는 것이 FR-03의 "`validateModel`이 낸 그대로다"에 맞는가(4.4)? 맞지 않으면 오류가 많은 모델에서 이력이 수백 MB가 된다.
- **Q4**: 스키마 오류가 여럿일 때 고르는 "경로"는 F02 `Issue.path`(모르는 키는 키까지)인가, Ajv `instancePath`인가(4.3)?

이 분석은 저장소의 파일을 바꾸지 않았다(이 보고서와 `pnpm --filter @erdmaker/core build`가 다시 쓴 `packages/core/dist`는 제외. `dist`는 추적하지 않는다). `spikes/`도 건드리지 않았다.

Design Recommendation: architecture (코어의 공개 API인 편집기·명령 모양·거부 결과·저장 함수를 정하고 F04·F05·F08·F10이 그 위에 선다. 화면은 없다)
Layer Detection: [core-library (packages/core: command/, model/serialize-item, types, validate 넓히기, testing 도우미), cli-test (packages/cli/src/bundle.test.ts), docs (docs/format-v0.md, CLAUDE.md, docs/stage1-backlog.md)]
