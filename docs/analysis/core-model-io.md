# F02 `core-model-io` 분석 보고서

**분석일**: 2026-11-27
**대상**: 형식 v0 모델 폴더의 읽기·쓰기·검증을 `@erdmaker/core`로 옮기고 CLI `erdmaker validate <dir>`를 낸다 (브랜치 `feature/core-model-io`)
**스펙**: [docs/specs/core-model-io.md](../specs/core-model-io.md) FR-01~FR-14, AC-01~AC-19
**환경**: Node 22.23.3, pnpm 10.34.9, typescript 6.0.3, ajv 8.20.0, yaml 2.9.1, vite 8.4.0(rolldown 1.3.4), vitest 5.1.2, @types/node 22.20.7, eslint 10.15.0, prettier 3.10.1 (모두 `node_modules`의 설치본)

표기: **[확인: 방법]** 이 세션에서 실행하거나 파일을 읽어 확인함. **[미확인]** 확인하지 못함. 구현 중에 실행해서 확인해야 한다.
실험 스크립트와 결과는 모두 `/tmp/claude-1000/-home-pc-workspace-erdmaker/b8f44d43-ccc8-4fde-9628-61167fb5c8ee/scratchpad/f02-analysis/` 아래에 있다(저장소 밖, 재부팅하면 사라질 수 있다). 아래에서 `exp*.mjs` 등은 이 폴더 안의 파일이다.

## 0. 요약

1. **스펙 2장의 사실은 모두 재현된다.** `lineWidth: 0` + `compat: 'yaml-1.1'`로 YAML 27개가 바이트 그대로 다시 써지고, `compat`이 없으면 `dictionary/standard.yaml`만 4줄(`"no"`, `"NO"`)이 달라진다. 스키마에서 키 순서와 기본값을 읽는 시제품 작성기를 예제에 돌리면 **정확히 스펙이 말한 네 군데(파일 3개)만** 다르다. [확인: `exp1-roundtrip.mjs`, `exp2-canonical.mjs`]
2. **배치 JSON 두 개는 60줄 남짓한 직렬화기로 바이트가 같게 써진다.** `JSON.stringify(v, null, 2)`와는 다르다. 숫자뿐인 ID는 JS 객체가 키를 다시 정렬하므로(`2, 9, 10`) 객체를 정렬해 만들지 말고 글을 직접 찍어야 한다. [확인: `exp3-layout.mjs`]
3. **Vite 8 JS API로 core를 IIFE로 묶어 `console`만 있는 `vm` 컨텍스트에서 Ajv 컴파일과 YAML 읽기까지 돌아간다**(Vitest 안에서, 0.5초). 다만 **플러그인이 없으면 Vite는 `node:fs`를 조용히 빈 모듈로 바꾸고 빌드가 성공한다.** 스펙 6.1의 차단 플러그인은 꼭 필요하다. [확인: `bundle/bundle.test.js`, `exp9-vitecheck.mjs`]
4. **`import Ajv2020 from 'ajv/dist/2020.js'`(기본 내보내기)는 NodeNext에서 `TS2351 not constructable`이다.** 이름 있는 내보내기 `import { Ajv2020 } from 'ajv/dist/2020.js'`는 tsc, Node ESM, Vite 번들 셋 다에서 된다. [확인: scratch `ws/packages/core`]
5. **Ajv는 `Infinity`와 `2 ** 53`을 `type: integer`로 통과시킨다**(`strictNumbers` 기본 false). `Date`, `Uint8Array`도 `ext` 안에서는 통과한다. 스펙의 `must be a JSON value` 검사가 유일한 방어선이다. [확인: `exp8-ajv.mjs`]
6. **`tag:yaml.org,2002:`로 시작하는 태그를 모두 허용하면 `!!binary`, `!!timestamp`, `!!set`이 `Uint8Array`, `Date`, `Set`으로 읽힌다.** 스펙 FR-05의 태그 규칙만으로는 막히지 않고 JSON 값 검사가 잡아야 한다(4.1 위험 Y5). [확인: `exp4-features.mjs`]
7. **AC-07의 두 위치(2:1, 둘째 `nodes` 키의 열 39)는 설치된 엔진과 `yaml`로 그대로 나온다.** [확인: `exp7-json.mjs`]
8. **cli·mcp의 `typecheck`, cli 테스트, 번들 테스트, `validate:format`이 모두 `pnpm build`의 산출물에 의존한다.** CI는 이미 build가 먼저라 `ci.yml`은 고칠 필요가 없다. 로컬에서 빌드 없이 `pnpm lint`를 돌리면 cli의 `typecheck`가 `TS2307 Cannot find module '@erdmaker/core/node'`로 실패한다. [확인: scratch 실험]
9. **스펙 6.2의 스크립트는 `bin` 값이 정확히 `"dist/bin.js"`일 때만 통과한다**(`"./dist/bin.js"`이면 `packages/cli/./dist/bin.js`가 되어 문자열 비교가 깨진다). [확인: 스크립트 읽기]
10. 워크스페이스 루트는 `@erdmaker/cli`에 의존하지 않으므로 `pnpm exec erdmaker`는 bin 링크가 없어 안 된다. 스펙은 경로 직접 실행을 골랐으므로 문제는 없다. [확인: 루트 `node_modules/.bin`과 `package.json` 확인. pnpm의 링크 동작 자체는 설치를 하지 않아 실행 확인 안 함]

## 1. 관련 코드 탐색 결과

### 1.1 기존 파일

| 파일 | 지금 내용 | 이 기능과의 관계 |
| --- | --- | --- |
| `package.json` (루트) | ESM, `packageManager: pnpm@10.34.9`, `engines.node ^22.13.0`. 스크립트 `build: pnpm -r build`, `test: vitest run`, `lint: eslint . && prettier --check .`, `validate:format: node tools/validate-format.mjs format/v0/examples/shop`. devDeps에 `ajv ^8.17.1`(설치 8.20.0), `yaml ^2.6.0`(설치 2.9.1), `vite`, `vitest`, `@types/node`, `typescript ~6.0.3` | `lint`에 `pnpm -r typecheck` 추가, 2단계에서 `validate:format` 교체와 `ajv`·`yaml` 제거 |
| `tsconfig.base.json` | `strict`, `target ES2022`, `moduleDetection force`, `skipLibCheck` | 그대로 |
| `packages/core/tsconfig.json` | base 확장, `rootDir src`, `outDir dist`, `declaration`, `lib ["ES2022"]`, `types []`, NodeNext, `exclude src/**/*.test.ts` | `exclude`에 `src/node` 추가. 나머지 그대로 (AC-11) |
| `packages/{cli,mcp}/tsconfig.json` | core와 같되 `types ["node"]` | 그대로 |
| `packages/web/tsconfig.json` | `noEmit`, `lib ES2022+DOM`, `types []`, Bundler | 그대로 (FR-12에서 제외) |
| `packages/*/package.json` | 모두 `private`, ESM, `exports "."`(types/default → dist), `build: tsc`. cli·mcp·web은 `@erdmaker/core: workspace:*` | core·cli·mcp 고침 |
| `packages/core/src/index.test.ts` | Vitest 연기 테스트 하나 | 바꾸거나 지움 |
| `vitest.config.ts` | `include: ['packages/*/src/**/*.test.ts']` | 그대로 써도 된다. 오래 걸리는 테스트는 테스트별 타임아웃 |
| `eslint.config.js` | `globalIgnores`(spikes, format, docs, dist, coverage, lock), JS·TS 권장, `tools/**/*.mjs`에 `process`·`console` 전역, prettier | `packages/core/src/generated/**` 무시 추가. 2단계에서 `tools/**` 블록 제거 |
| `.prettierrc.json` / `.prettierignore` | `singleQuote: true` / spikes, format, docs, dist, coverage, lock | `packages/core/src/generated/` 추가 |
| `.github/workflows/ci.yml` | checkout → setup-node 22 → corepack → `pnpm --version` → install `--frozen-lockfile` → build → test → lint → validate:format | 고칠 필요 없음 (2.3) |
| `tools/validate-format.mjs` | 381줄. 스키마 검사 + 파일 간 규칙. 출력 `<file>: <message>`, 끝에 `\n<n> error(s)` (stderr), 성공 시 `OK: ...` (stdout), 종료 0/1/2 | 이식 원본, 대조 테스트의 기준, 2단계에서 삭제 |
| `format/v0/schema/*.schema.json` (8개) | 2020-12, `$id`는 `urn:erdmaker:format:0.1:<이름>` | 생성 모듈의 원본. `entity.schema.json` 한 곳 수정 |
| `format/v0/examples/shop/` (29개) | YAML 27 + JSON 2 | 파일 3개 정규화 |

### 1.2 옛 도구의 흐름 (이식 대상)

```
argv[2] → root
  → Ajv2020 { allErrors, strict:false, strictSchema:true } 에 스키마 8개 addSchema (readdirSync 순서)
  → model.yaml 없음 → stderr "No model.yaml in <root>", exit 2
  → load(model.yaml, 'model')
  → 사전: manifest.dictionaries ?? ['dictionary'] 각각 walk(resolve(root, d), '.yaml')
       → words/terms/domains 색인(R01), term의 words/domain 참조(R02)
  → entities / relationships / subtypes / subject-areas (.yaml), layouts (.json) 를 loadAll
  → 매니페스트 schemas(R10)·areaGroups(R12), 테이블명(R11), 영역 group(R12)
  → links = 관계 + 서브타입 멤버(R01 충돌)
  → 엔터티별: 속성 id(R01), domain/term(R02), scope(R08), migratedFrom(R02/R04/R06/R07), 키(R01/R02/R03)
  → link별: 부모/자식 존재(R02), [다대다면 continue], scope(R08), 이주 키(R02/R04/R05)
  → resolvedBy, discriminator, 영역 entities, 배치(R09)
  → errors 있으면 stderr에 한 줄씩 + "\n<n> error(s)", exit 1 / 없으면 stdout OK 줄
```

- `load()`: JSON은 `JSON.parse`, 실패하면 `return err(...)`. **`err`가 `errors.push`의 반환값(숫자)을 돌려주므로** `loadAll`의 `.filter(Boolean)`을 통과해 `layouts`에 숫자가 들어가고 `data.subjectArea`에서 죽는다. [확인: 코드 읽기 + `par/bad` 실행 시 `TypeError: Cannot read properties of undefined (reading 'subjectArea')`, exit 1]
- YAML은 `parseDocument(text, { version: '1.2', schema: 'core', uniqueKeys: true })`. 오류가 있으면 메시지 전체(여러 줄, 코드 프레임 포함)를 내고 그 파일을 버린다. 앵커·별칭·`!`로 시작하는 태그는 오류를 내지만 **파일을 버리지 않고 스키마 검사까지 한다.** [확인: `par/feat` 실행. `!custom` 태그 파일에서 `YAML tag !custom is not allowed`와 `/ext must be object`가 함께 나온다]
- 풀리지 않는 별칭은 `parseDocument`가 오류를 내지 않고 `toJS()`가 `ReferenceError`를 던지므로 옛 도구가 죽는다. [확인: `exp4-features.mjs`]
- 오류 줄의 파일은 `relative(root, file) || file`. 모델 밖 사전은 `../dictionary/standard.yaml`. [확인: `par/proj/m` 실행]
- 실행 시간은 한 번에 약 0.20초다(Ajv 컴파일 포함). [확인: `/usr/bin/time`]

### 1.3 재사용할 것

| 대상 | 위치 | 쓰는 곳 |
| --- | --- | --- |
| 규칙 검사 로직과 메시지 문구 | `tools/validate-format.mjs` 82~371행 | `src/validate/rules.ts`로 이식. 문구는 글자 그대로 (FR-08) |
| Ajv 설정 | 같은 파일 20행 | `src/schema/ajv.ts` |
| YAML 읽기 옵션 | 같은 파일 51~55행 | `src/parse/yaml.ts` (옵션 추가는 3.1) |
| 요약 줄 형식 | 같은 파일 378~381행 | CLI 출력 |
| F01의 패키지 틀 | `packages/*/package.json`, `tsconfig.json` | 그대로 확장 |

외부 의존성은 더하지 않는다(FR-01). 스키마 → TS 타입 생성기 같은 도구도 쓸 수 없으므로 `Model` 등의 타입은 손으로 쓴다.

## 2. 영향 범위

### 2.1 만들 파일

| 파일 | 내용 |
| --- | --- |
| `packages/core/tsconfig.node.json` | `src/node`만 `types ["node"]`로 컴파일 (3.2) |
| `packages/core/tsconfig.test.json` | `noEmit`, `types ["node"]`, `src` 전체(테스트 포함) |
| `packages/core/scripts/generate-schemas.ts` | 스키마 8개 → `src/generated/schemas.ts` (3.5) |
| `packages/core/src/generated/schemas.ts` | 생성물, 커밋 |
| `packages/core/src/**` | 어댑터·경로·파서·모델·쓰기·검증·프로젝트 (3.2의 배치) |
| `packages/core/src/node/{index,fs}.ts` | `createNodeFileSystem` |
| `packages/core/src/**/*.test.ts` | AC-01~09, AC-12, 대조 테스트(1단계만) |
| `packages/cli/src/{bin,main}.ts` | `bin.ts`는 셔뱅 + `main` 호출만 |
| `packages/cli/src/*.test.ts` | AC-13 (자식 프로세스), AC-10 (브라우저 번들) |
| `packages/{cli,mcp}/tsconfig.test.json` | `noEmit`, `src` 전체 |

### 2.2 고칠 파일

| 파일 | 변경 | 위험 |
| --- | --- | --- |
| `packages/core/package.json` | `exports["./node"]`, `dependencies { ajv, yaml }`, 스크립트 `build`, `typecheck`, `generate:schemas` | 중 |
| `packages/core/tsconfig.json` | `exclude`에 `src/node` 추가 | 중 (AC-11) |
| `packages/cli/package.json` | `"bin": { "erdmaker": "dist/bin.js" }` (정확히 이 문자열), `typecheck` | 중 (6.2 스크립트) |
| `packages/mcp/package.json` | `typecheck` | 낮음 |
| `package.json` (루트) | `lint` 끝에 `&& pnpm -r typecheck`. 2단계: `validate:format` → `node packages/cli/dist/bin.js validate format/v0/examples/shop`, devDeps에서 `ajv`·`yaml` 제거 | 중 |
| `pnpm-lock.yaml` | core의 새 의존성. CI가 `--frozen-lockfile`이므로 같은 커밋에 넣는다 | 중 |
| `eslint.config.js` | `globalIgnores`에 `packages/core/src/generated/**`. 2단계: `tools/**/*.mjs` 블록 제거 | 낮음 |
| `.prettierignore` | `packages/core/src/generated/` | 낮음 |
| `format/v0/schema/entity.schema.json` | `$defs.attribute.properties.scope`를 기본값 없는 같은 열거형으로 (FR-07) | 중 |
| `format/v0/examples/shop/model.yaml` | `notation: ie`, `dictionaries: [dictionary]` 제거 | 낮음 |
| `format/v0/examples/shop/subtypes/customer_type.yaml` | `exclusivity: exclusive` 제거 | 낮음 |
| `format/v0/examples/shop/relationships/customer_places_order.yaml` | `parentUpdate`를 `parentDelete` 앞으로 | 낮음 |
| `docs/format-v0.md` | 18행(검사 명령), 109~117행(쓰기 규칙), 119~134행(검증 규칙, 121행 도구 언급) | 낮음 |
| `CLAUDE.md` | 13행(지금 상태), 44~60행(명령) | 낮음 |
| `docs/planning.md` | 242행 "검증 스크립트는 `tools/validate-format.mjs`" | 낮음 |
| `.github/workflows/ci.yml` | **변경 없음** | — |

- `docs/stage1-backlog.md` 92행도 `tools/validate-format.mjs`를 가리키지만 FR-14의 대상 목록에 없다. 고칠지 계획에서 정한다.
- 정규화한 예제 3개는 옛 도구로도 같은 `OK:` 줄이 나온다. [확인: `par/fixed`에 `exp2`의 출력 3개를 넣고 옛 도구 실행, exit 0]

### 2.3 지울 파일 (FR-13 2단계)

`tools/validate-format.mjs`, 대조 테스트 파일, (비면) `tools/` 폴더.

### 2.4 순서 제약

| # | 제약 | 근거 |
| --- | --- | --- |
| C1 | 대조 테스트 커밋(1단계)까지 루트 devDeps의 `ajv`·`yaml`과 `tools/validate-format.mjs`를 남긴다 | 옛 도구는 `tools/`에서 `ajv`를 찾으므로 루트 `node_modules`만 본다. `.modules.yaml`의 `publicHoistPattern`이 `[]`이고 `.npmrc`가 없어 core의 의존성은 루트로 올라오지 않는다(`node_modules/.pnpm/node_modules`에만 있다). [확인: 설정 파일 읽기. 지운 뒤 실패하는 것은 실행 안 함] |
| C2 | 2단계 한 커밋에서 옛 도구 삭제, `validate:format` 교체, 루트 `ajv`·`yaml` 제거, `eslint.config.js`의 `tools/**` 제거, lockfile 갱신을 함께 한다 | 어느 하나만 하면 CI의 `validate:format`이나 `--frozen-lockfile`이 깨진다 |
| C3 | `entity.schema.json` 수정 → 생성 모듈 재생성 → 동기화 테스트 | AC-12 |
| C4 | 예제 정규화는 왕복 테스트(AC-01)와 같은 커밋이거나 앞이어야 한다 | AC-01 |
| C5 | `validate:format`, cli 테스트(bin 실행), 번들 테스트(core `dist`), cli·mcp의 `typecheck`(core의 `.d.ts`)는 **`pnpm build` 뒤에만 된다** | cli `typecheck`는 core `dist`가 없으면 `TS2307`. [확인: scratch `ws`에서 core `dist`를 치우고 실행] |
| C6 | CI 순서(build → test → lint → validate:format)는 C5를 이미 만족한다 | `ci.yml` 읽기 |
| C7 | 오래된 `dist`가 남아 테스트가 옛 코드를 볼 수 있다(tsc는 `dist`를 비우지 않는다) | 로컬 한정. 계획에서 `clean`을 둘지 정한다 |

## 3. 아키텍처 분석과 따를 규칙

### 3.1 F01 골격의 규칙

| 규칙 | 근거 | 새 코드에 |
| --- | --- | --- |
| 모든 패키지 ESM (`"type": "module"`), 상대 import는 `.js` 확장자 | NodeNext | 그대로. Vitest는 `./x.js` → `./x.ts`를 풀어 준다 [확인: scratch `ws`의 Vitest 실행] |
| 라이브러리는 `tsc`로 빌드, `exports`의 `types`·`default` → `dist` | `packages/*/package.json` | `./node`도 같은 모양 |
| core는 `lib ["ES2022"]`, `types []` | core `tsconfig.json` | 기본 진입점에서 `console`, `structuredClone`, `TextEncoder`, `URL`, `setTimeout`도 타입 오류다. 복제·로깅을 직접 해야 한다 [확인: `TS2584`, `TS2304`] |
| 테스트 파일은 빌드에서 뺀다 | `exclude src/**/*.test.ts` | 테스트 도우미를 `*.test.ts`가 아닌 이름으로 두면 `dist`에 들어간다(3.2 끝) |
| Prettier 작은따옴표 | `.prettierrc.json` | 셔뱅이 있는 `bin.ts`도 Prettier가 그대로 둔다 [확인: `prettier --stdin-filepath`] |
| ESLint flat config, JS·TS 권장 + prettier | `eslint.config.js` | `.ts`는 `no-undef`가 꺼져 있다. `.mjs`는 `process`, `console`이 `no-undef`다 [확인: `eslint --stdin`] |
| Node 내장은 `node:` 접두사 | 옛 도구 | 그대로 |

### 3.2 `@erdmaker/core/node` 진입점: 제안하는 배치

**방식**: tsconfig 두 개를 차례로 돌린다(프로젝트 참조와 `composite`는 쓰지 않는다).

```
packages/core/
  package.json
    "exports": {
      ".":      { "types": "./dist/index.d.ts",      "default": "./dist/index.js" },
      "./node": { "types": "./dist/node/index.d.ts", "default": "./dist/node/index.js" }
    }
    "scripts": {
      "build": "tsc && tsc -p tsconfig.node.json",
      "typecheck": "tsc -p tsconfig.test.json",
      "generate:schemas": "node scripts/generate-schemas.ts"
    }
    "dependencies": { "ajv": "^8.20.0", "yaml": "^2.9.1" }
  tsconfig.json        기본 진입점. 지금 것 + "exclude": ["src/**/*.test.ts", "src/node"]
  tsconfig.node.json   { "extends": "./tsconfig.json",
                         "compilerOptions": { "types": ["node"] },
                         "include": ["src/node"], "exclude": ["src/**/*.test.ts"] }
  tsconfig.test.json   { "extends": "./tsconfig.json",
                         "compilerOptions": { "noEmit": true, "types": ["node"] },
                         "include": ["src"], "exclude": [] }
  scripts/generate-schemas.ts
  src/
    index.ts                 공개 이름만 다시 내보낸다
    fs/adapter.ts            FileSystemAdapter, FileNotFoundError
    fs/memory.ts             createMemoryFileSystem
    fs/path.ts               join, normalize (`a/../b`, 앞의 `..` 유지)
    fs/adapter-contract.ts   계약 테스트 묶음 (아래 주의)
    generated/schemas.ts     생성물
    schema/ajv.ts            Ajv 인스턴스 (지연 생성, 모듈 단위 캐시)
    schema/resolve.ts        작성기용 스키마 따라가기 ($ref, items, additionalProperties, oneOf)
    parse/yaml.ts            읽기 + yaml-feature + 키 충돌 + 주석 + 위치 색인
    parse/json.ts            배치 읽기 + 위치
    model/types.ts           Model, Issue, 항목 { file, data }
    model/load.ts            loadModel
    model/serialize.ts       serializeModel (YAML, 배치 JSON)
    model/write.ts           writeModel
    validate/json-value.ts   must be a JSON value
    validate/schema.ts       Ajv 오류 → Issue
    validate/rules.ts        R01~R12
    validate/issues.ts       정렬, 위치 채우기
    project/find.ts          findModels (P02)
    project/validate.ts      validateProject (P01)
    node/index.ts            createNodeFileSystem 다시 내보내기
    node/fs.ts               node:fs/promises 구현
    **/*.test.ts
```

확인한 것 (scratch `ws/packages/core`에서 같은 구성으로 빌드):

- 두 번 컴파일하면 `dist/index.js`가 두 번 써지지만 내용이 같다(`cmp`). `dist`에 테스트 파일이 없다. [확인]
- `tsc --showConfig`는 `lib ["es2022"]`, `types []`를 낸다(AC-11). 지금 저장소에서 `pnpm --filter @erdmaker/core exec tsc --showConfig`도 같은 값이다. [확인]
- 기본 진입점에서 `node:fs`를 가져오면 `TS2591 Cannot find name 'node:fs'`, `process`·`Buffer`도 `TS2591`이다. 기본 진입점 파일이 실수로 `./node/...`를 가져오면 그 파일이 `types []`로 컴파일되어 같은 오류가 난다. 타입 단계에서도 한 번 막힌다. [확인]
- cli에서 `import { … } from '@erdmaker/core/node'`가 `exports`를 거쳐 타입과 실행 모두 풀린다. [확인: scratch `ws/packages/cli` 빌드·실행]
- `@types/node`는 루트 devDeps의 것을 쓴다. 상위 `node_modules/@types`를 찾으므로 core에 따로 넣지 않아도 된다(cli·mcp가 이미 그렇게 쓴다). [확인]

주의:

- **계약 테스트 묶음(FR-02)의 자리.** `*.test.ts`에 두면 Vitest가 테스트가 없는 파일로 실패하고, 다른 이름이면 빌드에 들어간다. 묶음이 `vitest`를 import하면 core `dist`가 `vitest`를 런타임에 요구한다. `test`, `expect`를 인자로 받는 함수로 쓰면 `dist`에 들어가도 해가 없다. 또는 `*.test-util.ts`처럼 이름 규칙을 정해 `tsconfig.json`의 `exclude`에 더한다. 계획에서 정한다. [미확인: 어느 쪽도 실행해 보지 않음]
- `src/node/`의 파일이 기본 진입점 파일을 `../x.js`로 가져오는 것은 된다. 반대 방향은 위처럼 타입 오류가 된다.

### 3.3 공통 관심사

| 관심사 | 방식 |
| --- | --- |
| 파일 접근 | `FileSystemAdapter` 하나. 코어 기본 진입점은 파일 API를 부르지 않는다 |
| 오류 처리 | 형식 위반은 `Issue[]`로 돌려준다. 어댑터의 `FileNotFoundError` 아닌 실패는 그대로 던진다. `serializeModel`은 JSON 값이 아닌 것에 던진다 |
| 로깅 | 코어는 출력하지 않는다(`console`이 타입에 없다). `yaml`의 경고 출력도 `logLevel: 'error'`로 막는다(3.4) |
| 검증 | Ajv 2020 (`allErrors`, `strict: false`, `strictSchema: true`). 한 번 만들어 둔다(스키마 8개 컴파일에 약 85 ms) [확인: `exp8-ajv.mjs`] |
| 캐시 | Ajv 인스턴스만 |
| 인증·권한 | 없음 |

### 3.4 컴포넌트 사이의 계약

| 보내는 쪽 → 받는 쪽 | 계약 |
| --- | --- |
| cli·mcp → core | `validateProject(fs, dir)` → `{ issues, models: [{ dir, issues, counts }] }` |
| core → 어댑터 | `readText`, `writeText`, `list`, `remove` (모두 Promise) |
| F03 → core | `validateModel(model, positions?)`, `serializeModel`, `writeModel` |
| F08·F11 → core | `Issue.path`(JSON Pointer)로 객체를 찾는다 |

## 4. 위험과 확인 결과

### 4.1 YAML (`yaml` 2.9.1)

**권장 옵션**

```ts
// 읽기
parseDocument(text, { version: '1.2', schema: 'core', uniqueKeys: true, lineCounter, logLevel: 'error' })
// 쓰기
stringify(value, { version: '1.2', schema: 'core', lineWidth: 0, compat: 'yaml-1.1', aliasDuplicateObjects: false })
```

| # | 질문 | 결과 |
| --- | --- | --- |
| Y1 | 예제 YAML 27개 왕복 | `lineWidth 0 + compat` 0개 다름. `compat`만 0개(예제에 긴 줄이 없다). `lineWidth`만 1개(`standard.yaml` 4줄의 따옴표). 권장 옵션 전체도 0개. [확인: `exp1-roundtrip.mjs`] |
| Y2 | 규칙대로 쓴 예제 | 스키마 기반 시제품(`writer-proto.mjs`, FR-07 반영)으로 쓰면 다른 파일은 `model.yaml`(`notation`, `dictionaries` 삭제), `customer_places_order.yaml`(두 줄 순서), `customer_type.yaml`(`exclusivity` 삭제) 셋뿐이다. 고친 세 파일을 다시 읽어 쓰면 같다(멱등). [확인: `exp2-canonical.mjs`, 결과 파일은 `corrected/`] |
| Y3 | `lineWidth` | 기본값(80)이면 160자 한 줄이 접힌다. `0`이면 안 접힌다. [확인: `exp5-quoting.mjs`] |
| Y4 | 따옴표 | `compat: 'yaml-1.1'`이면 시험한 문자열 58종(`NO`, `no`, `yes`, `on`, `off`, `y`, `n`, `~`, `null`, `0.1`, `1e3`, `0x1F`, `0o17`, `017`, `0b101`, `1_000`, `1:30`, `2001-12-14`, `.inf`, `<<`, 앞뒤 공백, `true`, `TRUE`, 한글 등)이 1.2 core와 1.1 양쪽에서 같은 문자열로 읽힌다. `compat`이 없으면 `NO`, `y`, `0b101`, `1_000`, `1:30`, `2001-12-14` 등 17종을 1.1이 다르게 읽는다. 키도 같은 규칙으로 따옴표가 붙는다(`"n": null`, `"NO": e`). [확인: `exp5-quoting.mjs`] |
| Y5 | 블록 글 | `"a\nb\n\n"` → `|+`, `"a\nb"` → `|-`, 앞이 공백인 글 → `|2`. 시험한 12종이 모두 1.2와 1.1에서 같게 읽힌다. `"a\r\nb"`는 큰따옴표 `"a\r\nb"`로 써진다. 줄 끝 공백이 있는 글과 빈 첫 줄이 있는 글은 공백만 있는 줄을 만든다(편집기가 지우면 값이 바뀐다). [확인: `exp5-quoting.mjs`] |
| Y6 | 별칭 억제 | 기본값이면 같은 객체 두 번이 `&a1`/`*a1`로 써진다. `aliasDuplicateObjects: false`면 두 번 풀어 쓴다(AC-03 (7)). [확인] |
| Y7 | 빈 값 | `{}` → `e: {}`, `[]` → `a: []`(흐름 표기), `Infinity` → `.inf`, `-0` → `-0`, `1e21` → `1e+21`. `ext: {}`는 남는다. [확인] |
| Y8 | 앵커·별칭 찾기 | AST `visit`의 `Node`에서 `n.anchor`, `Alias` 방문자로 별칭. 풀리지 않는 별칭도 `Alias`로 잡힌다(`toJS` 전에 검사해야 죽지 않는다). [확인: `exp4-features.mjs`] |
| Y9 | 태그 찾기 | AST의 `n.tag`는 풀린 이름이다: `!custom` → `!custom`, `%TAG !e! tag:example.com,2000:app/` + `!e!foo` → `tag:example.com,2000:app/foo`, `!<tag:x>` → `tag:x`, `!` → `!`, `!!str` → `tag:yaml.org,2002:str`. "`tag:yaml.org,2002:`로 시작하지 않으면 거부"는 `n.tag`에 그대로 적용된다. 옛 도구는 `!`로 시작하는 것만 거부하므로 `%TAG`와 verbatim 태그를 놓친다. [확인] |
| Y10 | **`tag:yaml.org,2002:` 안의 비JSON 타입** | core 스키마인데도 `!!binary` → `Uint8Array`(Node에서 `Buffer`), `!!timestamp` → `Date`, `!!set` → `Set`이 된다. Ajv는 `ext` 안의 `Date`·`Uint8Array`를 통과시킨다. JSON 값 검사가 "null, boolean, string, 유한하고 안전한 범위의 number, 배열, 프로토타입이 `Object.prototype`이거나 `null`인 객체"만 받아야 막힌다. 스펙에 이 정의가 없다. 아니면 허용 태그를 core 스키마의 7개(`str`, `int`, `float`, `bool`, `null`, `map`, `seq`)로 좁힌다. [확인: `exp4-features.mjs`, `exp8-ajv.mjs`] |
| Y11 | 태그·앵커·별칭의 위치 | AST 노드의 `range[0]`은 값의 시작이라 태그 위치가 아니다(`a: !custom 1`에서 4열이 아닌 12열). CST(`new Parser(lineCounter.addNewLine).parse(text)`)를 훑으면 `tag`, `anchor`, `alias`, `comment`, `directive` 토큰마다 `offset`이 있고, `lineCounter.linePos(offset)`이 1부터 센 `{ line, col }`을 준다. CST의 태그 원문은 `doc.directives.tagName(source, onError)`로 풀린다(`!e!foo` → `tag:example.com,2000:foo`). [확인: `exp6-positions.mjs`, 위 실험] |
| Y12 | 중복 키 | `uniqueKeys: true`(기본값)로 `DUPLICATE_KEY` 오류. `linePos[0]`이 뒤 키의 위치, 메시지 첫 줄은 `Map keys must be unique at line 3, column 1:`이고 메시지 전체는 코드 프레임까지 6줄이다. `1`과 `1.0`도 값이 같아 중복으로 잡힌다. [확인] |
| Y13 | 변환 뒤 충돌하는 키 | `true`/`"true"`, `~`/`""`, `1`/`"1"`은 `parseDocument`가 잡지 않고 `toJS`가 뒤 값으로 덮는다. 직접 찾아야 한다: 맵의 각 쌍에서 키가 스칼라면 `value === null ? '' : String(value)`(yaml의 `toJS` 키 변환과 같다)로 비교하고 뒤 키의 `range[0]`을 위치로 쓴다. [확인] |
| Y14 | 컬렉션 키 (`? [a, b]`) | `toJS`가 키를 `"[ a, b ]"` 글로 바꾸고 **Node에서는 `process.emitWarning`으로 stderr에 경고를 찍는다.** `logLevel: 'error'`로 막힌다. 이것을 `syntax`로 볼지 스키마 오류(모르는 키)로 둘지 스펙에 없다. [확인] |
| Y15 | 주석 | AST에는 `doc.commentBefore`, `doc.comment`, `node.commentBefore`, `node.comment`로 흩어져 있고 위치가 없다. CST를 훑어 `type === 'comment'`인 첫 토큰의 `offset`을 쓰면 된다. 시험한 9가지(맨 위, 줄 끝, 사이, 문서 끝, 목록 안, 블록 글 머리 `|  # c`, 흐름 안, 중첩 맵 뒤)가 모두 잡히고, 따옴표 안의 `#`와 `x#y`는 주석이 아니다. 예제에는 주석이 없다. [확인: `exp6-positions.mjs`] |
| Y16 | JSON Pointer → 위치 | `YAMLMap`의 쌍마다 `path + '/' + escape(key)` → `pair.key.range[0]`, `YAMLSeq`의 항목마다 `path + '/' + i` → `item.range[0]`. `/attributes/2` → 24:5, `/attributes/2/migratedFrom/0/attribute` → 32:9 등 손으로 센 값과 같다. [확인: `exp6-positions.mjs`] |
| Y17 | `%YAML 1.1` 지시자 | `schema: 'core'`를 주면 지시자가 있어도 `NO`가 문자열로 남는다. [확인] |
| Y18 | 그 밖 | 문서 두 개(`---`)는 `MULTIPLE_DOCS` 오류, 빈 파일과 주석만 있는 파일은 `null`(스키마 오류 `/ must be object`가 된다), BOM은 받아들인다, CRLF 블록 글은 `\n`으로 읽힌다. [확인] |
| Y19 | `.inf`, `.nan`, 큰 정수 | `Infinity`, `NaN`, `9007199254740993` → `9007199254740992`로 읽힌다. `!Number.isSafeInteger(v) && Number.isInteger(v)`로 큰 정수를 잡을 수 있다. 단 `1e300`처럼 소수 표기로 적은 큰 수도 JS에서는 정수라 같은 규칙에 걸린다. 스펙이 이것을 "정수"로 볼지 정하지 않았다. [확인] |

### 4.2 배치 JSON

**예제 파일의 정확한 모양** (`sales.json`):

```
{                                         최상위: 키마다 한 줄, 2칸
  "formatVersion": "0.1",                 키 순서: formatVersion, subjectArea, display, nodes, edges, ext (스키마 순서)
  "subjectArea": "sales",
  "display": {                            객체는 펼친다 (4칸)
    "level": "attribute",
    "names": "logical"
  },
  "nodes": {                              노드 ID는 글자 비교로 정렬
    "address": { "x": 40, "y": 320 },     노드 값 하나는 한 줄: "{ " + `"k": v`를 ", "로 이음 + " }"
    "order": { "x": 380, "y": 40, "width": 240 },    값의 키: x, y, width, height, color
    "product": { "x": 720, "y": 320, "color": "#eef3ff" }
  },
  "edges": {                              엣지 ID 정렬, 값은 펼친다 (6칸)
    "order_bills_to": {
      "parentSide": "right",              parentSide, childSide, waypoints
      "childSide": "bottom",
      "waypoints": [{ "x": 520, "y": 380 }]     배열은 "[" + 한 줄 객체들을 ", "로 + "]"
    }
  }
}                                         끝에 LF 하나
```

- 이 규칙의 직렬화기(`layout-proto.mjs`, 약 25줄 + 작성기의 스키마 순서 재사용)가 두 파일을 바이트 그대로 낸다. 키를 뒤집고 4칸 들여쓰기에 CRLF로 바꾼 사본도 원래 바이트로 돌아온다(AC-02의 배치 부분). [확인: `exp3-layout.mjs`]
- `JSON.stringify(v, null, 2) + '\n'`은 두 파일 모두 다르다. [확인]
- **숫자뿐인 ID**: `JSON.parse` 뒤 `Object.keys`가 `['2', '9', '10']`이다. 정렬한 새 객체를 만들어도 엔진이 다시 정수 순으로 돌리므로, 키 목록을 따로 정렬해 글을 직접 찍어야 `10, 2, 9`가 된다(AC-03 (6)). 시제품은 이렇게 해서 맞았다. [확인]
- 스펙이 정하지 않은 모양: 빈 `nodes`(`{}`로 쓸지), 키가 하나도 없는 엣지 값(`"e": {}`를 남길지, "빈 객체가 된 선택 키는 쓰지 않는다"를 맵의 값에도 적용할지), 빈 `waypoints`(`[]`), 배치의 `ext`(펼쳐 쓰는 것으로 가정). 계획에서 정하고 테스트에 적는다.
- `__proto__`라는 키가 `ext`에 있으면 `out[k] = v`로 만드는 객체에서 프로토타입이 바뀐다. 작성기는 `Object.defineProperty`나 키·값 목록으로 다뤄야 한다. `JSON.parse`와 `yaml`의 `toJS`는 자기 속성으로 만든다. [확인: `exp7-json.mjs`]

**JSON 읽기와 위치** (`exp7-json.mjs`):

| 입력 | `JSON.parse` 메시지 | `yaml`로 읽은 결과 |
| --- | --- | --- |
| AC-07 (`{"formatVersion": "0.1", "nodes": {` + LF) | `Expected property name or '}' in JSON at position 36 (line 2 column 1)` → **2:1** | `BAD_INDENT`@2:1 |
| AC-07 (한 줄에 `nodes` 둘) | 성공 (뒤 값으로 덮음) | `DUPLICATE_KEY`@1:39 = 둘째 `"nodes"`의 열 |
| 끝 쉼표 | `... (line 3 column 1)` | 오류 없음 |
| 값 빠짐 `"a": }`, 잘린 토큰 `tru` | 위치 없음 (`Unexpected token ...`) | **오류 없음** → 1:1 |
| 빈 파일 | `Unexpected end of JSON input` (위치 없음) | 오류 없음 → 1:1 |
| BOM으로 시작 | 실패 (위치 없음) | 받아들임 → 1:1 |
| 탭 들여쓰기, CRLF, 1100자 키, `\/`·`\u` 이스케이프 | 성공 | 성공, 값이 `JSON.parse`와 같다 |

- 위치 규칙(엔진 → YAML → 1:1)은 구현할 수 있다. 엔진 메시지에서 `(line N column M)`을 정규식으로 뽑는다. 스펙 8장은 "끝 쉼표 등"만 적었지만 값 빠짐, 잘린 토큰, BOM도 1:1이 된다. [확인]
- 유효한 JSON의 위치 색인과 중복 키는 YAML로 읽어 구한다. 예제 배치 두 개에서 YAML이 오류 없이 같은 값을 낸다. `/nodes/order/width` → 11:35. [확인]

### 4.3 Ajv 8.20.0 (draft 2020-12)

| # | 질문 | 결과 |
| --- | --- | --- |
| A1 | 가져오기 | `ajv`에는 `exports`가 없어 `ajv/dist/2020.js` 경로를 쓸 수 있다. **TS(NodeNext)에서 기본 내보내기는 `new` 할 수 없고(`TS2351`) `import { Ajv2020 } from 'ajv/dist/2020.js'`는 된다.** Node ESM에서 둘은 같은 함수다. Vite 번들에서도 이름 있는 내보내기가 된다. [확인] |
| A2 | 스키마 8개, 파일 간 `$ref` | 생성 모듈의 객체를 `addSchema`로 넣고 `getSchema('urn:erdmaker:format:0.1:entity')`로 꺼낸다. `urn:…common#/$defs/id` 등 다른 파일 참조와 `#/$defs/attribute`가 풀린다. 컴파일은 처음 `getSchema`할 때 하며 7개 합쳐 약 85 ms. [확인: `exp8-ajv.mjs`] |
| A3 | 옵션 | `strict: false`와 `strictSchema: true`를 함께 주면 `strictSchema`만 true이고 `strictTypes`, `strictTuples`, `strictRequired`는 false다. [확인: `ajv.opts`] |
| A4 | 오류 → JSON Pointer | `instancePath`가 이미 RFC 6901이다(`a/b~c` → `/nodes/a~1b~0c`). `additionalProperties` 오류는 부모를 가리키므로 `params.additionalProperty`를 이스케이프해 붙인다. `propertyNames` 오류도 부모(`/nodes`)를 가리키고 `params.propertyName`이 있으며, 같은 자리에 `pattern` 오류가 하나 더 나온다. 메시지 `<instancePath 또는 "/"> <message>`는 옛 도구와 같은 문자열이다(`/ must have required property 'attributes'`). [확인] |
| A5 | `oneOf` 오류 | `default: { expr: 'x' }` 하나에 오류 4개(type, required, additionalProperties, oneOf). 옛 도구와 같은 Ajv라 대조에서 문제가 없다. [확인] |
| A6 | 비JSON 값 | `Infinity`·`2 ** 53`이 `type: integer`(배치 `x`)와 `defaultValue` 리터럴을 통과한다. `NaN`, `Date`, `Uint8Array`는 `ext` 안에서 통과한다. `undefined` 값(`definition: undefined`)도 통과한다. [확인] → JSON 값 검사가 따로 필요하고, `undefined`는 없는 것으로 볼지 오류로 볼지 정해야 한다 |
| A7 | Node 내장 | 본체에 Node 내장 모듈 `require`가 없다. `require-from-string`(내부에서 `module`, `path`를 씀)은 `dist/standalone/instance.js`만 쓴다. `process`, `Buffer`, `globalThis` 참조도 없다. [확인: `grep`] |
| A8 | `new Function` | `dist/compile/index.js` 89행 `new Function(self, scope, sourceCode)`. 검사 함수를 처음 컴파일할 때 부른다. 번들에도 한 번 들어 있다. `unsafe-eval`이 없는 CSP에서는 첫 `validate` 때 실패한다(F09). [확인: `grep`, `exp9-vitecheck.mjs`] |
| A9 | `$id` | `fast-uri`는 nid가 없는 URN(`urn:x`)을 거부한다(`URN without nid cannot be serialized`). 지금의 `urn:erdmaker:format:0.1:*`는 된다. 나중에 `$id`를 바꿀 때 주의. [확인: scratch 실험 중 우연히] |
| A10 | 순환 데이터 | 메모리 모델에 순환 참조가 있으면 JSON 값 검사가 무한 재귀할 수 있다. 공유 참조(AC-03 (7))는 정상 값이므로 전역 방문 집합이 아니라 "지금 경로 위의 객체" 집합으로 순환만 잡아야 한다. [미확인: 코드 추론] |

### 4.4 스키마에서 키 순서와 기본값 읽기

8개 스키마의 키워드 분포 (`$defs` 안까지, 실행으로 셈):

| 키워드 | 자리 | 작성기 |
| --- | --- | --- |
| `$ref` (58) | `common#/$defs/id` 31, `ext` 12, `scope` 5(엔터티, 속성, 키, 관계, 서브타입), `dataType` 2(도메인 `type`, 속성 `type`), `physicalTypes` 2, `validValues` 2, `dbms` 2(하나는 common 안의 `#/$defs/dbms`), 같은 파일 `#/$defs/attribute`, `#/$defs/key` | 따라간다. 같은 파일 참조는 **지금 보는 문서** 기준으로 풀어야 한다(common 안의 `#/$defs/dbms`) |
| `oneOf` (1) | `common#/$defs/defaultValue` | 값이 객체면 `properties` 있는 갈래 (`expression`) |
| `allOf` (1) | `relationship#` 최상위 (`if/then/else` 둘) | 보지 않는다 |
| `if/then/else` (3) | `relationship.cardinality`, `allOf/0`, `allOf/1` | 보지 않는다 |
| `not` (2), `dependentRequired` (1) | 속성(`domain`+`type` 금지, `rolenamed`→`migratedFrom`), `cardinality.else` | 보지 않는다 |
| `additionalProperties`가 스키마 (3) | `common#/$defs/physicalTypes`, `layout.nodes`, `layout.edges` | 맵의 값 스키마. 나머지 31곳은 `false` |
| `propertyNames` (3) | 같은 세 곳 | 작성기는 쓰지 않는다 |
| `default` 키워드 (11) | common `scope`=`both`, 단어 `classifier`=false, 속성 `nullable`=true, `rolenamed`=false, 모델 `notation`=`ie`, 스키마 `role`=`main`, `dictionaries`=`["dictionary"]`, 카디널리티 `parent`=`one`, `child`=`zero-or-more`, 서브타입 `completeness`=`incomplete`, `exclusivity`=`exclusive` | `$ref` 대상의 기본값은 `scope` 하나뿐이다. `dictionaries`는 배열이라 깊은 비교가 필요하다 |
| `const` (6) | `formatVersion` 2곳, `if`·`then` 안 4곳 | 기본값이 아니다. `formatVersion`은 늘 쓴다 |

- **함정**: 속성 `default`와 도메인 `default`는 *키 이름이 `default`인 속성*이다(`properties.default = { $ref: defaultValue }`). 키워드를 훑는 코드가 `properties` 아래를 일반 객체처럼 다루면 이것을 기본값으로 착각한다. 실제로 키워드 집계 스크립트를 처음 짤 때 13개로 잘못 셌다. `properties`의 값은 "키 → 스키마" 맵으로 다뤄야 한다. [확인]
- `$ref` 옆의 형제 키워드(`description`)는 2020-12에서 유효하고 작성기에 영향이 없다. 키 자리에 `default`와 `$ref`가 함께 있는 곳은 지금 없다.
- FR-07을 하지 않으면 속성의 `scope: both`가 기본값으로 지워진다. 엔터티가 `logical`이면 뜻이 바뀐다. [확인: 시제품에 `scope: both` 속성을 넣어 실행]
- 스키마에 없는 키(검증 전 모델)를 작성기가 어떻게 할지 스펙에 없다. 시제품은 뒤에 붙였다.
- `entities` 정렬은 스키마가 아니라 코드가 안다(스키마에는 설명 "sorted"뿐). 스펙이 "목록 하나"로 정했으므로 코드에 하나를 적는다.

### 4.5 스키마 생성 모듈

- **자리**: `packages/core/scripts/generate-schemas.ts`. `node scripts/generate-schemas.ts`로 돈다(Node 22.23의 타입 제거가 기본으로 켜져 있고 경고도 없다). [확인: `gen/generate-schemas.ts` 실행]
- **`tools/`에 두지 않는 이유**: FR-13 2단계가 `eslint.config.js`의 `tools/**` 블록을 지운다. `.mjs`로 쓰면 그 블록 없이 `process`, `console`이 `no-undef`다. `.ts`는 `typescript-eslint`가 `no-undef`를 꺼 두어 설정 없이 통과한다. [확인: `eslint --stdin`으로 `packages/core/scripts/gen.mjs`는 오류 2개, `gen.ts`는 0개]
- 생성 스크립트는 어느 tsconfig에도 들지 않아 타입 검사를 받지 않는다. 받게 하려면 `tsconfig.test.json`에 `scripts`를 넣고 `rootDir`을 바꿔야 한다. [미확인]
- **모양**: 파일 이름 → 스키마 객체의 맵 하나를 `JSON.stringify(…, null, 2)`로 박는다. 타입은 `Readonly<Record<string, unknown>>`처럼 넓게 둔다(`as const`는 큰 리터럴 타입을 만든다). 생성물 29 KB가 `tsc`를 통과한다. JSON 리터럴을 TS 객체 리터럴로 쓰면 `__proto__` 키의 뜻이 달라지지만 스키마에는 없다. [확인]
- **동기화 테스트(AC-12)**: core 테스트가 `node:fs`로 `format/v0/schema`를 읽어 생성 모듈과 `JSON.stringify` 비교. 생성 모듈을 데이터 URL로 불러 비교해 보니 같다. 테스트는 빌드에서 빠지므로 "코어가 실행 중에 파일을 읽지 않는다"와 부딪치지 않는다. [확인]
- 생성물을 자동으로 다시 만드는 단계는 없다. 스키마를 고치고 `pnpm --filter @erdmaker/core generate:schemas`를 잊으면 AC-12가 실패해 알려 준다.

### 4.6 브라우저 안전성 테스트 (AC-10)

`bundle/bundle.test.js`에서 스펙 6.1을 그대로 해 봤다. 테스트 3개 통과, 0.55초. [확인]

```js
import { build } from 'vite';
import { builtinModules } from 'node:module';
const blockNode = () => ({
  name: 'block-node-builtins', enforce: 'pre',
  resolveId(id) {
    if (id.startsWith('node:') || builtinModules.includes(id) || builtinModules.includes(id.split('/')[0]))
      this.error(`Node built-in imported: ${id}`);
    return null;
  },
});
const out = await build({
  configFile: false, logLevel: 'silent', root,
  plugins: [blockNode()],
  build: { write: false, minify: false, lib: { entry, formats: ['iife'], name: 'erdcore', fileName: 'core' } },
});
const code = (Array.isArray(out) ? out[0] : out).output.find((c) => c.type === 'chunk').code;
const ctx = vm.createContext({ console });
vm.runInContext(code, ctx);   // ctx.erdcore 에 내보내기가 붙는다
```

- `ajv`(이름 있는 내보내기) + `yaml` + 스키마 8개를 묶은 IIFE(약 490 KB, 축소 안 함)가 `console`만 있는 컨텍스트에서 Ajv 컴파일, YAML 읽기, 엔터티 10개 검사까지 오류 없이 돈다. 그 컨텍스트에서 `process`, `require`, `Buffer`, `window`, `self`는 모두 `undefined`다. 실행 뒤 컨텍스트의 자기 키는 `console`, `erdcore`, 넣어 준 `files`뿐이다. `console` 밖의 전역은 필요 없었다. [확인]
- `node:fs`를 가져오는 진입점은 플러그인 오류로, `path`(접두사 없는 내장)도 같은 오류로 빌드가 실패한다. [확인]
- **플러그인이 없으면 `node:fs` 진입점이 성공한다**(Vite가 빈 모듈로 바꾼다). 이 테스트의 효력은 플러그인에서 온다. [확인: `exp9-vitecheck.mjs`]
- Vite는 `yaml`의 브라우저 빌드(`exports.default`)를 골랐다. 번들에 `emitWarning`이 없다. **`yaml`의 Node 빌드는 `require('process')`를 한다**(`dist/log.js`, `parse/parser.js`, `compose/composer.js`). 조건이 바뀌어 Node 빌드가 들어오면 플러그인이 `process`를 잡아 실패한다. 이 실패는 올바른 동작이다. [확인: `grep`]
- `vm` 안의 Promise를 밖에서 `await`할 수 있다. 결과는 다른 realm의 객체이므로 `toEqual`보다 `JSON.stringify`로 꺼내 비교하는 것이 안전하다. 시험에서는 컨텍스트 안에서 `JSON.stringify`했다. [확인]
- `vitest --root <dir>`로 돌리면 Vitest가 `<dir>/node_modules/.vite/vitest/`에 결과 캐시를 쓴다. 저장소 루트에서 돌리면 루트 `node_modules/.vite`에 쓰므로 문제가 없다. 실제 테스트에서는 `root`를 core 패키지로 주고 `publicDir: false`도 주기를 권한다(`write: false`라 아무것도 쓰지 않았지만 public 복사를 확실히 끈다). [확인 / `publicDir`은 미확인]
- 대상은 `packages/core/dist/index.js`이므로 이 테스트는 `pnpm build` 뒤에만 의미가 있다(C5).

### 4.7 테스트 파일 타입 검사 (FR-12, AC-15)

- **가장 단순한 구성**: 패키지마다 `tsconfig.test.json` = `extends ./tsconfig.json` + `noEmit: true` + `types: ["node"]` + `include: ["src"]` + `exclude: []`, 스크립트 `typecheck: tsc -p tsconfig.test.json`. 루트 `lint`: `eslint . && prettier --check . && pnpm -r typecheck`.
- scratch 워크스페이스(core, cli, `typecheck` 없는 web)에서 pnpm 10.34.9로 확인했다. [확인]
  - 탐침이 있으면 `Scope: 3 of 4 workspace projects`(web은 건너뜀), `packages/core typecheck: src/zz-probe.test.ts(1,14): error TS2322: ...`, 종료 1. 스펙 6.3의 `grep -q "zz-probe.test.ts.*TS2322"`에 걸린다.
  - 탐침을 지우면 종료 0.
  - 탐침이 있어도 `tsc`(빌드)는 성공하고 `dist`에 탐침이 없다.
- 탐침 `export const n: number = 'x';`는 저장소의 ESLint와 Prettier를 통과한다(Prettier가 바꾸지 않는다). 실패는 타입 검사에서만 난다. [확인: `--stdin`]
- core 테스트는 `vitest`와 `node:*`를 함께 가져와도 `types ["node"]`로 통과한다. [확인]
- mcp의 `src/index.ts`는 빈 파일이지만 있으므로 `TS18003 No inputs`는 나지 않는다. [미확인: 추론]
- cli·mcp의 `typecheck`는 core의 `dist/*.d.ts`가 있어야 한다(C5). [확인]

### 4.8 CLI 패키징

| 항목 | 결과 |
| --- | --- |
| 셔뱅 | `src/bin.ts` 첫 줄 `#!/usr/bin/env node`가 `dist/bin.js` 첫 줄에 그대로 나온다 [확인: scratch tsc] |
| 실행 비트 | tsc 출력은 `-rw-r--r--`. `node packages/cli/dist/bin.js`로 부르므로 상관없다 [확인] |
| 최상위 `await` | `process.exitCode = await main(process.argv.slice(2));`가 NodeNext + ES2022에서 된다 [확인] |
| 종료 코드 | 인자 없음 → 2, 정상 → 0을 자식 프로세스(`execFile(process.execPath, [bin])`)로 확인 [확인: scratch Vitest] |
| `bin` 문자열 | 6.2 스크립트가 `packages/cli/` + `bin.erdmaker`로 경로를 만들고 `validate:format`과 문자열로 비교하므로 정확히 `"dist/bin.js"`여야 한다 [확인: 스크립트 읽기] |
| `pnpm exec erdmaker` | 루트 `package.json`이 `@erdmaker/cli`에 의존하지 않고 루트 `node_modules/.bin`에 `erdmaker`가 없다. 지금 구성으로는 안 된다. `pnpm --filter @erdmaker/cli exec erdmaker`도 자기 bin은 링크되지 않는다 [파일은 확인, pnpm 동작은 미확인: 설치를 하지 않음] |
| `npm run` / `pnpm --silent` | 스크립트가 `node <경로>`만 부르므로 둘 다 된다. F01에서 같은 방식으로 확인됨 [이번에는 미확인] |
| `docs`에서 종료 2 | `docs/` 아래 깊이 3까지 `model.yaml`이 없다 [확인: 파일 목록] |

### 4.9 대조 테스트 (FR-13 1단계)

- **방법**: 사례마다 `mkdtemp`로 임시 폴더를 만들고 예제 29개 + 치환을 쓴다 → `execFile(process.execPath, [repoRoot + '/tools/validate-format.mjs', dir])` → 종료 코드와 stderr를 받는다 → 새 검증기를 같은 폴더(`createNodeFileSystem`)나 같은 내용(메모리 어댑터)에 돌린다 → `<file>: <message>` 줄의 다중집합을 비교한다.
- 옛 도구는 사례 하나에 약 0.2초다. 부록 A 사례만 50개 안팎이므로 순서대로 돌리면 10초가 넘는다. Vitest 기본 타임아웃(5초)을 넘지 않게 사례마다 `test`를 나누거나 병렬로 돌린다. [시간은 확인, 사례 수는 추정]
- **옛 출력 해석의 함정**: YAML 문법 오류 메시지는 여러 줄이고 코드 프레임 안에 `id: tag2`, `name: x` 같은 줄이 그대로 나온다. `^(.+?): (.*)$`로 자르면 이 줄을 "파일 `id`의 오류"로 오인한다. 파일 부분이 `.yaml`이나 `.json`으로 끝나는 줄만 오류의 시작으로 보고, 나머지는 앞 오류의 이어진 줄로 버려야 한다(첫 줄만 비교한다는 스펙과 맞는다). 끝의 빈 줄과 `<n> error(s)` 줄도 뺀다. [확인: `par/dup` 출력]
- 옛 도구는 YAML 문법 오류 파일을 모델에서 빼므로 연쇄 오류(`unknown entity "tag"` 등 8개)가 나온다. 새 검증기도 같은 연쇄를 내야 대조가 맞는다. 좋은 대조 사례다. [확인]
- 모델 밖 사전 사례는 프로젝트 모양 폴더(`proj/dictionary`, `proj/m`)를 만들고 옛 도구를 `proj/m`에 돌린다. 오류 줄의 파일은 `../dictionary/standard.yaml`이다. 새 검증기도 연 폴더를 `proj/m`으로 해야 `file`이 같다. [확인]
- 대조에서 빼는 사례(스펙 FR-13)에 더해, 옛 도구가 죽는 사례(깨진 배치, 풀리지 않는 별칭)는 종료 코드가 1이지만 오류 줄이 없다. 이 사례들이 빠졌는지 확인하는 단언을 따로 두면 좋다.

## 5. 스펙과 설치된 도구가 맞지 않거나 스펙이 정하지 않은 것

| # | 내용 | 제안 |
| --- | --- | --- |
| S1 | `tag:yaml.org,2002:` 태그를 모두 허용하면 `!!binary`/`!!timestamp`/`!!set`이 비JSON 값을 만든다 (Y10) | JSON 값의 정의를 스펙 FR-05에 적거나 허용 태그를 core 스키마 7개로 좁힌다 |
| S2 | 컬렉션 맵 키(`? [a, b]`)의 처리가 없다 (Y14) | `syntax`로 하거나 "스키마가 잡는다"고 적는다. 어느 쪽이든 `logLevel: 'error'` |
| S3 | `1e300` 같은 소수 표기 큰 수가 "안전 범위를 넘는 정수"인지 (Y19) | `Number.isInteger && !isSafeInteger`로 일괄 처리하고 문서화 |
| S4 | 배치의 빈 `nodes`, 빈 엣지 값, 빈 `waypoints`, `ext`의 모양 (4.2) | 계획에서 정하고 AC-03에 단언 추가 |
| S5 | `undefined` 값(메모리 모델)을 JSON 값 검사에서 어떻게 볼지 (A6) | "없는 키와 같다"로 하고 작성기도 건너뛴다 |
| S6 | 메모리 모델의 순환 참조 (A10) | `must be a JSON value`로 보고하고 Ajv를 부르지 않는다 |
| S7 | `syntax` 오류 메시지 첫 줄에 이미 `at line N, column M:`이 들어 있다. CLI 줄은 `f:27:1: Map keys must be unique at line 27, column 1: [syntax]`가 된다 | 옛 문구 고정을 위해 그대로 둔다(정보 중복일 뿐) |
| S8 | `Issue` 정렬 기준(`file`, `line`, `column`, `rule`)에서 줄·열이 없는 `Issue`(메모리 모델)의 자리 | "줄·열이 없는 것이 뒤" 등으로 정한다 |
| S9 | 계약 테스트 묶음의 자리 (3.2) | 계획에서 정한다 |
| S10 | 6.2 스크립트가 `bin` 문자열 형태에 묶여 있다 | `"dist/bin.js"`로 쓴다 |
| S11 | Node 어댑터에서 `ENOTDIR`(경로 중간이 파일)을 "없음"으로 볼지 | `ENOENT`만 `FileNotFoundError`로 하는 것이 스펙 문구에 가깝다. 계약 테스트에 적는다 |
| S12 | 스펙 2장과 7장의 "Vite 8 라이브러리 모드 IIFE + vm은 해 보지 않았다" | 이 분석에서 됐다(4.6). 추가 전역은 필요 없었다 |

설치된 도구로 스펙에 적힌 대로 할 수 없는 것은 찾지 못했다. Ajv 기본 내보내기(A1)는 스펙 7장이 이미 대안을 적었다.

## 6. 기술 부채

| 자리 | 문제 | 권장 | 우선 |
| --- | --- | --- | --- |
| `tools/validate-format.mjs` 47행 | `return err(...)`가 숫자를 돌려준다 | 이식할 때 고치고(FR-09) 옛 파일은 지운다 | 높음 (이 기능) |
| 옛 도구 62행 | `!`로 시작하는 태그만 거부 | 새 규칙(Y9) | 높음 |
| 옛 도구 208행 `typeKey` | `JSON.stringify`라 `type`의 키 순서에 민감 | 부록 A 18 | 높음 |
| 패키지 빌드 | `dist`를 비우지 않는다 | 필요하면 `clean` 스크립트 | 낮음 |
| `docs/stage1-backlog.md` 92행 | 옛 도구 언급 | FR-14 범위 밖. 결정 필요 | 낮음 |

## 7. 권장 접근

1. 패키지 틀: core의 tsconfig 셋, `exports`, 의존성, lockfile. cli·mcp의 `typecheck`. 루트 `lint`. 탐침으로 AC-15 확인.
2. 경로 함수, 어댑터 두 개, 계약 테스트(AC-09).
3. FR-07 스키마 수정 → 생성 스크립트 → `schemas.ts` → 동기화 테스트(AC-12).
4. YAML·JSON 읽기 계층(4.1, 4.2의 옵션과 CST 위치), `loadModel`, 위치 색인.
5. 스키마 검사, JSON 값 검사, 규칙 R01~R12, 정렬(AC-05, AC-06, AC-07).
6. 작성기(YAML 옵션 고정, 배치 직렬화기), 예제 정규화(AC-01~04).
7. `findModels`, `validateProject`(AC-08), CLI(AC-13), 번들 테스트(AC-10).
8. 대조 테스트 커밋 → CI 확인(AC-16) → 2단계 삭제 커밋 → 문서(AC-14, FR-14).

피할 것: `JSON.stringify(v, null, 2)`로 배치 쓰기, 정렬한 새 객체로 키 순서 만들기(숫자 ID), `import Ajv2020 from …`(기본 내보내기), Vite 차단 플러그인 없이 번들 테스트, 코어 안에서 `structuredClone`·`console`, `properties` 아래를 키워드로 훑는 스키마 탐색.

## 8. 꼭 읽을 파일 (yyy-plan 전에)

| 파일 | 이유 | 우선 |
| --- | --- | --- |
| `docs/specs/core-model-io.md` | 요구사항, 수용 기준, 부록 A | 필수 |
| `tools/validate-format.mjs` | 규칙과 문구의 원본, 대조 기준 | 필수 |
| `format/v0/schema/*.schema.json` | 작성기와 Ajv의 근거 (4.4) | 필수 |
| `format/v0/examples/shop/layouts/*.json` | 배치 모양 (4.2) | 필수 |
| `packages/core/{package.json,tsconfig.json}` | 바꿀 틀 | 필수 |
| `package.json`, `eslint.config.js`, `.prettierignore`, `.github/workflows/ci.yml` | 스크립트와 순서 제약 | 필수 |
| `docs/format-v0.md` 109~134행 | 고칠 문서 | 권장 |
| scratch `writer-proto.mjs`, `layout-proto.mjs`, `bundle/bundle.test.js` | 확인된 시제품 | 권장 |

## 9. yyy-plan에 넘길 것

- 단계 순서는 7장. 커밋 경계는 2.4의 C1·C2를 지킨다.
- 결정할 것: S1~S6, S8, S9, S11, 계약 테스트 묶음의 자리, `docs/stage1-backlog.md`를 고칠지.
- 실행 확인이 남은 것: pnpm의 bin 링크 동작(4.8), 루트 `ajv`·`yaml` 제거 뒤 옛 도구가 실패하는 것(C1), 생성 스크립트의 타입 검사(4.5), Vite `publicDir: false`(4.6).
- 이 분석은 저장소 파일을 바꾸지 않았다(이 보고서 제외). `spikes/`도 건드리지 않았다.

Design Recommendation: architecture (core의 공개 API, 패키지 진입점 둘, 어댑터 계약, 오류 객체를 정하는 기능이고 F03·F08·F09·F11이 그 위에 선다. 화면은 없다)
Layer Detection: [core-library (packages/core: 어댑터, 파서, 모델, 작성기, 검증), cli (packages/cli: bin, validate 명령), build-tooling (tsconfig 셋, package.json exports·scripts, eslint·prettier, lockfile, CI), format-spec (format/v0 스키마·예제, docs/format-v0.md, CLAUDE.md, docs/planning.md)]
