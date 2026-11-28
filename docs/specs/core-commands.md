# F03 `core-commands` 스펙

작성: 2026-11-28 (Codex 스펙 리뷰 확인 리뷰와 코드 분석, 계획 리뷰 3회 반영) · 기준 문서: [stage1-backlog.md](../stage1-backlog.md) F03, [format-v0.md](../format-v0.md), [core-model-io.md](./core-model-io.md)(F02), [결정 기록](../decisions/core-commands.md), `CLAUDE.md`

- **상태**: Draft
- **브랜치**: `feature/core-commands`
- **분량**: 3일

## 1. 목적

메모리 모델을 고치는 길을 `@erdmaker/core`의 명령 API 하나로 만든다. 명령은 평범한 JSON 객체이고, 편집기 객체 하나(`createEditor`)가 실행, 실행 취소, 다시 실행을 맡는다. 명령마다 검증을 돌려 오류가 늘어나는 변경은 받지 않는다. 화면(F10), MCP(F08), CLI는 뒤 기능에서 이 진입점에 붙는다.

## 2. 지금 상태

- F02가 `loadModel`, `validateModel`, `serializeModel`, `writeModel`을 냈다. 모델을 고치는 코드는 없다. `writeModel`은 모델 전체를 직렬화해 디스크와 비교하고 파일을 지우지 않는다(F02 FR-06: "파일 삭제는 F03에서 더한다").
- 읽어 온 모델에는 스키마 오류가 있는 항목이 없다(F02 FR-05가 그런 파일을 뺀다). 파일 간 규칙(`R01`~`R12`) 오류는 있을 수 있다.
- 관찰한 것(요구가 아니다). 2026-11-28, 이 개발 컴퓨터(WSL2), Node 22.23.3, 메모리에서 만든 모델(엔터티마다 속성 15개, 전부 든 주제영역 하나), 준비 실행 1회 뒤 5회 중 최솟값: 엔터티 1000개에서 `validateModel` 60 ms, `serializeModel` 603 ms. 4000개에서 237 ms, 2410 ms. 그래서 검증은 명령마다 전체를 돌리고, 직렬화는 바뀐 항목만 한다.

## 3. 범위

**포함**: 편집기와 명령 17종(부록 A): 엔터티·속성·키의 생성·수정·삭제, 속성과 키의 순서 변경, 주제영역의 생성·수정·삭제와 엔터티 넣고 빼기, 묶음(`batch`). 이름·`scope`·`group`·`order` 변경은 수정 명령이 한다. 실행 취소와 다시 실행, ID와 파일 경로 만들기, 명령마다 검증, 바뀐 파일만 쓰고 지우는 `writeChanges`, 명령의 JSON Schema.

**제외**:

- 관계·서브타입 명령과 이주 전파(F04), 사전 명령(F05), 배치 명령(F10·F12). 백로그의 "순서 변경"은 형식이 순서를 저장하는 속성과 키의 것이다. 엔터티는 저장되는 순서가 없고, 캔버스 위의 위치는 배치 파일이며 F10의 일이다.
- 매니페스트 편집(`areaGroups`, `schemas`, `targets`). 백로그에 이것을 요구하는 기능이 없다. 주제영역의 `group`은 있는 묶음만 가리킨다.
- 화면·MCP·CLI에 붙이기, 저장 시점과 파일 감시와 충돌 감지(F09~F10), 변경안 파일(F08). 명령 목록을 버전과 기준 모델 표시가 든 봉투로 감싸는 것은 F08·F14가 정한다. 이 스펙은 명령 하나의 모양만 정하므로 그런 봉투를 막지 않는다.
- 이력을 디스크에 남기기, 증분 검증.

## 4. 정한 것

| 항목 | 선택 | 이유 |
| --- | --- | --- |
| 진입점 | `createEditor`가 돌려주는 `Editor`의 `execute`, `undo`, `redo`. 모델을 고치는 공개 함수는 이것뿐이다 | 화면·MCP·CLI가 같은 객체를 쓰면 이력과 검증을 따로 만들 일이 없다 |
| 명령의 모양 | `{ type: "<대상>.<동작>", … }`인 평범한 JSON. 종류마다 JSON Schema가 있다 | 입력 검사와 MCP 도구의 입력 스키마(F08)가 같은 원본을 쓴다 |
| 수정 명령 | `set`(바꿀 값)과 `unset`(지울 키 이름 목록). `null`로 지우기를 쓰지 않는다 | 스키마가 `null` 갈래를 갖지 않아 오류 문구가 하나로 정해지고, 내보낸 스키마가 받는 입력 그대로다 |
| 상태 | 불변. 명령은 받은 모델을 고치지 않고, 바뀐 항목만 새 객체인 새 모델을 돌려준다 | 실행 취소가 "전 모델로 돌아가기"가 되고, 바뀐 파일을 객체 동일성으로 안다 |
| 실행 취소 | 모델 스냅숏 100칸. 역명령과 패치를 만들지 않는다. 직렬화하지 않는다 | 바뀌지 않은 항목을 공유해 싸고, 명령 종류마다 역연산을 쓸 일이 없다. F04의 이주 전파도 한 칸이다 |
| 묶음 | `batch`를 지금 둔다. 전부 되거나 전부 안 되고, 검증은 끝에 한 번, 이력은 한 칸이다 | 스냅숏 방식에서는 거의 공짜이고 F08의 변경안 적용과 F10의 복합 조작이 쓴다 |
| 거부 규칙 | 명령이 바꾸거나 만든 항목을 쓸 수 없게 되거나(전에도 쓸 수 없던 항목은 빼고) 오류 수가 전보다 많아지면 거부한다(FR-04) | 저장할 수 있던 것은 저장할 수 있게 남고, 이미 오류가 있는 모델도 고칠 수 있다. 오류마다의 동일성을 정의하지 않는다(결정 기록 D-12) |
| 참조된 것의 삭제 | F03이 맡은 것(키, 주제영역 소속, 배치의 노드와 파일)은 함께 지운다. 관계와 서브타입이 가리키는 것을 지우면 검증기의 오류가 생기고 FR-04가 판단한다 | 관계를 고치는 로직은 F04다. 오류는 검증기가 이미 정확한 문구로 낸다 |
| 이름 변경 | 별도 명령이 없다. `*.update`의 `name`, `physical.name`이다. `id`와 `file`은 어떤 명령으로도 바뀌지 않는다 | 명령 종류가 줄고 F04가 전파를 붙일 자리가 하나다 |
| ID | 물리명, 없으면 논리명에서 만든다. 한글은 로마자로 옮긴다(부록 C). 직접 줄 수도 있다 | 읽히는 ID가 코드 몇 줄보다 값지다. 옮기지 않으면 한글 이름의 객체가 모두 `entity_7` 꼴이 된다 |
| 거부의 모양 | `{ ok: false, code, message, issues }`. `Issue`의 `rule`을 늘리지 않는다. `issues`는 `validation` 거부에서만 찬다 | 명령 모양 오류에는 파일이 없다. 검증 오류는 F02의 문구와 규칙 ID 그대로다(F08: "어느 규칙을 어겼는지") |
| 저장 | `writeChanges(fs, before, after)`. 마지막으로 저장한 모델과 지금 모델을 받는다 | 지울 수 있는 경로가 `before`가 가졌던 것뿐이다. 실행하고 되돌린 것은 아무것도 쓰지 않는다 |

## 5. 요구사항

### FR-01 편집기

```ts
createEditor(model: ReadonlyModel, options?: { reservedFiles?: readonly string[] }): Editor

type Issues = readonly Readonly<Issue>[];

interface Editor {
  readonly model: ReadonlyModel;   // 지금 모델
  readonly issues: Issues;         // 지금 모델의 validateModel 결과
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  execute(command: unknown): CommandResult;
  undo(): CommandResult;
  redo(): CommandResult;
}

type CommandResult =
  | { ok: true; model: ReadonlyModel; issues: Issues; id?: string; ids?: (string | null)[] }
  | { ok: false; code: RejectionCode; message: string; issues: Issues; index?: number };
```

- 세 메서드는 동기이고 파일에 접근하지 않으며 어떤 입력에도 예외를 던지지 않는다. 처리 중에 난 예외는 잡아 `internal` 거부로 돌려준다.
- 모델, `issues`, 이력은 모든 일이 성공한 뒤에 한꺼번에 바꾼다. 거부되면 `editor.model`, `editor.issues`가 호출 전과 같은 객체이고 `canUndo`, `canRedo`가 같다.
- **재진입**: 한 편집기의 `execute`, `undo`, `redo`가 도는 동안 같은 편집기에 다시 들어온 호출은 `{ ok: false, code: 'internal', message: 'The editor is busy' }`를 돌려주고 아무것도 바꾸지 않는다(명령 안의 getter가 편집기를 부르는 경우다).
- 성공 결과의 `model`과 `issues`는 `editor.model`, `editor.issues`와 같은 객체다. `issues`에는 `line`·`column`이 없고 `path`는 있다. `id`는 생성 명령이 만든 객체의 ID, `ids`는 `batch`의 것이다(FR-08).
- 편집기가 쓰는 명령(FR-03의 사본)과 결과는 평범한 데이터라 `JSON.parse(JSON.stringify(x))`를 거쳐도 같은 값이다. 예외는 `-0`으로, JSON이 `0`으로 바꾼다(메모리에서 실행한 명령의 `-0`은 F02처럼 남는다). 결과에 대한 보장은 `createEditor`에 준 모델이 JSON 값만 담을 때의 것이다(`loadModel`이 준 모델이 그렇다). 부르는 쪽이 넘긴 원래 객체(`toJSON`을 가진 것 등)는 이 보장 밖이다.
- **결정적이다.** 편집기의 상태 전체(지금 모델, 예약 경로, 처음 모델의 경로 집합, 실행 취소와 다시 실행 목록)와 호출이 같으면 결과가 같다. 시각과 난수에 기대지 않는다.
- **넘기는 모델의 조건**. 어기면 `createEditor`가 `Cannot edit the model: `로 시작하는 `TypeError`를 던진다(괄호 안이 이유의 문구다). 편집기가 던지는 것은 이것과 아래 `reservedFiles`의 것뿐이다.
  1. 객체이고(`it is not an object`) `dir`이 정규화된 글이다(`dir is not a normalized path`). 정규화는 F02의 `normalizePath`이고 "정규화됐다"는 `normalizePath(x) === x`다.
  2. 여섯 목록이 배열이고 `length`가 0 이상 2³² − 1 이하의 정수이며(`<목록> is not a list`. 어떤 배열도 그보다 길 수 없으니 더 길다고 답하는 Proxy다), 매니페스트(`manifest is not an item`)와 목록의 항목이 `file`이 글인 객체다(`<목록>[<i>] is not an item`). 항목은 여섯 목록을 모두 본 뒤 색인 하나씩 보고 처음 항목이 아닌 것에서 멈춘다(빈 칸이 많은 배열도 일이 든 항목 수에 선형이다).
  3. 모든 항목(매니페스트와 사전 포함)의 `file`이 정규화돼 있고 빈 글이 아니며(`<file> is not a normalized file path`. 빈 글이면 ` is not a normalized file path`로 앞이 빈 칸이다) 서로 다르다(`<file> is used by two items`).
  4. 다섯 목록(엔터티, 관계, 서브타입, 주제영역, 배치)의 `file`이 구성요소 단위로 `dir` 안이다(`<file> is outside the model folder`). `dir` 바로 뒤의 구성요소가 `..`이면 밖이다(`dir`이 `..`일 때 `../../a.yaml`, `dir`이 빈 글일 때 `../a.yaml`). 사전은 밖에 있어도 된다.
- `options`가 객체가 아니면(`undefined`, `null`, 함수, 그 밖의 값) 옵션이 없는 것이고, 객체일 때만 그 `reservedFiles`를 읽는다. `reservedFiles`를 주면 글의 배열이어야 한다: `length`가 0 이상 2³² − 1 이하의 정수이고(조건 2와 같다) 그 아래 색인마다 글을 든 자기 데이터 속성이다. `length`를 먼저 읽고 색인을 차례로 서술자로만 읽어 그 `value`를 쓰며(색인에는 `get`도 접근자도 부르지 않는다), 빈 칸이거나 접근자이거나 글이 아닌 첫 색인에서 멈추고 그 뒤는 읽지 않는다. 그 밖의 것(배열이 아닌 값, 그런 `length`가 아닌 값, 빈 칸이나 접근자인 색인, 글이 아닌 항목, 읽다가 예외가 나는 값)이면 `createEditor`가 `TypeError('Cannot edit the model: reservedFiles is not a list of paths')`를 던진다. 글마다 `normalizePath`로 정규화하고, 정규화해 빈 글이 되는 항목은 무시한다.
- 부르는 쪽은 넘긴 모델과 편집기가 준 모델을 고치지 않는다. 편집기는 모델을 복사하지도 얼리지도 않고, 이것을 검사하지도 않는다.
- `loadModel`의 `issues`(읽다가 빠진 파일의 오류, `comment` 경고)는 부르는 쪽이 따로 든다. 모델에 `validateModel` 오류가 있어도 편집기를 만든다.
- 공개 이름: 값 `createEditor`, `writeChanges`, `listReservedFiles`, `commandSchemas`, 타입 `Editor`, `Command`, `CommandResult`, `RejectionCode`, `ReadonlyModel`. F02의 공개 이름은 그대로 있다.
- 명령 종류는 "스키마 하나와 처리 하나"의 쌍으로 더한다(F04, F05, F10). 입력 검사, 검증, 이력, 결과는 종류와 상관없이 한 곳에 있다.

### FR-02 불변과 소유

- `ReadonlyModel`은 `Model`을 깊이 읽기 전용으로 만든 타입이다. 편집기가 내놓는 모델과 `Issue`는 읽기 전용 타입이라, 타입을 지키는 코드는 고칠 수 없다. `validateModel`, `serializeModel`, `writeModel`의 매개변수 타입을 `ReadonlyModel`로 넓힌다(동작은 그대로다).
- 명령은 받은 모델과 그 안의 어떤 객체도 고치지 않는다. 새 모델에서 바뀌지 않은 항목(`{ file, data }`)은 전 모델과 같은 객체다.
- **"바뀌었다"의 뜻**: 명령이 손댄 항목을 F02의 쓰기 규칙으로 직렬화한 글이 전과 다르다. 글이 같은 항목은 전 객체를 그대로 둔다. 그래서 스키마가 키 순서를 정하는 기록에서 키 순서만 다른 값, 기본값을 적은 값(엔터티와 키의 `scope: both`)은 바뀐 것이 아니다. 속성의 `scope: both`는 형식에 기본값이 없어 써지므로 바뀐 것이다. F02가 적힌 순서대로 쓰는 맵(`ext` 안쪽, `physical.types`)의 키 순서와 `-0`은 바뀐 것이다. 명령이 손댄 항목을 직렬화할 수 없으면 값이 전과 같아도 바뀐 것으로 친다(그 데이터는 새 객체이고 견줄 글이 없다).
- 두 모델이 **같다**는 것은 항목의 집합(목록과 `file`)이 같고 짝마다 글이 같다는 뜻이다. 시작과 끝을 견주어 항목이 늘었거나 줄었으면 바뀐 것이다. 같으면 결과는 `ok: true`이고 `model`이 전과 같은 객체이며, 이력과 다시 실행 목록을 건드리지 않는다.
- 모델에 들어가는 명령의 값은 FR-03의 사본에서 온다. 그래서 명령이 넣은 데이터는 부르는 쪽의 객체와도, 모델의 다른 곳과도 객체를 공유하지 않는다(처음 모델이 이미 공유하던 것은 그대로다). `__proto__`라는 키는 자기 데이터 속성으로 남고 어떤 객체의 프로토타입도 바뀌지 않는다. ID나 이름이 `constructor` 같은 내장 속성 이름이어도 동작이 같다.
- 새 항목은 해당 목록의 끝에 붙는다.
- **이력의 메모리**: 한 칸은 그 시점의 `Model` 객체, 바뀐 목록의 배열(항목 참조의 얕은 사본), 바뀐 항목, 그 모델의 `issues` 목록을 붙든다. 칸끼리는 바뀌지 않은 항목과 값이 같은 `Issue`를 공유해야 한다: 편집기가 내놓는 `issues`는 `validateModel`이 돌려준 것과 값이 같으면 되고, `rule`, `file`, `path`, `message`, `severity`, 위치가 모두 같은 앞 목록의 `Issue` 객체를 다시 써도 된다(오류가 많은 모델의 100칸이 작게 남는다).

### FR-03 명령의 입력 검사

`execute`는 받은 값을 믿지 않는다. 먼저 받은 값을 **한 번 걸으며 평범한 데이터로 복사**하고, 그 뒤의 모든 일은 사본으로만 한다. 다음 순서에서 처음 걸린 것 하나로 `invalid-command` 거부를 낸다(문구는 부록 B).

1. 받은 값이 객체가 아니거나 배열이다. 함수도 객체가 아니므로 여기서 `command must be an object`이고, 평범하지 않은 객체(`Date`, `Map`, 클래스 인스턴스)는 2에서 `/ must be a JSON value`다.
2. 복사가 실패한다.
   - 받는 값: `null`, 불리언, 글, F02의 JSON 값 검사가 받는 수(같은 함수를 쓴다: 유한하고, 정수 값이면 안전한 정수 범위 안. `2 ** 53`, `1e300`은 실패다), 배열, 프로토타입이 `Object.prototype`이나 `null`인 객체. 그 밖의 것(함수, 심벌, bigint, `NaN`, 클래스 인스턴스, 배열 안의 `undefined`)은 실패다.
   - 객체는 열거되는 자기 문자열 키를 차례로 방문해 한 번씩 읽는다. 값이 `undefined`인 속성은 뺀다(`JSON.stringify`와 같다).
   - 배열은 `length`를 한 번 읽고 그 아래 색인을 차례로 읽는다. 색인마다 자기 데이터 속성이어야 한다(빈 칸, 접근자, 물려받은 값은 실패다). 색인이 아닌 자기 속성은 옮기지 않는다. `Array`의 하위 클래스 인스턴스는 F02처럼 실패다.
   - 읽다가 난 예외(Proxy의 어느 트랩이든)는 모두 잡아 그 자리의 실패로 친다. 자리는 값을 읽다 났으면(속성의 값, 배열 색인의 서술자) 그 속성이나 색인의 경로, 키를 나열하거나 컨테이너의 종류를 보다 났으면(객체의 서술자 트랩 포함) 그 컨테이너의 경로다.
   - 한도 셋: 컨테이너가 32단계보다 깊다(명령 객체가 1단계. 컨테이너는 배열과 평범한 객체이고, 평범하지 않은 객체는 어느 깊이에서든 `must be a JSON value`다). 값이 100000개를 넘는다. 글의 길이 합이 1000000 코드 단위를 넘는다. 방문한 키 하나, 배열 항목 하나가 값 하나이고(빼기로 정하기 전에 센다) 키의 길이와 글인 값의 길이가 글의 합에 든다. 깊이 우선으로 걷다가 처음 넘은 곳에서 멈추고, 한 번의 방문이 여러 한도를 넘으면 깊이, 값, 글 순으로 알린다. 한 자리에서는 한도를 먼저 보고 그 값 자신의 실패를 나중에 본다(그 자리의 값은 이미 한 번 읽혔다). 순환하는 값은 깊이 한도에 걸린다.
3. 사본의 자기 속성 `type`이 글이 아니거나 모르는 종류다.
4. 그 종류의 스키마에 맞지 않는다. 문구는 F02의 `schema` 오류와 같은 꼴(`<instancePath 또는 "/"> <Ajv 메시지>`)이다. 오류가 여럿이면 Ajv가 낸 순서가 아니라 F02가 `Issue`를 정렬하는 순서(`compareIssues`. `validateModel`이 `schema` 오류에 쓰는 것이고, 위치가 없으니 문구의 코드 단위 순이다)로 첫 것이다.

- **명령 스키마**는 형식 스키마와 같은 준비 과정(`prepareSchema`)과 같은 Ajv 설정을 거친다. `commandSchemas`는 종류 이름 → 준비하기 전의 스키마이고 깊이 얼린 객체다. 손으로 쓴 TypeScript이고 생성물이 아니다(`format/`과 `generated/` 아래는 바뀌지 않는다).
  - 필드를 늘어놓는 기록(명령 자신, `set`, `physical`)만 `additionalProperties: false`다. `unset`은 부록 A의 이름만 받는 열거형의 목록이다.
  - 모델 데이터의 값은 형식의 공통 스키마(`urn:erdmaker:format:0.1:common`)의 정의 일곱(`id`, `scope`, `dataType`, `defaultValue`, `validValues`, `physicalTypes`, `ext`)을 `$ref`로 가리키고, 그 정의의 규칙을 그대로 따른다(`ext`와 `physical.types`는 열린 맵이다). 가리키는 형식 스키마는 이것 하나다. 공통 정의가 아닌 필드 규칙(`name`, `physical.name`, `physical.schema`, `order`, `nullable`, `nameSource`, 키의 `kind`, 속성의 `scope`)은 엔터티·주제영역 스키마의 것을 옮겨 적고, 동기화 테스트가 형식 스키마의 그 자리와 같은지 비교한다.
  - ID 목록(`entities`, 키의 `attributes`)은 `{ type: array, items: { $ref: …#/$defs/id }, uniqueItems: true }`로 적는다(`$ref` 옆에 다른 키워드를 두지 않는다. 준비 과정이 받는 꼴이다). `minItems: 1`은 형식이 요구하는 키의 `attributes`와 `addEntities`·`removeEntities`의 `entities`에만 붙인다. `subjectArea.create`의 `entities`는 비어도 되고 없어도 된다.
  - `batch`의 스키마는 봉투만 본다: `commands`가 객체 1~1000개의 배열이다. 하위 명령은 하나씩 자기 종류의 스키마로 본다(FR-08).
- 거부의 `message`는 한 줄이다. 코어의 작은 도우미가 제어 문자를 CLI의 `oneLine`과 같은 규칙(F02 FR-11)으로 이스케이프하고, 끝난 문구가 코드 포인트 500개를 넘으면 앞의 500개 뒤에 `…`를 붙인다(이 도우미가 쓴 이스케이프가 잘리게 되면 그 앞에서 자른다). CLI의 도우미와는 따로이고 CLI는 바꾸지 않는다. `issues` 안의 `Issue`는 `validateModel`이 낸 것과 값이 같고, 이 처리를 거치지 않는다.

### FR-04 검증과 거부

- 명령(`batch`는 전체)이 모델을 바꿨으면 새 모델에 `validateModel`을 한 번 부른다.
- **거부 규칙**: 두 조건을 모두 지켜야 받고, 어기면 `validation`으로 거부한다. (가)를 먼저 본다. (가) **손댄 항목은 쓸 수 있게 남는다.** 끝의 비교(FR-08) 뒤에 바뀌었거나 새로 생긴 항목마다 F02의 `serializeItem`(JSON 값, 깊이, 크기의 검사와 글 만들기)이 받는다. 같은 목록, 같은 `file`의 항목이 명령 전에 있었고 그때도 `serializeItem`이 거부했으면 그 항목은 뺀다(명령이 만든 것이 아니다). 바뀌었는지 보려고 직렬화한 결과를 그대로 쓰고, 명령 전의 항목은 손댄 항목의 것만 `execute`마다 많아야 한 번 직렬화한다. 이 기능에서는 공개 명령 입력으로 (가)를 일으킬 수 없다(입력 사본이 그런 값을 거부하고, 한 항목의 값을 다른 항목으로 옮기는 처리가 없다). 뒤에 더할 처리를 위한 방어다(F04의 관계 이주는 항목 사이에 값을 옮긴다). (나) `severity`가 `error`인 `Issue`의 수가 전(`editor.issues`)보다 많지 않다. (가)가 따로 있는 것은, 파일 하나 안의 오류가 있는 항목은 파일 간 규칙에서 빠져 수만 보면 새 결함이 가려지기 때문이다.
- **보장**: 오류가 0개인 모델은 어떤 명령 뒤에도 0개다. 명령 전에 쓸 수 있던 항목은 받아들인 명령 뒤에도 쓸 수 있다. 이미 쓸 수 없던 항목은 부르는 쪽의 문제로 남는다(8장). 오류끼리 같은지는 어디서도 정하지 않는다.
- 거부의 `issues`: (가)이면 새 모델에서 그 항목의 `file`에 `validateModel`이 낸 `schema` 오류들(없으면 빈 목록)이고, 걸린 항목이 여럿이면 여섯 목록의 순서(FR-01), 그 안의 자리 순서로 첫 것이다. (나)이면 새 모델의 오류 가운데 전 목록의 **오류**에 `rule`, `file`, `path`, `message`가 모두 같은 것이 없는 것들이다(`validateModel`의 순서. 전 목록의 경고는 견주지 않는다. 보여 주기 위한 것이고 받을지와 상관없다). 그런 것이 없으면 새 모델의 오류 전부다.
- 경고는 명령을 막지 않고 `issues`에 실린다. 지금 `validateModel`은 경고를 내지 않는다(`comment` 경고는 `loadModel`이 낸다). 뒤 기능이 경고 규칙을 더해도 이 규칙은 그대로다.
- `undo`와 `redo`는 이 규칙으로 거부하지 않고 `validateModel`을 부르지도 않는다. 이력이 모델마다 그때의 `issues`를 함께 들고 있다가 그대로 돌려놓는다.
- 처리가 스스로 거부하는 것은 넷뿐이다: 대상이 없음(`not-found`), 대상의 ID가 겹침(`ambiguous-target`), 쓸 수 없는 `id`(`id-taken`), 입력 모양(FR-03). 나머지(두 번째 PK, 엔터티보다 넓은 `scope`, 모르는 도메인·묶음·엔터티, 같은 스키마의 같은 테이블명, 관계가 쓰는 것의 삭제)는 검증기가 오류로 알리고 위 규칙이 판단한다. 문구는 F02 부록 A의 것이다.
- 세 가지 보장은 따로다. (1) 검증: 위 규칙. (2) 직렬화: 오류가 0개인 모델은 `serializeModel`이 받는다(F02 D-06. 예외는 F02 8장의 글 크기와 스택이고, 손댄 항목의 것은 (가)가 막는다). (3) 저장: 어댑터가 실패할 수 있고 FR-09가 다룬다.

### FR-05 ID 만들기

생성 명령에 `id`가 없으면 만든다. 한 번 정한 ID는 어떤 명령으로도 바뀌지 않는다. 지운 객체의 ID는 다시 쓸 수 있다.

- **글에서 ID로(슬러그)**: 글의 앞 256 코드 단위만 읽는다. NFKC로 정규화하고 코드 포인트를 차례로 본다. `A`~`Z`는 소문자로, `a`~`z`와 `0`~`9`는 그대로, 한글 음절(U+AC00~U+D7A3)은 부록 C의 로마자로 옮긴다. 그 밖의 것(공백, 기호, `_`, `-`, 한자, 이모지, `é`)은 구분자다. 구분자가 이어지면 `_` 하나이고 앞뒤의 `_`는 뗀다. 결과는 앞의 63자이고(음절의 로마자 가운데서 잘려도 된다) 끝의 `_`를 뗀다.
- **재료**: 엔터티와 속성은 `physical.name`, 없거나 슬러그가 비면 `name`. 키는 `physical.name`, `name`, 종류 낱말(`primary` → `pk`, `alternate` → `ak`, `inversion` → `ie`) 순. 주제영역은 `name`. 모두 비면 `entity`, `attribute`, `area`다.
- **후보의 순서**. 처음 쓸 수 있는 것을 고른다.
  1. 슬러그.
  2. 엔터티만: 슬러그를 ID로 가진 엔터티와 새 엔터티가 둘 다 `physical.name`을 가졌고 그것이 같으며 `physical.schema`가 다르면(없는 것은 빈 글) `<새 엔터티 스키마의 슬러그>_<슬러그>`의 앞 63자(끝의 `_`는 뗀다). 스키마의 슬러그가 비면 이 단계는 없다. 이 단계가 있으면 뒤 단계의 바탕은 이 값이다. 같은 테이블명을 다른 ID로 가진 엔터티(이름을 바꿨거나 ID를 직접 준 것)는 이 단계를 일으키지 않는다.
  3. `<바탕>_2`, `<바탕>_3`, …. 붙인 것이 63자를 넘으면 바탕의 끝을 잘라 맞춘다(자른 끝의 `_`는 뗀다). 자르기 때문에 이 검색에서 이미 본 후보와 같은 글이 다시 나오면 찾아보지 않고 건너뛴다. 한 `execute`(묶음 전체) 안에서는 같은 이름 공간의 같은 바탕에 대해 앞 명령이 고른 접미사의 다음부터 찾으므로 **접미사는 커지기만 한다**(그 사이 지워져 빈 접미사는 그 묶음에서 다시 쓰지 않는다. 후보마다 쓸 수 있는지는 언제나 본다). 1과 2는 언제나 먼저 본다.
- **이름 공간**: 엔터티끼리, 주제영역끼리, 한 엔터티의 속성끼리, 한 엔터티의 키끼리(형식 검증 규칙 1).
- **쓸 수 없는 ID**와 직접 준 `id`의 거부 이유. 위에서부터 보고 처음 걸린 이유의 문구를 쓴다(부록 B).
  1. 같은 이름 공간에 이미 있다.
  2. 엔터티와 주제영역: 어디서나 열리는 이름만 쓰는 방침에 따라 `con`, `prn`, `aux`, `nul`, `com0`~`com9`, `lpt0`~`lpt9`는 쓰지 않는다(Windows가 파일명으로 받지 않는다).
  3. 엔터티와 주제영역: 그 ID의 파일 경로가 사전 폴더 안이다(FR-06).
  4. 엔터티와 주제영역: 그 ID의 파일 경로가 쓰이고 있다(FR-06).
  5. 엔터티와 주제영역: 그 ID의 파일 경로가 처음 모델의 경로와 대소문자만 다르다(FR-06).
- 직접 준 `id`는 형식의 ID 패턴을 스키마가 보고, 쓸 수 없으면 `id-taken`으로 거부한다. 접두도 접미사도 붙이지 않는다. 만드는 ID는 1, 2, 4, 5에 걸리면 다음 후보로 간다. 3은 ID와 상관없는 이유라 첫 후보에서 `id-taken`으로 거부하고, 그 후보가 앞의 이유에도 걸리더라도 문구에 그 첫 후보를 적는다.

### FR-06 새 항목의 파일 경로

- 새 엔터티는 `joinPath(model.dir, 'entities', '<id>.yaml')`, 새 주제영역은 `joinPath(model.dir, 'subject-areas', '<id>.yaml')`다. 있던 항목이 하위 폴더에 있어도 새 항목은 이 자리다. 명령은 새 배치 파일을 만들지 않는다.
- 경로가 **쓰이고 있다**: 지금 모델의 어느 항목(매니페스트와 여섯 목록)의 `file`이나 예약 경로의 어느 것이, 그 경로와 **비교 키**가 같다. 비교 키는 `path.normalize('NFKC').toLowerCase()`이고, 이 스펙에서 "대소문자만 다르다"는 글자는 다르고 비교 키가 같다는 뜻이다. 대소문자나 정규화를 가리지 않는 파일 시스템에서 `entities/Customer.yaml`과 `entities/customer.yaml`, `É.yaml`과 `é.yaml`은 같은 파일이다.
- 경로가 **처음 모델의 경로와 대소문자만 다르다**: 편집기를 만들 때의 모델이 가졌던 `file` 가운데 어느 하나라도 그 경로와 글자는 다르고 비교 키는 같다(글자까지 같은 경로가 따로 있어도 마찬가지다). 처음 경로의 집합은 편집기가 사는 동안 그대로이고, 항목을 지워도 실행 취소와 다시 실행을 해도 바뀌지 않는다. 문구에는 그런 처음 경로 가운데 코드 단위 순으로 첫 것을 적는다. 새 항목의 파일 이름은 언제나 ID에서 나온 소문자 이름이므로(`dir`은 모델의 것을 그대로 쓴다), `entities/Customer.yaml`을 읽어 온 편집기에서는 그 엔터티를 지워도 `customer`라는 ID의 엔터티를 만들 수 없다(저장이 FR-09의 대소문자 규칙에 걸리지 않게 한다).
- 경로가 **사전 폴더 안이다**: 매니페스트의 `dictionaries`(없으면 `dictionary`. 절대 경로 항목은 뺀다)의 어느 항목을 `joinPath(model.dir, 항목)`으로 정규화한 폴더가 그 경로의 앞쪽 구성요소들과 같다(구성요소마다 비교 키로 비교한다. 폴더가 연 폴더 자신이거나 그 위면(정규화한 폴더가 빈 글이거나 `..`만으로 되면) 모든 경로가 안이다). 그런 파일은 다시 읽을 때 사전으로도 읽혀 오류가 된다. 사전 폴더는 `loadModel`과 편집기가 같은 내부 함수 하나로 정한다: 매니페스트가 없거나 그 데이터에 `model` 스키마의 오류가 있으면(`loadModel`이 그런 `model.yaml`을 뺀다) `dictionary`, 아니면 그 `dictionaries`(키가 없으면 `dictionary`)에서 절대 경로 항목을 뺀 것이다. 그래서 `dictionaries: 42`와 `[entities, 42]`는 `dictionary`다. 편집기는 매니페스트 항목의 `data`와 그 안을 getter를 부르지 않고 자기 데이터 속성으로만 읽고(목록은 `reservedFiles`와 같은 규칙), 그렇게 읽을 수 없는 것(접근자, 던지는 트랩)은 오류가 있는 데이터로 친다. 편집기 쪽에서만, 항목마다 먼저 `loadModel`과 같은 정규화를 따로 하고(잇지 않으므로 넘치지 않는다), `model.dir`과 이어 정규화한 폴더가 4096자(어댑터가 받는 경로의 한도)보다 길면 뺀다. 그런 폴더 안의 경로는 더 길어 어떤 어댑터도 쓰지 않으므로 빼도 안전하다. 길이는 잇기 전에 셈하고(항목 앞쪽의 `..`가 `dir`의 구성요소를 몇 개 지우는지만 보면 된다) 한도 안일 때만 잇는다. 그래서 `entities` 뒤에 `/` 5000개를 붙인 항목도 `entities`다. 정규화가 너무 큰 글 때문에 `RangeError`를 내면 그 항목(`dir`이면 모든 항목)을 뺀다. 일은 `dir`과 항목들의 길이에 선형이고 던지지 않는다.
- **예약 경로**: `reservedFiles`는 부르는 쪽이 주는, 차지된 경로(파일이든 폴더든)의 목록이다(연 폴더 기준). 편집기는 만들 때 한 번 이것을 정규화하고 처음 모델의 항목이 가진 경로를 빼서 든다. 그 뒤로는 바뀌지 않는다. 그래서 모델의 항목을 지우면 그 경로는 다시 쓸 수 있다. 예약 경로는 차지된 자리의 ID를 처음부터 고르지 않게 하는 것이고, 주지 않아도 FR-09가 모델 밖의 파일을 덮어쓰지 않는다.
- `listReservedFiles(fs, modelDir): Promise<string[]>`는 `entities/`와 `subject-areas/` 바로 아래에서 찾은 것 전부(파일과 폴더, 모델에 든 것 포함)의 경로를 돌려준다(`list` 두 번). 새 파일이 생기는 자리가 그 둘뿐이라 이것으로 충분하다. 어댑터가 나열한 것만 돌려주므로 어댑터가 나열하지 않는 항목(Node 어댑터의 심벌릭 링크)은 보지 못한다.

### FR-07 명령의 동작

필드는 부록 A에 있다.

- **대상 찾기**: 명령이 **고치는** 객체만 바로 찾는다. 엔터티·속성·키 명령의 엔터티, 수정·삭제·이동하는 속성과 키, `before`가 가리키는 속성과 키, 주제영역 명령의 주제영역, `entity.create`의 `subjectArea`다. 없으면 `not-found`, 그 ID를 가진 것이 둘 이상이면(이미 `R01`이 있는 모델) `ambiguous-target`이다. **저장만 하는** 참조(주제영역의 `entities`, 키의 `attributes`, `group`, `domain`, `term`)는 찾지 않고 끝의 검증(`R02`, `R12`)이 본다. 그래서 `batch` 안에서는 가리키는 대상을 뒤 명령이 만들어도 된다.
- **한 명령의 거부 순서**: 스키마(FR-03) → 찾기(부록 A에 적힌 필드 순서로, 필드마다 `not-found` 다음 `ambiguous-target`) → `id-taken`.
- **수정(`*.update`)**: 먼저 `unset`의 키를 지우고, 그다음 `set`의 값을 넣는다(둘에 같은 키가 있으면 `set`이 남는다). `set`은 최상위 키와 `physical` 안의 키 단위로 바꾸고, 그 밖의 값(`type`, `default`, `validValues`, `ext`, `physical.types`, 키의 `attributes`)은 통째로 바꾼다. `unset`의 이름은 부록 A에 적힌 것만 되고 `physical.name`처럼 `physical` 안의 키도 가리킨다. 속성에서 `set.domain`은 `type`을 지우고 `set.type`은 `domain`을 지운다. 둘을 함께 주면 스키마 오류다. `set`도 `unset`도 없거나 비었으면, 그리고 `set.physical`이 `{}`이면 그것으로는 바뀌는 것이 없다.
- **빈 것 정리**: 명령이 `physical`의 마지막 키를 지우면 `physical`도 지우고, 마지막 키 그룹을 지우면 `keys`도 지운다. `key.create`는 `keys`가 없으면 만든다. 명령이 건드리지 않은 `physical: {}`와 `keys: []`는 그대로 둔다.
- **순서**: `before`는 같은 엔터티의 속성(키) ID이고 그 앞에 놓는다. 없으면 끝이다. `before`가 자기 자신이면 바뀌는 것이 없다.
- **주제영역의 `entities`**: 명령의 목록에 같은 ID가 둘이면 스키마가 거부한다(`uniqueItems`). `addEntities`는 이미 든 것을 빼고 받은 순서로 끝에 붙인다(쓸 때 정렬된다). `removeEntities`는 들어 있지 않은 것을 `entities`에서는 무시하지만, 배치의 노드는 영역에 없던 ID의 것까지 명령이 준 ID 모두를 뺀다(연쇄 표. 그런 노드는 `R09` 오류라 오류 없는 모델에서는 결과가 같다).
- **연쇄**. F03이 함께 고치는 것은 이것이 전부다.

  | 명령 | 함께 바뀌는 것 |
  | --- | --- |
  | `entity.create`의 `subjectArea` | 그 주제영역의 `entities`에 새 ID를 붙인다(이미 적혀 있으면 붙이지 않는다) |
  | `entity.delete` | 그 엔터티를 든 모든 주제영역의 `entities`에서 빼고, 그 ID의 노드가 있는 모든 배치(모델 전체 배치 포함)의 `nodes`에서 뺀다 |
  | `attribute.delete` | 같은 엔터티의 키들의 `attributes`에서 뺀다. 속성이 남지 않은 키는 지운다 |
  | `subjectArea.delete` | `subjectArea`가 그 ID인 배치 항목을 모두 없앤다 |
  | `subjectArea.removeEntities` | `subjectArea`가 그 ID인 배치의 `nodes`에서 그 엔터티들을 뺀다 |

- **배치의 `edges`는 건드리지 않는다.** 검증 규칙 9(`R09`)는 엣지가 실제 관계나 서브타입 멤버를 가리키는지만 보고 양 끝이 보이는지는 보지 않는다. F03은 관계를 지우지 않으므로 엣지가 깨지지 않는다. 한쪽 끝이 그 주제영역에 없는 엣지를 그릴지는 표시의 일이라 F09·F10이 정한다.
- **관계와 서브타입이 가리키는 것**을 지우거나 바꾸는 명령은 따로 막지 않는다. 그런 명령은 부록 D의 오류를 만들고, 받을지는 FR-04가 정한다. 오류가 없는 예제에서는 부록 D의 명령이 모두 거부된다. F04가 이 가운데 전파하거나 함께 지울 것을 정한다.
- **이주된 속성**(`migratedFrom`이 있는 것)도 같다. `R06`은 논리명과 타입만 비교하므로 `nullable`, `definition`, `physical.name` 변경과 순서 변경은 오류를 만들지 않는다. 삭제는 `R04`를, 타입 변경과 롤네임 없는 이름 변경은 `R06`을 만든다. 명령은 `migratedFrom`과 `rolenamed`를 받지 않는다.
- **이름**: 논리명은 유일하지 않아도 된다(형식에 그런 규칙이 없다). 테이블명은 검증 규칙 11이 본다. 물리명의 글자 제한은 두지 않는다(DBMS의 식별자 규칙은 F06, 표준 준수는 F05의 일이다).

### FR-08 묶음과 이력

- **`batch`**: 지금 모델에서 시작하는 작업 모델 하나에 하위 명령을 차례로 적용한다. 실패의 순서는 정해져 있다. (1) 봉투의 오류(FR-03의 1, 2와 `batch` 스키마). (2) 하위 명령을 색인 순으로, 하나마다 모양(FR-03의 3, 4)을 보고 적용한다. 처음 실패한 것에서 묶음 전체를 거부하고, 그 `code`에 `index`(0부터)를 더하고 문구 앞에 `commands[<index>]: `를 붙인다. (3) 모두 적용되면 FR-04의 검증을 한 번 한다(가운데 상태의 오류는 보지 않는다). 이 거부에는 `index`가 없다.
  - `batch` 안에 `batch`를 넣지 못한다. 뒤 하위 명령이 앞에서 만든 객체를 가리키려면 앞 명령에 `id`를 직접 준다.
  - 결과의 `ids`는 하위 명령과 길이가 같다. 생성 명령의 자리는 그때 정해진 ID(뒤에서 지워졌어도), 나머지는 `null`이다.
  - 지우고 같은 `id`로 다시 만드는 것은 된다. 엔터티와 주제영역이면 파일 경로는 FR-06의 것이다. 다시 만든 항목이 끝의 비교로 원래 객체가 될 때, 그 목록의 항목이 모두 시작 모델의 원래 객체이면 목록은 시작 모델의 목록 그대로다(원래 순서). 아니면 다시 만든 항목의 자리는 그 목록의 끝이다(디스크의 파일 순서와는 상관없다).
  - **끝의 비교**: 끝 모델의 항목 가운데 목록, `file`, 직렬화한 글이 시작 모델의 어느 항목과 같은 것은 그 원래 항목 객체로 바꾼다. 그러고 나서 두 모델이 FR-02의 뜻으로 같으면(항목의 집합이 같고 모두 원래 객체) 시작 모델 객체를 그대로 돌려주고 이력도 검증도 없다. 지우기만 한 묶음, 경로가 달라진 묶음은 바뀐 것이다.
- **이력**은 "실행 전 모델과 그 `issues`"의 목록이다. 모델을 바꾼 `execute`가 한 칸을 더하고 다시 실행 목록을 비운다. `batch`도, 처리 하나가 여러 파일을 바꾸는 명령(F04의 이주 전파)도 한 칸이다. 거부된 명령과 바뀐 것이 없는 명령은 둘 다 건드리지 않는다.
- `undo()`는 가장 최근 칸의 모델과 `issues`로 돌아가고(그 객체 그대로다) 지금 것을 다시 실행 목록에 올린다. `redo()`는 그 반대다. 칸이 없으면 `nothing-to-undo`, `nothing-to-redo`다. 100칸을 넘으면 가장 오래된 칸을 버린다. 이력은 편집기 밖으로 나가지 않는다. 모델을 다시 읽으면 부르는 쪽이 새 편집기를 만든다(시점은 F10이 정한다).

### FR-09 저장

```ts
writeChanges(fs, before: ReadonlyModel, after: ReadonlyModel): Promise<{ written: string[]; removed: string[] }>
```

- `before`는 같은 어댑터(같은 연 폴더)로 읽었거나 마지막으로 저장에 성공한 모델, `after`는 저장할 모델이다. 부르는 쪽이 저장에 성공할 때마다 `before`를 그 `after`로 바꿔 든다. 디스크가 `before`와 다르면(언제 달라졌든) 결과는 이 스펙이 보장하지 않는다(8장).
- 보는 것은 엔터티, 관계, 서브타입, 주제영역, 배치의 다섯 목록이다. 매니페스트와 사전 항목은 쓰지도 지우지도 않는다(F03의 명령이 바꾸지 않는다. 모델 폴더 밖의 공용 사전도 그래서 건드리지 않는다).
- **먼저 보는 것**. 어기면 아무것도 읽거나 바꾸지 않고 거부한다.
  - 두 모델이 FR-01의 조건 1~4를 지키고 `dir`이 같다. 아니면 `Cannot save: <FR-01의 이유>`나 `Cannot save: the two models have different folders`인 `TypeError`다.
  - 이 저장이 쓰거나 지울 경로(아래의 두 항목)가 두 모델의 다섯 목록에 든 다른 경로와 글자는 다르고 비교 키(FR-06)가 같으면 `Cannot save: <a> and <b> differ only in letter case`인 `Error`다(`<a>`가 코드 단위 순으로 앞. 문구의 "letter case"는 비교 키가 같다는 뜻이다). 새 경로 둘의 비교 키가 같은 것도 여기에 걸린다. 대소문자만 다른 경로가 얽힌 파일은 어느 파일 시스템에서든 쓰거나 지우지 않는다. 손대지 않는 쌍은 그대로 둔다. 명령은 이런 쌍을 만들지 못한다(새 ID는 소문자이고 FR-06이 대소문자를 접어 본다).
- **쓰는 것**: `after`의 항목 가운데, `before`에서 같은 `file`을 가진 항목과 같은 객체가 아닌 것. 그 항목들만 직렬화하고 그 경로만 읽어, 글이 지금 파일과 다르거나 파일이 없을 때 쓴다(`writeModel`과 같다).
- **새 경로의 보호**: `after`는 가졌고 `before`는 갖지 않은 경로가 차지돼 있으면 `Cannot save: <path> already exists and is not part of the model`인 `Error`로 거부한다. 차지됐다는 것은 그 경로에서 무엇이든 읽히거나(글이 쓰려는 것과 같아도), 부모 폴더의 `fs.list`에 비교 키가 새 파일 이름의 것과 같은 항목이 `file`이든 `directory`든 있다는 뜻이다(문구의 경로는 새 경로다)(두 어댑터 모두 폴더를 읽으면 "없음"이라 읽기만으로는 폴더를 알 수 없다). 부모 폴더는 폴더마다 한 번 나열한다. 읽다가 빠진 파일(F02 FR-05)과 밖에서 생긴 파일을 덮어쓰지 않는다.
- **지우는 것**: `before`의 항목이 가진 `file` 가운데 `after`의 어느 항목도 갖지 않은 것, 정확히 그것만 `fs.remove`한다(`after`의 어느 항목이 가진 경로는 매니페스트와 사전의 것도 지우지 않는다). `before`가 갖지 않았던 경로는 어떤 경우에도 지우지 않는다. 경로의 주인은 두 모델의 `file` 값만으로 정한다(정규화된 글을 그대로 비교한다. 폴더 앞부분 비교나 경로 추측이 없다).
- **순서**: 다섯 단계를 차례로 하고, 단계마다 처음 난 실패에서 멈춰 그것을 알린다. 모두 첫 쓰기보다 먼저다. (1) 두 모델의 조건: FR-01이 적은 순서로, 항목은 목록 순서로(`before` 먼저). (2) 대소문자 규칙. 걸리는 쌍이 여럿이면 작은 쪽 경로, 다음에 큰 쪽 경로의 코드 단위 순으로 첫 쌍이다. (3) 쓸 항목을 경로의 코드 단위 순으로 직렬화한다. (4) 새 경로의 부모 폴더를 폴더 경로의 코드 단위 순으로 하나씩: 나열하고(어댑터 오류면 멈춘다), 그 폴더의 새 경로를 코드 단위 순으로 본다(처음 차지된 것에서 멈춘다). (5) 쓸 경로를 코드 단위 순으로 하나씩 한 번 읽는다("없음"이 아닌 읽기 오류면 멈추고, 읽히는 새 경로는 차지된 것이라 멈춘다). 그래서 앞 폴더의 나열에서 찾은 차지된 경로가 뒤 폴더의 나열 오류보다 먼저이고, 나열의 결과는 어떤 읽기의 결과보다 먼저다.
- **쓰고, 그다음에 지운다**: 검사가 끝나면 쓰기를 경로의 코드 단위 순으로 모두 하고, 모든 쓰기가 성공한 뒤에만 지우기를 코드 단위 순으로 한다. 쓰기가 실패하면 아무것도 지우지 않은 때다. 이 순서가 안전한 것은, 다른 경로와 대소문자만 다른 경로를 쓰거나 지우는 저장을 (2)가 이미 거부하기 때문이다(쓴 파일을 뒤의 지우기가 없앨 수 없다).
- 돌려주는 것: `written`은 실제로 쓴 경로, `removed`는 `remove`가 성공한 경로다(파일이 이미 없었어도 든다). 코드 단위 순이다.
- **실패**: 검사에서 거부되면 아무것도 바뀌지 않았고, 원인을 없앤 뒤 그대로 다시 부를 수 있다. 쓰는 도중 어댑터가 실패하면 그 오류로 거부하고, 새 파일이나 바뀐 파일 일부가 써졌을 수 있으며 아무것도 지워지지 않았다. 지우는 도중 실패하면 쓰기는 모두 됐고 일부만 지워졌다. 두 경우 모두 부르는 쪽은 모델을 다시 읽은 뒤에 저장해야 한다. 스스로 되살리는 것은 F10의 일이다.

### FR-10 성능

- 편집기 자신의 일은 명령(하위 명령)마다 둘이다. (1) ID로 객체를 찾고 ID와 경로가 쓰이는지 보는 일: 명령 하나에 모델 크기에 선형인 것까지만 된다(훑든 색인을 쓰든 구현이 고른다). ID를 고를 때 후보 하나는 집합을 상수 번 찾는 일이다(그 이름 공간의 ID, 쓰이는 경로, 예약 경로, 처음 모델의 경로). 보는 서로 다른 후보는 많아야 (찾는 이름 공간에 이미 있는 그 종류의 ID 수) + (예약 경로와 처음 모델의 경로 수) + (FR-05의 정해진 단계인 슬러그와 스키마 접두의 둘)이다. 속성 `x`, `x_2`, `x_3`이 있는 엔터티에서 넷째 `x`는 후보 넷을 보고 `x_4`가 된다. (2) 손댄 항목을 복사하고, 바뀌었는지 보려고 직렬화하는 일: F02의 직렬화 비용 그대로이고, 그 항목의 목록 정렬(주제영역의 `entities`, 항목 크기 n에 n log n)이 든다. 연쇄(FR-07)도 손댄 항목의 크기에 선형이다: `attribute.delete`는 키 목록을 한 번에 줄이고, `subjectArea.removeEntities`는 그 영역의 배치마다 준 ID를 하나씩 찾는다(ID 수 × 그 영역의 배치 수. 배치의 노드 수와 상관없다). 묶음 안에서 같은 항목을 고치는 하위 명령 n개는 하나마다 그 항목을 많아야 한 번 훑으므로 n × 그 항목의 크기가 든다(하위 명령 1000개 한도가 끝을 정한다). 같은 이름을 거듭 만드는 묶음은 FR-05의 접미사 기억으로 하위 명령마다 후보 둘이다. 이력의 길이와 상관없다. `validateModel`의 비용은 F02의 것이고 여기에 더해진다(모델을 바꾼 `execute`에 한 번. `undo`와 `redo`에는 없다).
- `writeChanges`는 쓸 항목만 직렬화하고 그 경로만 읽는다. 테스트는 항목 하나를 글로 바꾸는 내부 함수를 감시해 이것을 본다(테스트가 볼 수 있는 자리 하나를 둔다는 뜻이고 공개 API가 아니다).
- 회귀 방지선 하나: 엔터티 1000개(속성 15개씩)와 전부 든 주제영역 하나인 모델에서 속성 하나의 `attribute.update`가 250 ms 안이다.

### FR-11 문서 갱신

- `docs/format-v0.md`:
  - "열린 질문"에서 한글 이름의 ID 생성 항목을 지운다.
  - "엔터티" 절의 스키마 접두 문장을 FR-05에 맞게 고친다: "이름에서 만든 ID가 이미 있고, 그 엔터티와 테이블명이 같고 스키마가 다르면 ID 앞에 스키마 이름을 붙인다(`dormant_member`). 그 밖에 겹치면 `_2`, `_3`을 붙인다. ID는 물리명, 없으면 논리명에서 만들고 한글은 로마자로 옮긴다. 자세한 규칙은 `docs/specs/core-commands.md`의 FR-05다."
  - "프로젝트, 모델, 주제영역" 절에 사전 폴더를 `entities`나 `subject-areas`와 겹치게 두지 않는다는 한 문장을 적는다.
- `CLAUDE.md`의 "지금 상태"에 코어에 명령 API(`createEditor`)가 있다는 것을 적는다.

### 형식 변경

없다. 스키마 파일 8개와 생성 모듈, 검증 규칙은 바뀌지 않는다.

## 6. 수용 기준

모두 저장소 루트에서 `pnpm install && pnpm build` 뒤에 실행한다. "테스트"는 `pnpm test`에 든 Vitest 테스트이고 통과 조건은 그 단언이다. 시작 모델은 AC마다 적는다.

- **예제**: `format/v0/examples/shop`의 파일 29개를 메모리 어댑터에 넣고 `loadModel`로 읽은 모델. 테스트마다 새로 읽는다.
- **빈 모델**: `model.yaml`(`formatVersion`, `id: m`, `name: M`)만 있는 폴더를 같은 방법으로 읽은 것.
- **표본 명령**: 테스트 도우미의 목록. 17종마다 하나 이상이고 각자 시작 모델(예제나 빈 모델에 앞서 실행할 명령들)을 함께 가진다. 테스트가 17종을 모두 덮는지 단언한다.

| # | 요구사항 | 확인 방법 | 통과 조건 |
| --- | --- | --- | --- |
| AC-01 | FR-01~03 (백로그 1) | `core` 테스트 "명령 직렬화", "명령 스키마", 타입 검사(`pnpm lint`) | 표본 명령마다(타입을 준 `attribute.create` 포함) 명령 객체로 실행한 결과가 `ok: true`이고, `JSON.parse(JSON.stringify(명령))`으로 새 편집기에 실행한 결과와 `toEqual`이며 결과도 JSON 왕복 뒤 `toEqual`이다. `-0`: `ext`에 `-0`을 넣은 명령을 객체로 실행하면 모델에 `-0`이 있고(`Object.is`), JSON을 거친 명령으로는 `0`이다. `commandSchemas`의 키가 부록 A의 17종과 같고, 스키마마다 준비 과정을 거쳐 컴파일되며 표본 명령을 받고 부록 B의 스키마 사례를 그 문구로 거부한다. `commandSchemas`는 얼어 있고(`Object.isFrozen`, 안쪽까지), 옮겨 적은 필드 규칙이 형식 스키마의 그 자리와 `toEqual`이다. 필수 키가 빠지고 모르는 키가 든 명령의 문구가 `/ must NOT have additional properties`다(문구 순으로 첫 것). FR-01의 공개 이름이 `@erdmaker/core`에서 가져와진다. `editor.model.entities[0]!.data.name = 'x'`, `editor.issues.push(…)`, `editor.issues[0]!.severity = 'warning'`에 붙인 `@ts-expect-error`가 타입 검사를 통과한다(고칠 수 있으면 실패한다) |
| AC-02 | FR-01, FR-09 (백로그 1) | `cli` 테스트 "브라우저 번들"(F02 6.1)에 단계 추가 | 번들 안에서 예제에 편집기를 만들어 `{ type: 'entity.create', name: '배송' }`을 실행하면 `ok`가 `true`, `id`가 `baesong`이다. 이어서 번들의 메모리 어댑터에 `writeChanges`를 하면 `written`이 `['entities/baesong.yaml']`이고, 다시 `validateProject`를 부르면 오류 0개, 엔터티 11개다 |
| AC-03 | FR-08, FR-09 (백로그 2) | `core` 테스트 "실행 취소 왕복" | 모델을 바꾸는 표본 명령마다 그 시작 모델(저장본)에서: 실행(`ok: true`, `model`이 전과 다른 객체) → `writeChanges(저장본, 지금)`(쓰거나 지운 경로가 그 표본의 기대 목록과 같다) → `undo` → `writeChanges(앞의 지금, 지금)`. 끝에 어댑터의 파일 목록과 파일마다의 바이트가 실행 전과 같고 `editor.model`이 시작 모델과 `toBe`다. 이어서 `redo` → `writeChanges`를 하면 가운데 상태의 파일들과 바이트가 같다. 예제에서 `entity.create`의 기대 목록은 `written: [entities/<id>.yaml]`, `subjectArea.delete`(`sales`)는 `removed: [layouts/sales.json, subject-areas/sales.yaml]`이다. 따로, 예제의 `entities/order.yaml`에 주석 한 줄을 넣은 모델에서 `attribute.update` → `undo` → `writeChanges(읽은 모델, 지금)`은 어댑터를 한 번도 부르지 않고 그 파일의 주석이 남아 있다 |
| AC-04 | FR-06, FR-07 (백로그 3) | `core` 테스트 "이름 변경" | 예제에서 따로따로: 엔터티 `order`의 `name`, 그 `physical.name`, 속성 `order.ord_dtm`의 `name`, 그 `physical.name`, 키 `order.ie_ord_dtm`의 `name`, 그 `physical.name`, 주제영역 `sales`의 `name`을 `*.update`로 바꾼다. 매번 그 객체의 `id`와 항목의 `file`이 전과 같고, `writeChanges`의 `written`이 그 파일 하나, `removed`가 비었으며, 써진 파일에서 그 객체의 `id` 값이 전과 같다. `set`에 `id`를 넣은 명령은 `invalid-command`, `/set must NOT have additional properties`다 |
| AC-05 | FR-02, FR-09, FR-10 (백로그 4) | `core` 테스트 "바뀐 파일만", "저장의 조건" | 호출을 기록하는 메모리 어댑터와 항목 직렬화 감시로, 예제에서 따로따로 본다. `attribute.update`(`order.ord_dtm`의 `definition`): 직렬화된 항목, 읽은 경로, 쓴 경로가 모두 `entities/order.yaml` 하나이고 나머지 28개의 바이트가 같다. `subjectArea.removeEntities`(`sales`에서 `order`): 쓴 것이 `layouts/sales.json`과 `subject-areas/sales.yaml` 둘뿐이고 `layouts/sales.json`의 `edges`가 전과 같다. `subjectArea.delete`(`sales`): 쓴 것 0개, `removed`가 그 둘이고 쓰기도 있는 사례 하나에서 `writeText`가 모두 끝난 뒤에 `remove`가 불리고 둘 다 경로의 코드 단위 순이다. 새 경로의 `writeText`가 실패하는 어댑터(검사가 보지 못한 차지된 경로를 흉내 낸다)에서 지우기와 만들기가 든 저장은 거부되고 `remove`가 0번이며 지우려던 파일의 바이트가 그대로다. 모든 경우에 새 모델의 바뀌지 않은 항목이 전 모델의 항목과 `toBe`이고 매니페스트와 사전 경로는 읽히지 않는다. `before`에 없는 경로는 지워지지 않는다(어댑터에 `entities/stray.yaml`과 `entities-old/x.yaml`을 넣어 두고 여러 명령 뒤 저장해도 둘이 남는다). 이미 없는 파일의 삭제도 `removed`에 든다. **조건**: `Customer.yaml`, `cUstomer.yaml`, `customer.yaml`을 읽어 온 모델에서 다른 엔터티만 고친 저장은 성공하고, 그 셋 가운데 하나를 고친 저장은 대소문자 문구로 거부된다. `before`에 `entities/Customer.yaml`, `after`에 `entities/customer.yaml`이 든 손으로 만든 두 모델은 `Cannot save: entities/Customer.yaml and entities/customer.yaml differ only in letter case`로 거부되고, 새 항목 둘의 `file`이 `entities/É.yaml`과 `entities/é.yaml`인 손으로 만든 `after`는 `Cannot save: entities/É.yaml and entities/é.yaml differ only in letter case`로 거부되고 쓰기와 지우기가 0번이다. `dir`이 다른 두 모델과 `file`이 `entities//a.yaml`인 모델도 FR-09의 문구로 거부되며, 세 경우 모두 어댑터 호출이 0번이다. **새 경로의 보호**: `entities/customer.yaml`에 모르는 키 `definiton`이 있어 `loadModel`이 뺀 폴더에서, `reservedFiles` 없이 만든 편집기의 `entity.create`(`name: Customer`)는 `customer`를 만들고, 저장은 `Cannot save: entities/customer.yaml already exists and is not part of the model`로 거부되며 쓰기와 지우기가 0번이고 그 파일의 바이트가 그대로다. `listReservedFiles`의 출력을 준 편집기에서는 ID가 `customer_2`이고 저장이 성공하며 `entities/customer.yaml`이 그대로다. 새 경로에 쓰려는 글과 같은 글의 파일이 이미 있어도 같은 문구로 거부된다. 읽으면 있지만 나열에는 없는 파일을 흉내 내는 어댑터에서(읽기로만 드러나는 차지된 경로) 그런 새 경로 둘(`entities/b.yaml`, `entities/a.yaml`)이 있으면 문구의 경로가 `entities/a.yaml`이고, 그보다 경로 순으로 앞인 쓸 경로의 읽기가 `EACCES`이면 그 오류로, 뒤이면 차지된 경로의 문구로 거부된다(경로 순서가 정한다). `entities`의 나열에 차지된 새 경로가 있고 `subject-areas`의 나열이 `EACCES`이면 차지된 경로의 문구다. 한 폴더의 나열에 차지된 새 경로가 둘이면 어댑터가 준 순서와 상관없이 코드 단위 순으로 첫 경로다. 폴더 `entities/Customer.yaml`이 있는 어댑터에서 `old`를 지우고 `id: customer`를 만드는 `batch`의 저장은 `Cannot save: entities/customer.yaml already exists and is not part of the model`로 거부되고 쓰기와 지우기가 0번이다. 대소문자 규칙에 걸리는 쌍이 둘이면 문구의 쌍이 FR-09의 순서로 첫 것이다. `list`와 읽기가 둘 다 실패하게 한 어댑터에서는 `list`의 오류로 거부된다. 읽기가 `EACCES`로 실패하는 어댑터에서는 거부되고 쓰기와 지우기가 0번이다 |
| AC-06 | FR-02, FR-07 | `core` 테스트 "명령 동작" | 17종마다 표본 명령의 실행 뒤 항목 데이터를 기대값과 `toEqual`로 비교한다. 그 밖에 예제에서: `unset: ['definition']`이 키를 지운다. `unset: ['physical.name']`으로 `physical`이 비면 `physical` 키가 없다. 속성에 `set.domain`을 주면 `type`이 없어지고 그 반대도 된다. `unset: ['domain']`과 `set.type`을 함께 주면 `type`만 남는다. `set.ext`는 통째로 바뀐다. `attribute.create`와 `key.create`의 `before`, `attribute.move`와 `key.move`의 결과 순서(앞으로, 끝으로). 바뀐 것이 없는 사례마다 `result.model`이 전과 `toBe`이고 `canUndo`가 그대로다: 빈 `set`, `set`도 `unset`도 없음, 같은 값, `before`가 자기 자신, 엔터티에 `scope: both`, 이미 든 것만 넣는 `addEntities`, 들어 있지 않은 것만 빼는 `removeEntities`(그 ID의 노드가 그 영역의 배치에 없을 때. 있으면 FR-07대로 노드가 빠진다). `ext`의 키 순서만 바꾼 `set.ext`는 바뀐 것이다. 빈 모델에서: `physical: {}`와 `keys: []`를 가진 엔터티를 넣은 모델에 `attribute.create`를 해도 둘이 그대로다. 키 없는 엔터티에 `key.create` 뒤 `key.delete`를 하면 `keys` 키가 없다. `entity.create`의 `subjectArea`가 그 영역에 ID를 넣는다. `subjectArea.create`는 `entities: []`를 줘도, `entities`가 없어도 `ok: true`이고 `entities`가 `[]`다. `physical.types`의 키 순서만 바꾼 `set.physical`과 속성의 `set.scope: both`는 바뀐 것이고, `set.physical: {}`는 바뀐 것이 없다 |
| AC-07 | FR-04 | `core` 테스트 "검증 정책" | 예제에서 부록 D의 행마다: `code`가 `validation`이고 `issues`가 그 행의 것과 `rule`, `file`, `path`, `message`까지 정확히 같으며, `message`가 `The command would break the model: <첫 Issue의 file>: <그 message>`다. 빈 모델에 명령 없이 데이터를 넣어 만든 깨진 모델에서: (가) PK 둘인 엔터티(`R03` 1개)에 세 번째 `primary` 키를 만들면 성공하고 `issues`가 여전히 `R03` 1개다. (나) 같은 테이블명 `T`인 엔터티 `a`, `b`, `c`(`R11` 2개)에서 `a`를 지우면 성공하고 `R11`이 1개다. (다) 부모 키 속성 하나가 자식 속성 셋으로 이주된 모델(`R04` 1개, `found 3`)에서 그 가운데 하나를 지우면 성공하고 `R04`가 1개(`found 2`)다. (라) (가)의 모델에서 다른 엔터티의 `attribute.update`는 성공하고, 속성에 없는 도메인을 주면 `validation`이며 `issues`가 그 `R02` 하나다. (마) (가)의 모델에서 PK 하나를 지우면 성공하고 `issues`가 0개다. (바) 키가 없는 속성을 가리키는 엔터티 `a`(`R02` 1개)에서 `entity.update`(`a`, `set: { ext: { wide: 2 ** 53 } }`)는 `invalid-command`, `/set/ext/wide must be a JSON value`다(FR-03). 복사를 `structuredClone`으로 바꾼 테스트(규칙 (가) 자체를 본다)에서는 오류 수가 1개 그대로여도 `validation`, `issues`가 `schema`, `entities/a.yaml`, `/ext/wide`, `/ext/wide must be a JSON value` 하나, 문구가 `The command would break the model: Cannot write entities/a.yaml: /ext/wide must be a JSON value`다. (사) 속성 `[a, b]`이고 `a.ext`가 `{ wide: undefined }`인 엔터티 `x`(이미 쓸 수 없는 모델이다)에서 `a.ext`를 지우고 `b`를 `a` 앞으로 옮기고 `b.ext`를 `{ wide: 2 ** 53 }`로 하는 `batch`는 `invalid-command`, `/commands/2/set/ext/wide must be a JSON value`다. 복사를 바꾼 테스트에서는 받아들여진다: `x`는 전에도 쓸 수 없어 (가)에서 빠지고 오류가 1개에서 1개(`/attributes/0/ext/wide`)라 (나)를 지킨다. 그 모델은 여전히 쓸 수 없다. 마지막 수정을 뺀 같은 `batch`는 오류 0개로 고친다. (아) 속성 `[good, bad]`이고 `bad.name`이 `3`인 엔터티에서 `good`을 지우면 성공하고 오류가 `/attributes/0/name` 하나로 옮는다. 쓸 수 없는 항목이 있는 모델에서 다른 엔터티의 수정은 성공한다. 복사를 바꾼 테스트에서 한 항목을 고치며 다른 항목을 쓸 수 없게 하는 `batch`와 쓸 수 없는 새 항목은 `validation`이다 |
| AC-08 | FR-05 | `core` 테스트 "ID 만들기" | 빈 모델에서 이름마다 기대 ID가 나온다: `Order Item` → `order_item`, `ORD_NO` → `ord_no`, `고객` → `gogaek`, `주문번호` → `jumunbeonho`, `값` → `gaps`, `닭` → `dalk`, `읽기` → `ilkgi`, `엔터티` → `enteoti`, `  __proto__  ` → `proto`, `constructor` → `constructor`, 전각 `ＡＢＣ１` → `abc1`, `café` → `caf`, `a--b__c` → `a_b_c`, `123` → `123`, `a` 70개 → `a` 63개, `값` 20개 → `gaps` 15번 뒤에 `gap`(63자). `漢字`, `🙂`, `___`, 공백뿐인 이름의 엔터티·속성·주제영역은 `entity`, `attribute`, `area`이고 이름 없는 키는 `pk`, `ak`, `ie`다. `physical.name`이 `CUSTOMER_V2`이고 `name`이 `고객`이면 `customer_v2`, `physical.name`이 `___`이면 `gogaek`이다. 테이블명 없이 같은 이름으로 세 번 만들면 `x`, `x_2`, `x_3`이다. `a` 63개가 있으면 다음은 `a` 61개 + `_2`다. 257번째 글자부터만 영문자인 이름은 `entity`다. 스키마 접두는 사례마다 새 모델에서 본다. 시작은 `id: member`, `physical: { name: MEMBER, schema: main }`인 엔터티 하나이고, 만든 뒤 `issues`가 0개다: (가) `MEMBER`, `schema: dormant` → `dormant_member`. (나) 같은 명령에 `reservedFiles: [entities/dormant_member.yaml]` → `dormant_member_2`. (다) `MEMBER`, 스키마 없음 → `member_2`. (라) `MEMBER`, `schema: '!!'` → `member_2`. (마) `physical.name: Member`, `schema: dormant` → `member_2`(테이블명의 글자가 달라 접두가 없다). (바) 시작 엔터티와 새 엔터티 둘 다 `physical.name`이 없고 이름이 `member`이면 스키마가 달라도 `member_2`다. (사) `id: member`를 직접 주면 스키마가 달라도 `id-taken`이다. (아) 겹친 후보: `s`가 `'2_'.repeat(30) + '2'`(61자)일 때, `id`가 `s_3`이고 `physical: { name: <그 id>, schema: main }`인 엔터티와 `id`가 `s_2`인 엔터티가 있는 모델에서 같은 `physical.name`에 `schema: '2'`로 만들면 `s_4`다. 슬러그 `s_3`, 접두를 붙여 63자로 자른 `s_2`, 접미사 단계의 `s_2`와 `s_3`(이미 본 것이라 건너뛴다), `s_4` 순이라 찾아본 서로 다른 후보는 셋이다(후보를 찾는 내부 함수를 감시해 센다). 엔터티와 주제영역의 이름 `CON`은 `con_2`, 속성 이름 `CON`은 `con`이다. 직접 준 `id`의 거부 이유 다섯과 그 우선순위(쓰이고 있으면서 `nul`인 `id`는 1번 문구)가 부록 B의 문구와 같다. 엔터티와 주제영역이 같은 ID `sales`를 쓸 수 있다. 엔터티를 지운 뒤 같은 이름으로 만들면 같은 ID다. 한 묶음에서 `x`를 셋 만들고 `x_2`를 지운 뒤 다시 만들면 `x_4`이고, 다음 묶음에서는 `x_2`를 쓴다. 같은 이름의 엔터티·주제영역·속성을 한 묶음에서 250, 500, 1000번 만들면 찾아본 후보의 수가 크기에 선형이다(후보를 찾는 함수를 감시해 센다) |
| AC-09 | FR-05, FR-06, FR-09 | `core` 테스트 "새 파일 경로", "다시 읽기" | `dir`이 `billing`인 모델에서 새 엔터티의 `file`이 `billing/entities/<id>.yaml`, 새 주제영역이 `billing/subject-areas/<id>.yaml`이다. `file`이 `entities/Customer.yaml`이고 `id`가 `cust`인 엔터티가 있으면 이름 `Customer`의 새 엔터티는 `customer_2`다. `reservedFiles`에 `entities/tag_2.yaml`을 주고 이름 `tag_2`로 만들면 `tag_2_2`다. `listReservedFiles`는 `entities/` 아래에 모델의 파일 `a.yaml`, 폴더 `b.yaml`, 깨진 파일 `c.yaml`이 있는 어댑터에서 셋의 경로를 모두 돌려준다. 그 출력을 그대로 `reservedFiles`로 준 편집기에서 `a`를 지우고 `id: a`로 다시 만드는 `batch`가 성공하고, 이름 `b`와 `c`의 새 엔터티는 `b_2`, `c_2`다. `reservedFiles` 없이 만든 편집기에서는 이름 `b`가 `b`가 되고, 저장은 폴더 `entities/b.yaml` 때문에 `Cannot save: entities/b.yaml already exists and is not part of the model`로 거부되며 쓰기와 지우기가 0번이다. **대소문자**: `entities/Customer.yaml`(`id: customer`)을 읽어 온 편집기에서 그 엔터티를 지운 뒤 `id: customer`인 `entity.create`는 `id-taken`, `entity id "customer" cannot be used: a file with another letter case was loaded: entities/Customer.yaml`이고, 이름 `Customer`로 만들면 `customer_2`다. `entities/customer.yaml`(`id: customer`)만 읽어 온 편집기에서는 지우고 `id: customer`로 다시 만들 수 있다. `Customer.yaml`, `cUstomer.yaml`, `customer.yaml`(ID `a`, `b`, `customer`)을 읽어 온 편집기에서는 `customer`만 지운 뒤의 `id: customer`가 `id-taken`, `entity id "customer" cannot be used: entities/customer.yaml is already in use`다(남은 두 파일이 같은 비교 키의 경로를 쓰고 있어 FR-05의 넷째 이유가 먼저 걸린다). 셋을 모두 지운 뒤에는 `id-taken`이고 문구가 다섯째 이유의 것이며 경로가 `entities/Customer.yaml`이고, `undo`로 되돌렸다 다시 지워도 같다. **다시 읽기**: 예제에서 `entity.create`(`name: 배송`, ID `baesong`이 `address`와 `category` 사이에 온다)와 `subjectArea.create`(`entities: [product, address]`)를 실행하고 `writeChanges` 뒤 `loadModel`하면 `issues`가 0개, `validateModel`이 0개이고 `serializeModel(읽은 모델)`이 `serializeModel(editor.model)`과 `toEqual`이다. `model.yaml`에 `dictionaries: [entities]`를 적은 빈 모델에서는 `entity.create`(`name: Customer`)가 `id-taken`, `entity id "customer" cannot be used: entities/customer.yaml is inside the dictionary folder entities`이고, `subjectArea.create`는 성공해 같은 다시 읽기 단언을 통과한다 |
| AC-10 | FR-07 | `core` 테스트 "연쇄와 대상" | 예제에 `entity.create`(`subjectArea: catalog`)로 엔터티를 만들고 `layouts/catalog.json`에 그 노드를 넣은 모델에서 그 엔터티를 지우면: 성공, `issues` 0개, 저장하면 `removed`가 엔터티 파일, `written`이 `layouts/catalog.json`과 `subject-areas/catalog.yaml`이다. 예제에서 `attribute.delete`(`order.ord_dtm`)는 성공하고 `ie_ord_dtm`의 `attributes`가 `[cust_no]`다. 빈 모델에서 키의 하나뿐인 속성을 지우면 키도 없어진다. 예제에서 이주된 속성 `order.cust_no`의 `definition`, `nullable`, `physical.name` 변경과 `attribute.move`는 성공한다. `set`에 `migratedFrom`을 넣으면 `invalid-command`다. 없는 엔터티, 속성, 키, 주제영역, `before`, `entity.create`의 `subjectArea`는 `not-found`이고 문구가 부록 B와 같다. **찾기와 검증**: 예제에서 `subjectArea.addEntities`(`sales`, `[missing]`)는 `validation`이고 `issues`가 `R02`, `subject-areas/sales.yaml`, `unknown entity "missing"` 하나다. 같은 명령 뒤에 `id: missing`인 `entity.create`를 둔 `batch`는 성공한다. `key.create`의 `attributes`에 없는 속성을 주면 `validation`(`R02`)이다. 쓰이고 있는 `id`와 없는 `subjectArea`를 함께 준 `entity.create`는 `not-found`이고, 없는 `entity`와 스키마 위반을 함께 가진 `attribute.create`는 `invalid-command`다. `id`가 같은 엔터티 둘을 넣은 모델에서 그 `id`의 `entity.update`, `entity.delete`, `attribute.create`는 `ambiguous-target`이고, 한 엔터티에 `id`가 같은 속성 둘이 있으면 `attribute.update`, `attribute.delete`, `attribute.move`가 그렇다. 문구가 부록 B와 같다. **일의 수**(`noteWork`를 센다): 키 2n개 가운데 n개를 비우는 `attribute.delete`와, 엔터티 n개를 든 영역에서 그 n개를 빼는 `removeEntities`(그 영역의 배치 하나)의 일이 n = 250, 500, 1000에서 선형이고, 노드가 n개(4000까지)인 배치의 영역에서 노드 없는 ID 하나를 빼는 일은 n과 상관없이 같다. 센 일이 그 작업의 몫보다 적으면(세는 곳을 지우면) 실패한다 |
| AC-11 | FR-01~03 | `core` 테스트 "믿을 수 없는 입력", "거부 문구" | **거부 표**: 입력마다 `execute`가 던지지 않고 `invalid-command`와 부록 B의 문구를 문자열로 같게 돌려주며 `editor.model`이 전과 `toBe`다. `null`, `[]`, `'x'`, `42`, `undefined` / `ext` 안의 `Date`, 함수, `NaN`, `[1, , 2]`, `[undefined]`, `Array`의 하위 클래스 인스턴스, 색인 `0`이 getter인 배열, 프로토타입에서 색인 값을 물려받는 배열 / `get` 트랩만, `ownKeys` 트랩만, 서술자 트랩만 던지는 Proxy(각각 명령 자신일 때와 `ext`일 때) / 자기 자신을 가리키는 `ext` / 33단계, 값 100001개, 글 합 1000001, 값이 모두 `undefined`인 키 100001개(값 한도), 값 한도를 넘고 그 뒤에 `Date`가 있는 입력(값 한도), 33단계째 컨테이너가 값 한도도 넘기는 입력(깊이) / `type` 없음, `type: 1`, `type: 'entity.rename'`, 줄바꿈이 든 100자 `type`(문구가 한 줄이다), 501자를 넘는 문구가 되는 입력(500개 뒤 `…`) / 부록 B의 스키마 문구 / `JSON.parse('{"type":"entity.create","name":"a","__proto__":{"x":1}}')`(이 뒤 `({}).x`가 `undefined`다). **받는 표**(`ok: true`와 기대한 모델): 정확히 32단계, 값 100000개, 글 합 1000000 / 값이 `undefined`인 속성은 없는 것처럼 실행된다 / 색인이 아닌 자기 속성을 붙인 배열을 `entities`로 주면 색인의 값만 든 배열로 들어간다 / `JSON.parse`로 만든 `ext`의 `__proto__` 키는 모델의 그 `ext`에 자기 속성으로 있고 프로토타입은 `Object.prototype`이다. `Object.assign(['product'], { toJSON() { return ['address'] } })`를 `subjectArea.create`의 `entities`로 주면 모델에 `[product]`가 들어간다(쓰이는 것은 사본이다). 실행 뒤 명령 객체의 `ext`를 고쳐도 모델이 그대로다. 표본 명령마다, 그 명령이 넣은 값에서 닿는 객체는 명령 객체와도 모델의 다른 곳과도 같은 객체가 아니다. **재진입**: `name`의 getter가 같은 편집기의 `execute`를 부르고(그 결과가 `internal`, `The editor is busy`) 던지면 바깥 호출은 `invalid-command`이고 `editor.model`, `canUndo`가 그대로다. 처리 하나가 던지도록 모듈을 바꿔치기한 테스트에서 `execute`는 `internal`, `Unexpected error: <그 메시지>`이고 `editor.model`이 전과 `toBe`다 |
| AC-12 | FR-08 | `core` 테스트 "이력" | 빈 모델에서: 새 편집기의 `undo`와 `redo`는 `nothing-to-undo`, `nothing-to-redo`다. 명령 3개 뒤 `undo` 3번이면 처음 모델과 `toBe`, `redo` 3번이면 마지막 모델과 `toBe`다. `undo` 뒤 새 명령이 성공하면 `canRedo`가 `false`다. `undo` 뒤 거부된 명령과 바뀐 것이 없는 명령은 `canRedo`를 그대로 둔다. 명령 101개 뒤 `undo`는 100번 성공하고 101번째는 `nothing-to-undo`다. AC-07 (가)의 모델에서 (마)의 명령을 실행하고 `undo`하면 성공하고 `issues`에 `R03`이 다시 있다 |
| AC-13 | FR-04, FR-08 | `core` 테스트 "묶음" | 빈 모델에서 `id`를 준 `entity.create`, 그 엔터티에 `attribute.create`, `key.create`의 `batch`: `ok: true`, `ids`가 세 ID이고 엔터티 데이터가 기대값과 `toEqual`이며, `undo` 한 번에 처음 모델과 `toBe`다. 검증기 모듈을 감시하면 이 실행에서 `validateModel`이 정확히 1번 불린다. **실패의 순서**(한 테스트): 0번이 옳고 1번이 없는 엔터티를 가리키고 2번이 스키마에 안 맞는 묶음은 `not-found`, `index` 1, 문구가 `commands[1]: `로 시작한다. 1번과 2번을 바꾸면 `invalid-command`, `index` 1이다. 거기에 `commands` 옆에 모르는 키를 더하면 `index` 없는 `invalid-command`(봉투)다. 셋 다 모델이 전과 `toBe`이고 `validateModel`이 0번 불린다. 예제에서 `order`의 `pk`를 지우고 같은 속성의 `primary` 키를 다시 만드는 둘은 성공한다(첫 명령만 실행하면 부록 D의 `validation`이다). 끝이 오류이면 `validation`이고 `index`가 없다. **끝의 비교**: 만들고 지우는 둘은 `ok: true`, `ids`가 `[<id>, null]`, `model`이 전과 `toBe`, `canUndo`가 그대로이고 `validateModel`이 0번 불린다. 예제에서 관계 없는 새 엔터티를 지우고 같은 `id`와 같은 값으로 다시 만들면서 `order.ord_dtm`의 `definition`도 바꾸는 묶음은, 새 모델에서 다시 만든 엔터티의 항목이 전 항목과 `toBe`이고 저장하면 `written`이 `entities/order.yaml` 하나다. **같은 대상**: 한 속성 앞에 넣기 n번, 한 주제영역에서 하나씩 빼기 n번(n = 250, 500, 1000)은 하위 명령마다 그 항목을 많아야 한 번 훑는다(멤버 색인 만들기가 n번 이하, 일의 합이 항목 크기의 합 + 10n 이하). **지우기만**: 빈 모델에 엔터티 둘을 만들어 저장한 뒤 하나를 지우는 `batch`는 `ok: true`, `model`이 전과 다른 객체이고 `canUndo`가 `true`다. 저장하면 `removed`가 그 파일이고, `undo` 뒤 저장하면 그 파일이 같은 바이트로 돌아온다. `batch` 안의 `batch`는 부록 B의 문구다 |
| AC-14 | FR-01 | `core` 테스트 "편집기 만들기" | `createEditor`가 FR-01의 이유를 어긴 사례 열마다 그 문구의 `TypeError`를 던진다(`null`, `dir: 'a//b'`, `entities: {}`, `entities: [1]`, 엔터티의 `file`이 `entities//a.yaml`, 사전의 `file`이 `.`, `dir`이 `billing`인데 엔터티의 `file`이 `billing-old/entities/a.yaml`, 같은 `file`의 두 엔터티, `file`이 `../dictionary/a.yaml`로 같은 두 사전, `dir`이 `..`인데 엔터티의 `file`이 `../../x.yaml`. 이것은 `writeChanges`도 어댑터 호출 0번으로 거부한다). `file`이 `../dictionary/a.yaml`인 사전 하나는 받는다. 매니페스트의 `data`나 `dictionaries`가 던지는 접근자이거나 트랩이 던지는 Proxy이거나 배열이 아니거나 빈 칸이 있으면 던지지 않고 사전 폴더가 기본 `dictionary`다(이름 `Customer`의 새 엔터티가 성공한다). `dictionaries`가 없음, 목록, `42`, `[entities, 42]`, 빈 글이 든 목록, 다른 스키마 오류, 읽히지 않는 `model.yaml`의 사례마다 편집기의 사전 폴더가 `loadModel`이 나열하는 폴더와 같다. 100만 자 항목과 `'x'.repeat(2 ** 20)` 구성요소의 항목은 빠지고 `createEditor`가 던지지 않는다. `length`가 `NaN`, `-1`, `1.5`, 2³²인 `reservedFiles` Proxy는 색인을 읽기 전에, 2³² − 1로 늘린 것은 처음 없는 색인에서, 접근자 색인은 부르지 않고, `[false, …글 10000개]`는 색인 하나만 보고, `get`이 글을 돌려주는 `[42]`는 그 값을 쓰지 않고 FR-01의 문구로 거부된다. 오류가 있는 모델로는 던지지 않고 `issues`에 그 오류가 있다. 거부 코드 여덟마다 한 사례에서 호출 뒤 `editor.model`과 `editor.issues`가 전과 `toBe`이고 `canUndo`, `canRedo`가 같다. 같은 모델과 같은 `reservedFiles`로 만들어 같은 호출을 차례로 한 두 편집기는 호출마다 `toEqual`인 결과를 낸다(`undo`와 `redo` 포함) |
| AC-15 | FR-08, FR-10 | `core` 시간 테스트 `command/*.perf.test.ts`, `core` 테스트 "이력" | 엔터티 1000개(속성 15개씩, 전부 든 주제영역 하나)의 편집기에서 속성 하나의 `definition`을 두 값으로 번갈아 바꾸는 `attribute.update`를 준비 실행 1회 뒤 5회 재서 가장 빠른 것이 250 ms 미만이다. 재는 구간 밖에서 매번 `ok: true`와 `model`이 전과 다른 객체임을 단언한다. `undo`와 `redo`는 시간으로 재지 않는다: 호출마다 `validateModel`이 0번 불리고 `model`과 `issues`가 기대한 스냅숏의 것과 `toBe`다 |
| AC-16 | FR-11, 형식 변경 | 스크립트 6.1 | 종료 코드 0 |
| AC-17 | 제약 | [repo-scaffold.md](./repo-scaffold.md) 6.5의 절차 | `spikes/`의 파일 목록과 해시가 작업 전과 같다 |
| AC-18 | 전체 | `pnpm build && pnpm test && pnpm lint && pnpm validate:format`, PR 뒤 `gh pr checks` | 모두 성공이다. `packages/core/package.json`의 `dependencies`가 `ajv`, `yaml` 그대로다 |

### 6.1 AC-16 문서와 형식

```bash
(set -euo pipefail
 git rev-parse --verify --quiet 'main^{commit}' > /dev/null
 git diff --quiet main -- format/ packages/core/src/generated/
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

## 7. 구현할 때 확인할 것

- 부록 D의 `Issue`와 AC-07의 깨진 모델 세 사례의 오류 수는 2026-11-28에 같은 모양의 메모리 모델을 `validateModel`로 확인했다. 6장의 나머지 사례는 구현 전에 쓴 것이다. 틀리면 같은 조건을 검사하도록 고친다(조건을 낮추지 않는다).

## 8. 알려진 한계

- **F04 전에는 관계에 묶인 것을 거의 못 고친다.** 부모 키 속성의 이름·타입 변경, 관계의 끝인 엔터티의 삭제가 거부된다(부록 D). 예제의 엔터티 10개는 모두 그렇다.
- **이미 오류가 있는 모델에서는 거부 규칙이 느슨하다.** 오류는 수만 세므로, 오류 하나를 없애면서 다른 하나를 만드는 명령이 받아들여진다. 이미 쓸 수 없는 항목에는 명령이 쓸 수 없는 값을 하나 더 넣어도 수가 늘지 않으면 받아들여진다(AC-07 (사). 명령의 입력으로는 그런 값이 들어오지 않는다). 검증기가 한 `Issue`로 접어 알리는 결함을 더하는 명령도 받아들여진다: PK가 이미 둘인 엔터티에 세 번째 PK를 만들어도 `R03`은 여전히 하나다. 오류가 0개인 모델에서는 생기지 않는다.
- **쓸 수 없는 항목을 다루는 명령.**
  - 자기 오류(스키마나 JSON 값)가 파일 간 오류를 가리던 항목을 고치는 명령은 거부될 수 있다. 고치면 가려졌던 오류가 돌아와 수가 늘기 때문이다(예: `name`이 `3`이고 키 둘이 없는 속성을 가리키는 엔터티). 모두 함께 고치는 `batch` 하나로 벗어난다. 손으로 만든 모델에서만 생긴다(`loadModel`은 스키마 오류가 있는 파일을 뺀다).
  - 쓸 수 없는 항목을 건드리는 명령은 아무것도 바꾸지 않아도 언제나 바뀐 것으로 친다(견줄 글이 없다). 그래서 그 항목을 고치거나 명령을 되돌리기 전까지 다음 `writeChanges`가 실패한다.
- **원래 바이트로 돌아가는 것은 정규형 파일에서다.** 주석이 있거나 키 순서가 다른 파일은 명령이 건드린 뒤 저장하면 정규형이 되고, 그 뒤에 되돌려 저장해도 정규형이다. 저장 전에 되돌리면 그대로다(AC-03).
- 저장의 한계는 F10이 맡는다. 한 줄씩이다.
  - 디스크가 `before`와 달라져 있으면(모델이 가진 파일을 밖에서 고쳤으면) 알아채지 못하고 덮어쓰거나 지운다. 모델에 없던 경로의 파일만 지킨다(FR-09). 충돌 감지가 없다.
  - 쓰는 도중 실패하면 새 파일이나 바뀐 파일 일부가 써졌을 수 있고 지워진 것은 없다. 무엇까지 했는지 알려 주지 않으므로 모델을 다시 읽어야 한다(FR-09).
  - 검사는 어댑터가 나열하지 않는 폴더(Node 어댑터의 32단 한도에 걸린 폴더)가 새 경로를 차지한 것을 보지 못한다. 그때는 쓰기가 실패하고 아무것도 지워지지 않는다. 파일 시스템이 비교 키와 다른 규칙(다른 정규화나 접기)으로 같은 파일로 치는 철자도 알아채지 못한다. 쓰기가 실패하면 지워진 것이 없지만, 한 파일에 두 번 성공한 쓰기는 알 수 없다.
  - 한 모델에 `writeChanges`를 겹쳐 부르지 않는 것은 부르는 쪽의 일이다. 원자적이지 않다. 지운 뒤 빈 폴더가 남는다.
  - 대소문자만 다른 경로 쌍에 든 파일은 고쳐도 저장되지 않는다(FR-09. 나머지 파일은 저장된다). 대문자가 든 파일명으로 읽어 온 객체는 지운 뒤 같은 ID로 다시 만들 수 없다(FR-06). 파일 이름을 앱 밖에서 바꾸면 된다.
- `writeChanges`는 스키마를 보지 않는다. 손으로 만든 `after`에 스키마 오류가 있으면 `loadModel`이 빼는 파일을 쓰고 원래 파일을 지울 수 있다. 오류가 0개인 모델에서 명령이 만든 모델은 스키마를 통과한다.
- 메모리 어댑터의 `writeText`는 새 경로(없는 파일)마다 저장된 경로를 모두 훑는다(F02 8장의 `list`와 같다). 파일이 수천 개인 모델에 새 파일을 많이 쓰는 저장은 느리다. 실제 저장은 새 파일이 몇 개다.
- 하드 링크는 다루지 않는다. 하드 링크인 파일은 그 자리에 다시 써지므로 다른 이름의 내용도 함께 바뀐다(F02와 같다).
- `entities`나 `subject-areas`가 폴더가 아닌 것(파일)으로 있으면 알아채지 못하고, 저장할 때 어댑터의 오류로 드러난다.
- 편집기가 준 모델을 부르는 쪽이 고치면 이력과 저장이 틀어진다. 타입이 막을 뿐 실행 중에는 막지 않는다.
- 입력 한도는 걷기에 대한 것이다. 키가 아주 많은 객체의 키 나열(`Object.keys`)과 트랩이 실행하는 코드는 한도 밖이다. MCP의 입력은 파싱한 JSON이라 그런 객체가 올 수 없다.
- 명령의 값은 32단계까지다. 그보다 깊은 `ext`(형식은 256단계까지 허용한다)는 명령으로 넣을 수 없다.
- 한 엔터티 안에서 컬럼명(`physical.name`)이나 논리명이 겹치는 것은 막지 않는다. 형식에 그런 규칙이 없다. F06에서 정한다.
- 같은 항목을 거듭 고치는 묶음은 하위 명령 수 × 그 항목의 크기다(FR-10). 엔터티 하나에 속성 1000개를 하나씩 넣는 묶음은 약 50만 칸을 본다. 증분 색인을 두지 않는다(결정 기록 D-11).
- 검증은 명령마다 전체다(2장의 관찰: 엔터티 4000개에서 240 ms쯤). 오류가 아주 많은 모델에서는 `Issue` 목록의 크기도 비용에 든다.
- 로마자는 국어의 로마자 표기법의 글자를 음절마다 그대로 옮긴 것이고 소리 변화 규칙을 따르지 않는다(`읽기` → `ilkgi`). 한글도 영문자도 숫자도 없는 이름은 `entity_2` 같은 ID가 된다. 사전에서 물리명을 얻는 호출자(F05, F13)와 가져오기(F07)는 `physical.name`이나 `id`를 넘긴다.
- `set`으로 `ext` 안의 키 하나만 바꿀 수 없다. `ext`는 통째로 바꾼다.

## 부록 A. 명령

모든 명령에 `type`이 있다. `?`는 선택이다. 값은 형식 스키마의 같은 이름 필드와 같다.

| `type` | 필드 |
| --- | --- |
| `entity.create` | `name`, `id?`, `definition?`, `note?`, `scope?`, `nameSource?`, `physical?`(`name?`, `schema?`), `ext?`, `subjectArea?` |
| `entity.update` | `id`, `set?`(`name`, `definition`, `note`, `scope`, `nameSource`, `physical`(`name`, `schema`), `ext`), `unset?`(`definition`, `note`, `scope`, `nameSource`, `physical`, `physical.name`, `physical.schema`, `ext`) |
| `entity.delete` | `id` |
| `attribute.create` | `entity`, `name`, `id?`, `definition?`, `note?`, `scope?`, `term?`, `domain?`, `dataType?`, `nullable?`, `default?`, `validValues?`, `physical?`(`name?`, `types?`), `nameSource?`, `ext?`, `before?` |
| `attribute.update` | `entity`, `id`, `set?`(`name`, `definition`, `note`, `scope`, `term`, `domain`, `type`, `nullable`, `default`, `validValues`, `physical`(`name`, `types`), `nameSource`, `ext`), `unset?`(`definition`, `note`, `scope`, `term`, `domain`, `type`, `nullable`, `default`, `validValues`, `physical`, `physical.name`, `physical.types`, `nameSource`, `ext`) |
| `attribute.delete` | `entity`, `id` |
| `attribute.move` | `entity`, `id`, `before?` |
| `key.create` | `entity`, `kind`, `attributes`, `id?`, `name?`, `scope?`, `physical?`(`name?`), `ext?`, `before?` |
| `key.update` | `entity`, `id`, `set?`(`kind`, `name`, `attributes`, `scope`, `physical`(`name`), `ext`), `unset?`(`name`, `scope`, `physical`, `physical.name`, `ext`) |
| `key.delete` | `entity`, `id` |
| `key.move` | `entity`, `id`, `before?` |
| `subjectArea.create` | `name`, `id?`, `definition?`, `group?`, `order?`, `entities?`(없으면 `[]`, 빈 목록도 된다), `ext?` |
| `subjectArea.update` | `id`, `set?`(`name`, `definition`, `group`, `order`, `ext`), `unset?`(`definition`, `group`, `order`, `ext`) |
| `subjectArea.delete` | `id` |
| `subjectArea.addEntities` | `id`, `entities`(ID 1개 이상, 겹치지 않음) |
| `subjectArea.removeEntities` | `id`, `entities`(ID 1개 이상, 겹치지 않음) |
| `batch` | `commands`(객체 1~1000개) |

생성 명령 넷은 결과에 `id`를 돌려준다. `entity.create`는 `attributes: []`인 엔터티를 만든다. `unset`은 겹치지 않는 목록이다. `attribute.create`의 `dataType`은 속성의 `type`으로 저장된다(명령의 `type`이 종류 이름이라 이름을 달리했다). `domain`과 함께 주면 스키마 오류다. 수정의 `set.type`은 그대로다. 다른 명령에는 `type`이나 그 밖의 명령 필드와 이름이 겹치는 데이터 필드가 없다.

## 부록 B. 거부 코드와 문구

`RejectionCode`는 여덟이다. `<id>`와 `<e>`는 스키마를 통과한 ID다. `<kind>`는 `entity`나 `subject area`다.

| `code` | 경우 | `message` |
| --- | --- | --- |
| `invalid-command` | 객체가 아니거나 배열 | `command must be an object` |
| | 받지 않는 값, 읽다가 예외 | `<path> must be a JSON value`. `<path>`는 그 값의 JSON Pointer이고 명령 자신은 `/`다 |
| | 깊이 | `command is nested more than 32 levels deep` |
| | 값의 수 | `command has more than 100000 values` |
| | 글의 길이 | `command has more than 1000000 characters of text` |
| | `type`이 없거나 글이 아님 | `command type must be a string` |
| | 모르는 종류 | `unknown command type <t>`. `<t>`는 `type`의 앞 50 코드 단위(넘으면 뒤에 `…`)를 `JSON.stringify`한 것. 예: `unknown command type "entity.rename"`, 51자 이상이면 `unknown command type "xxx…"`처럼 `…`가 따옴표 안이다 |
| | 스키마 | 모르는 키: `/ must NOT have additional properties`, `/set must NOT have additional properties`. 빠진 필수 키: `/ must have required property 'name'`. 타입: `/name must be string`. 빈 이름: `/name must NOT have fewer than 1 characters`. `domain`과 타입을 함께: `/ must NOT be valid`(생성), `/set must NOT be valid`(수정). 겹친 목록: `/entities must NOT have duplicate items (items ## 0 and 1 are identical)`. 묶음의 봉투: `/commands must NOT have fewer than 1 items`, `/commands must NOT have more than 1000 items`, `/commands/0 must be object`. 표에 없는 위반의 문구는 계약이 아니다 |
| | 묶음 안의 묶음 | `commands[<i>]: a batch cannot hold a batch` |
| `not-found` | | `entity "<id>" does not exist`, `subject area "<id>" does not exist`, `attribute "<id>" does not exist in entity "<e>"`, `key "<id>" does not exist in entity "<e>"` (`before`와 `entity.create`의 `subjectArea`도 같다) |
| `ambiguous-target` | | `entity "<id>" is not unique in the model`, `subject area "<id>" is not unique in the model`, `attribute "<id>" is not unique in entity "<e>"`, `key "<id>" is not unique in entity "<e>"` |
| `id-taken` | 1. 이미 있음 | `<kind> id "<id>" is already used`, `attribute id "<id>" is already used in entity "<e>"`, `key id "<id>" is already used in entity "<e>"` |
| | 2. 쓰지 않는 이름 | `<kind> id "<id>" cannot be used: it is a reserved file name on Windows` |
| | 3. 사전 폴더 안 | `<kind> id "<id>" cannot be used: <file> is inside the dictionary folder <folder>`. `<file>`은 새 경로, `<folder>`는 정규화한 사전 폴더(연 폴더 자신이면 `.`) |
| | 4. 경로가 쓰임 | `<kind> id "<id>" cannot be used: <file> is already in use` |
| | 5. 대소문자만 다름 | `<kind> id "<id>" cannot be used: a file with another letter case was loaded: <처음 모델의 경로>`(여럿이면 코드 단위 순으로 첫 것) |
| `validation` | FR-04 (가) | `The command would break the model: <serializeItem의 오류 문구>`. 예: `The command would break the model: Cannot write entities/a.yaml: /ext/wide must be a JSON value` |
| | FR-04 (나) | `The command would break the model: <file>: <message>`. 거부의 `issues` 가운데 첫 것의 값이다 |
| `nothing-to-undo` | | `Nothing to undo` |
| `nothing-to-redo` | | `Nothing to redo` |
| `internal` | 처리 중 예외 | `Unexpected error: <메시지>`. `<메시지>`는 `Error`이면 그 `message`, 아니면 `String(값)`, 그것도 던지면 `unknown error`다. `batch`의 하위 명령의 처리가 던지면 그 `index`와 `commands[<i>]: ` 접두가 붙고, 처리 밖(끝의 비교, 검증)의 예외에는 `index`가 없다 |
| | 재진입(FR-01) | `The editor is busy` |

`batch`의 하위 명령이 낸 거부는 위 문구 앞에 `commands[<index>]: `가 붙는다. 모든 `message`는 다 만든 뒤에 FR-03의 한 줄 처리와 500개 자르기를 거친다.

## 부록 C. 한글 음절의 로마자

국어의 로마자 표기법의 글자를 음절마다 초성 + 중성 + 종성으로 이어 붙인다. 소리 변화 규칙(연음, 자음 동화)은 쓰지 않는다. 표의 순서는 유니코드의 자모 순서이고, `-`는 아무것도 붙이지 않는다는 뜻이다. 음절의 색인은 `코드 − 0xAC00`을 588과 28로 나눠 구한다.

- **초성 19**: `g kk n d tt r m b pp s ss - j jj ch k t p h`
- **중성 21**: `a ae ya yae eo e yeo ye o wa wae oe yo u wo we wi yu eu ui i`
- **종성 28**: `- k kk ks n nj nh t l lk lm lp ls lt lp lh m p ps s ss ng j ch k t p h`

예: `고객` → `gogaek`, `주문번호` → `jumunbeonho`, `값` → `gaps`, `닭` → `dalk`, `읽기` → `ilkgi`, `배송` → `baesong`.

## 부록 D. 예제에서 검증이 거부하는 명령

시작 모델은 예제다. `issues`는 표의 것이 전부이고 이 순서다. 문구의 번호는 F02 부록 A의 것이다.

| 명령 | 연쇄 | `issues` (`rule`, `file`, `path`, 문구) |
| --- | --- | --- |
| `entity.delete` `tag` | `catalog`의 `entities`와 `layouts/catalog.json`의 노드에서 뺌 | `R02` `entities/product_tag.yaml` `/attributes/1/migratedFrom/0/attribute` `attribute "tag_no": parent "tag" has no attribute "tag_no"` · `R02` `relationships/product_has_tag.yaml` `/child` `"product_has_tag": unknown child entity "tag"` · `R02` `relationships/product_tag_tag.yaml` `/parent` `"product_tag_tag": unknown parent entity "tag"` |
| `attribute.delete` `order.ord_no` | 키 `pk`가 비어 없어짐 | `R02` `entities/order_item.yaml` `/attributes/0/migratedFrom/0/attribute` `attribute "ord_no": parent "order" has no attribute "ord_no"` · `R04` `relationships/order_contains_item.yaml` `""` `"order_contains_item": parent "order" has no primary key to migrate` |
| `key.delete` `order.pk` | 없음 | `R04` `relationships/order_contains_item.yaml` `""` `"order_contains_item": parent "order" has no primary key to migrate` |
| `attribute.delete` `order.cust_no`(이주된 속성) | `ie_ord_dtm`에서 뺌 | `R04` `relationships/customer_places_order.yaml` `""` `"customer_places_order": customer.cust_no must migrate to exactly one attribute of "order" (found 0)` |
| `attribute.update` `customer.cust_no`, `set.name: 고객ID` | 없음 | `R06` 넷, 문구는 모두 `attribute "cust_no": name differs from customer.cust_no but rolenamed is not set`: `entities/address.yaml` `/attributes/1/name` · `entities/corporate_customer.yaml` `/attributes/0/name` · `entities/order.yaml` `/attributes/1/name` · `entities/personal_customer.yaml` `/attributes/0/name` |
| `entity.update` `product`, `set.physical.name: ORDERS` | 없음 | `R11` `entities/product.yaml` `/physical/name` `table name "ORDERS" is already used by "order" in the same schema` |
| `key.create` `order`, `primary`, `[ord_dtm]` | 없음 | `R03` `entities/order.yaml` `/keys/2` `more than one primary key` |
| `entity.update` `order`, `set.scope: logical` | 없음 | `R08` 다섯: `entities/order.yaml` `/attributes/6/scope` `attribute "created_at": scope is wider than its entity's` · `relationships/customer_places_order.yaml`, `relationships/order_bills_to.yaml`, `relationships/order_ships_to.yaml` 각각 `""` `"<id>": scope is wider than its child entity's` · `relationships/order_contains_item.yaml` `""` `"order_contains_item": scope is wider than its parent entity's` (파일 순서는 `customer_places_order`, `order_bills_to`, `order_contains_item`, `order_ships_to`) |
| `attribute.update` `order.ord_dtm`, `set.domain: nope` | 없음 | `R02` `entities/order.yaml` `/attributes/4/domain` `attribute "ord_dtm": unknown domain "nope"` |
| `subjectArea.update` `catalog`, `set.group: nope` | 없음 | `R12` `subject-areas/catalog.yaml` `/group` `unknown area group "nope"` |
