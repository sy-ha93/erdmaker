# F01 `repo-scaffold` 분석 보고서

**분석일**: 2026-11-27
**대상**: pnpm 워크스페이스, 빈 패키지 4개, TypeScript·Vitest·ESLint·Prettier, GitHub Actions CI (브랜치 `feature/repo-scaffold`)
**스펙**: [docs/specs/repo-scaffold.md](../specs/repo-scaffold.md) FR-01~FR-10, AC-01~AC-13

표기: **[확인]** 이 세션에서 레지스트리 조회, 명령 실행, 파일 읽기로 확인함. **[문서]** 공식 문서(검색 결과)로 확인함. **[미확인]** 확인하지 못함. 구현 중에 실행해서 확인해야 한다.

## 0. 요약

1. **typescript 최신판(7.0.2)은 쓸 수 없다.** `typescript-eslint@8.74.0`의 peer 범위가 `typescript >=4.8.4 <6.1.0`이다. `typescript@~6.0.3`으로 고정해야 한다. [확인]
2. **Vite 8은 esbuild에 의존하지 않는다.** 직접 의존성은 `rolldown`, `lightningcss`, `postcss`, `picomatch`, `tinyglobby`이고 esbuild는 선택적 peer다. 스펙 7장의 "esbuild를 `onlyBuiltDependencies`에 허용" 가정은 맞지 않는다. Linux에서 설치 스크립트를 가진 패키지는 직접 의존성과 그 바로 아래 단계에서 찾지 못했다. [확인, 전이 트리 전체는 미확인]
3. **`tools/validate-format.mjs`는 지금 상태로 `prettier --check`를 통과하지 못한다.** `singleQuote: true`로 printWidth를 80~180까지 바꿔 봐도 모두 차이가 난다(최소 22줄). 서식만 바꾸는 재작성이 필요하다. [확인]
4. **ESLint 권장 규칙의 `no-undef`가 `process`, `console`을 잡을 가능성이 크다.** flat config는 Node 전역을 기본으로 넣지 않는다. [코드 읽기 + 문서 기반 추론, 실행은 미확인]
5. **`README.md`도 Prettier 기본 서식과 다르다**(제목 뒤 빈 줄 없음). 루트에서 `prettier --check .`를 돌리면 실패한다. [확인]
6. `engines.node`의 닫힌 범위는 **`^22.13.0`**이다(ESLint 10과 `@eslint/js` 10의 `^22.13.0`이 가장 높은 하한). 로컬 v22.23.3은 이 범위에 든다. [확인, 전이 의존성은 미확인]

## 1. 관련 코드 탐색 결과

기능 코드가 없다. 추적 대상 코드는 `tools/validate-format.mjs` 하나다.

### 기존 파일

| 파일                        | 내용                                                                                                              | 참조 이유                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `package.json`              | `name: erdmaker`, `private`, `"type": "module"`, 스크립트 `validate:format`, devDeps `ajv ^8.17.1`, `yaml ^2.6.0` | 고칠 대상. ESM 규칙의 근거                 |
| `package-lock.json`         | lockfileVersion 3, 추적 중(`git ls-files` 확인). ajv 8.20.0, yaml 2.9.1 고정                                      | 삭제 대상(FR-01)                           |
| `.gitignore`                | `node_modules/`, `docs/handoff/`, `docs/reference/`                                                               | `dist/`, `*.tsbuildinfo`, `coverage/` 추가 |
| `CLAUDE.md`                 | "지금 상태", "명령" 절이 npm 기준                                                                                 | FR-10 갱신 대상                            |
| `tools/validate-format.mjs` | 211줄 ESM 스크립트. `ajv/dist/2020.js`, `yaml`의 `parseDocument`, `visit` 사용                                    | 동작 고정(FR-08). 서식·린트 영향 받음      |
| `format/v0/**`              | 스키마 8개, 예제 모델 `shop`                                                                                      | 서식 도구가 건드리면 안 됨                 |
| `LICENSE`                   | Apache-2.0                                                                                                        | 변경 없음                                  |
| `README.md`                 | 2줄                                                                                                               | Prettier 대상 여부를 정해야 함(4.3절)      |

### 코드 흐름 (`validate:format`)

```
npm/pnpm run validate:format
  → node tools/validate-format.mjs format/v0/examples/shop
  → format/v0/schema/*.schema.json 을 Ajv2020 에 등록 (경로는 import.meta.url 기준)
  → model.yaml → dictionary → entities/relationships/subtypes/subject-areas (YAML) → layouts (JSON)
  → 교차 규칙 검사 → stdout "OK: ..." (exit 0) 또는 stderr 오류 (exit 1, model.yaml 없으면 2)
```

- 기준선: `npm run validate:format` 출력은 `OK: 10 entities, 11 relationships, 1 subtype clusters, 3 subject areas, 2 layouts, 5 words, 4 terms, 8 domains`, 종료 코드 0. [확인, 2026-11-27 실행]
- 파일 쓰기 없음, 네트워크 없음, `node_modules`의 `ajv`, `yaml`만 읽는다.

### 재사용할 것

| 대상                                     | 위치                | 쓰임                                                                      |
| ---------------------------------------- | ------------------- | ------------------------------------------------------------------------- |
| `yaml` (루트 devDep)                     | `node_modules/yaml` | AC-12 워크플로 검사 스크립트가 이미 `import { parse } from "yaml"`을 쓴다 |
| `validate:format` 스크립트               | `package.json`      | 그대로 둔다. CI 마지막 단계                                               |
| 6장 검사 스크립트(AC-03, 08, 10, 11, 12) | 스펙                | 계획의 검증 단계로 그대로 쓴다                                            |

## 2. 영향 범위

### 고치는 파일

| 파일                        | 변경                                                                                    | 위험 |
| --------------------------- | --------------------------------------------------------------------------------------- | ---- |
| `package.json`              | `packageManager`, `engines.node`, 스크립트 `build`/`test`/`lint`/`format`, devDeps 추가 | 중   |
| `package-lock.json`         | 삭제 (`git rm`)                                                                         | 낮음 |
| `.gitignore`                | `dist/`, `*.tsbuildinfo`, `coverage/` 추가                                              | 낮음 |
| `CLAUDE.md`                 | "지금 상태", "명령" 절                                                                  | 낮음 |
| `tools/validate-format.mjs` | Prettier 재서식(필수, 3.4절). ESLint 대응은 설정 쪽에서 처리 권장                       | 중   |
| `README.md`                 | 재서식하거나 `.prettierignore`에 추가 (결정 필요)                                       | 낮음 |

### 새로 만드는 파일

| 파일                                                                | 비고                                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm-workspace.yaml`                                               | `packages: ['packages/*']`                                                            |
| `pnpm-lock.yaml`                                                    | `pnpm install`이 생성                                                                 |
| `tsconfig.base.json`                                                | 공통 옵션                                                                             |
| `vitest.config.ts`                                                  | 루트 하나. `include: ['packages/*/src/**/*.test.ts']`                                 |
| `eslint.config.js`                                                  | flat config. `.ts` 설정 파일은 ESLint가 `jiti`를 요구하므로 피한다 [미확인: v10 동작] |
| Prettier 설정 (`.prettierrc.json` 등), `.prettierignore`            |                                                                                       |
| `.github/workflows/ci.yml`                                          |                                                                                       |
| `packages/{core,cli,mcp}/{package.json,tsconfig.json,src/index.ts}` |                                                                                       |
| `packages/core/src/index.test.ts`                                   | 스모크 테스트                                                                         |
| `packages/web/{package.json,tsconfig.json,index.html,src/main.ts}`  |                                                                                       |

### 건드리지 않는 것

- **`spikes/`**: 추적하지 않는 폴더. 이 분석에서는 디렉터리 이름만 나열했고 파일은 열지 않았다. 최상위에 `package.json`, `package-lock.json`, `vite.config.js`, `node_modules/`, `dist/`, `.gitignore`가 있고 ESLint 설정 파일(`eslint.config.*`)은 최상위에 없다. [확인, 하위 폴더는 미확인]
  - `pnpm-workspace.yaml`이 `packages/*`만 가리키면 pnpm은 `spikes/canvas-perf/package.json`을 워크스페이스로 보지 않는다.
  - **위험 경로**: `rm -rf **/node_modules`, `find . -name dist -exec rm`, `pnpm format`(`.prettierignore` 누락 시), `prettier --write .` 같은 광역 명령. 정리 명령은 `rm -rf node_modules packages/*/dist`처럼 경로를 한정한다.
  - AC-11의 "작업 전" 해시는 구현을 시작하기 전에 찍어야 한다(경로 `/tmp/spikes-before.sha256`).
- **`format/`**: Prettier 기본값으로 돌리면 `format/v0/schema/entity.schema.json`이 51줄 바뀐다. [확인] 그래서 `.prettierignore`에 `format/`이 반드시 있어야 한다. 예제 YAML(`model.yaml`)과 레이아웃 JSON(`sales.json`)은 지금도 기본 서식과 같지만 F02의 바이트 기준이므로 무시 대상에 둔다.
- **`docs/`**: `docs/planning.md`는 Prettier 기본 서식과 182줄 다르다. [확인] 스펙대로 무시하면 문제없다. `docs/.yyy-workflow-state.json`도 `docs/` 아래라 무시된다.

### 테스트 영향

기존 테스트 없음. 새로 생기는 것은 `packages/core/src/index.test.ts` 하나와 스펙 6장의 검사 스크립트들이다.

## 3. 패턴과 규칙

### 3.1 지금 있는 규칙

| 규칙                                          | 근거                                                                                                                               | 스캐폴드에 적용                                                                                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESM만                                         | 루트 `"type": "module"`, `.mjs` 도구                                                                                               | 모든 패키지에 `"type": "module"`. 설정 파일은 `.js`(ESM)                                                                                                         |
| Node 내장은 `node:` 접두사                    | `tools/validate-format.mjs` 4~6행                                                                                                  | 새 코드에도 같게                                                                                                                                                 |
| 작은따옴표, 세미콜론, 2칸 들여쓰기, 후행 쉼표 | `tools/validate-format.mjs`                                                                                                        | Prettier: `singleQuote: true`. 나머지는 기본값과 같다                                                                                                            |
| 문서는 Prettier 기본값                        | `CLAUDE.md`, `docs/specs/repo-scaffold.md`, `docs/stage1-backlog.md`, `docs/format-v0.md`, `package.json`이 기본값과 차이 0 [확인] | 이 문서들은 기본 Markdown/JSON 설정과 맞는다. `singleQuote`는 Markdown·JSON에 영향 없음 [미확인: Markdown 코드 블록 안 JS는 Prettier가 기본으로 재서식하지 않음] |
| 이름                                          | 패키지 `@erdmaker/<name>`, 폴더 `packages/<name>`, 브랜치 `feature/<이름>`                                                         | 스펙대로                                                                                                                                                         |
| 커밋 메시지                                   | 영어 명령형 (`Add ...`, `Switch ...`)                                                                                              | 같게                                                                                                                                                             |

### 3.2 printWidth 선택

스펙은 printWidth를 정하지 않았다. 기존 도구 파일에 `singleQuote: true`를 두고 폭별로 바뀌는 줄 수(diff의 `<`/`>` 줄 합)는 다음과 같다. [확인, 캐시에 있던 prettier 3.10.1로 stdin 입출력만 사용]

| printWidth | 80  | 100 | 120 | 140 | 160 | 180 |
| ---------- | --- | --- | --- | --- | --- | --- |
| 바뀌는 줄  | 238 | 153 | 90  | 47  | 28  | 22  |

어떤 값으로도 0이 되지 않는다(한 줄 체인, 배열 리터럴 분해 때문). 기본 80은 새 코드와 문서 기준에 맞지만 이 파일의 diff가 가장 크다. 계획에서 하나를 정해야 한다. 서식만 바뀌는지는 AC-09 출력 비교로 확인한다.

## 4. 위험 (검증 결과)

### 4.1 도구 버전과 `engines.node`

`npm view <pkg> version engines license` 결과 (2026-11-27). [확인]

| 패키지                 | 고를 버전                 | `engines.node`                        | 라이선스   | 비고                                                                                    |
| ---------------------- | ------------------------- | ------------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| pnpm (10 계열)         | **10.34.9** (`latest-10`) | `>=18.12`                             | MIT        | npm `latest`는 12.23.0. 반드시 `pnpm@10.34.9`로 명시                                    |
| typescript             | **6.0.3**                 | `>=14.17`                             | Apache-2.0 | `latest`는 7.0.2(Go 네이티브, `engines >=16.20.0`). typescript-eslint가 `<6.1.0`만 허용 |
| vitest                 | 5.1.2                     | `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` | MIT        | peer `vite ^6.4.0 \|\| ^7 \|\| ^8`, `@types/node ^22.0.0 \|\| >=24`                     |
| vite                   | 8.4.0                     | `^20.19.0 \|\| >=22.12.0`             | MIT        | 의존 `rolldown ~1.3.2`(engines 동일)                                                    |
| eslint                 | 10.15.0                   | `^20.19.0 \|\| ^22.13.0 \|\| >=24`    | MIT        |                                                                                         |
| @eslint/js             | 10.0.1                    | `^20.19.0 \|\| ^22.13.0 \|\| >=24`    | MIT        | peer `eslint ^10`                                                                       |
| typescript-eslint      | 8.74.0                    | `^18.18.0 \|\| ^20.9.0 \|\| >=21.1.0` | MIT        | peer `eslint ^8.57 \|\| ^9 \|\| ^10`, `typescript >=4.8.4 <6.1.0`                       |
| eslint-config-prettier | 10.1.8                    | 없음                                  | MIT        | peer `eslint >=7`                                                                       |
| prettier               | 3.10.1                    | `>=14`                                | MIT        |                                                                                         |
| @types/node (22 계열)  | 22.20.7                   | 없음                                  | MIT        | Node 22에 맞춰 `^22`. 의존 `undici-types ~6.21.0`                                       |
| ajv (기존)             | 8.20.0                    | 없음                                  | MIT        |                                                                                         |
| yaml (기존)            | 2.9.1                     | `>= 14.6`                             | ISC        |                                                                                         |

- **`engines.node` 결론: `^22.13.0`.** Node 22 계열의 하한은 vitest·vite·rolldown이 22.12.0, eslint·@eslint/js가 22.13.0이다. 로컬 v22.23.3은 만족한다. [확인] 전이 의존성 중 더 높은 하한이 있는지는 설치 뒤 `pnpm install`의 engine 경고로 확인한다. [미확인]
- **typescript 7 금지**: `typescript@latest`를 받으면 `pnpm install`이 peer 경고를 내고 typescript-eslint 파서가 동작하지 않을 수 있다. `@typescript-eslint/typescript-estree`는 `@typescript/native`(TS 7.1 dev 이상) 선택 peer를 이미 두고 있지만 정식 지원 범위는 아니다. 명시적으로 `"typescript": "~6.0.3"`을 쓴다. [확인]
- **TypeScript 6 기본값 변화**: `types` 기본값 `[]`, `rootDir` 기본값이 tsconfig 폴더, `strict` 기본 `true`. [문서, 2차 자료 위주. 공식 릴리스 노트 원문은 미확인] 영향:
  - `cli`, `mcp`는 `types: ["node"]`를 명시해야 `@types/node`가 잡힌다.
  - `rootDir: "src"`를 명시하지 않으면 `dist/src/index.js`로 나와 AC-04가 실패한다. 스펙은 이미 명시한다.
  - AC-05의 `tsc --showConfig`는 명시한 값만 출력할 수 있으므로 `core`에도 `types: []`, `lib: ["ES2022"]`를 명시한다(스펙과 같음).
  - `moduleResolution: node10`은 폐기 예정. `module: "NodeNext"`(또는 `ESNext` + `moduleResolution: "Bundler"`) 중 하나를 고른다. `web`은 Vite가 있으므로 `Bundler`가 자연스럽고, `core`·`cli`·`mcp`는 Node가 `dist/`를 바로 읽으므로 `NodeNext`가 안전하다. [미확인: 계획에서 결정]
- **vitest 5 + vite 8 조합**은 peer 범위 안이다. [확인]

### 4.2 pnpm 10의 설치 스크립트 차단

- pnpm 10.0부터 의존성의 lifecycle 스크립트를 기본으로 실행하지 않는다. [문서: pnpm 10.0 변경 기록, socket.dev 정리]
- 허용 설정 이름: pnpm 10에서는 `onlyBuiltDependencies`(목록), **10.26부터 `allowBuilds`**(패키지 → `true`/`false` 맵)가 권장 방식이다. pnpm 11에서는 `onlyBuiltDependencies`가 제거되고 `allowBuilds`만 남았다. [문서: pnpm.io 10.26 릴리스 노트, build settings] 10.34.9를 쓰므로 둘 다 쓸 수 있고, pnpm 11 이전을 대비하면 `allowBuilds`가 낫다. 두 설정 모두 `pnpm-workspace.yaml`에 둔다.
- **실제로 필요한 패키지**: `npm view <pkg> scripts`에서 `preinstall`/`install`/`postinstall`이 있는지 확인했다. [확인]

  | 패키지                                                                                                                                | 설치 스크립트                                                                           |
  | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
  | typescript 6.0.3, vite 8.4.0, vitest 5.1.2, eslint 10.15.0, prettier 3.10.1, typescript-eslint 8.74.0, @types/node 22.20.7, ajv, yaml | 없음                                                                                    |
  | rolldown ~1.3.2, `@rolldown/binding-linux-x64-gnu`                                                                                    | 없음 (네이티브 바이너리를 optionalDependencies로 받음)                                  |
  | lightningcss ^1.33, `lightningcss-linux-x64-gnu`                                                                                      | 없음                                                                                    |
  | postcss                                                                                                                               | 없음                                                                                    |
  | fsevents ~2.3.3 (vite의 선택적 의존, macOS 전용)                                                                                      | `install: node-gyp rebuild`                                                             |
  | esbuild                                                                                                                               | `postinstall: node install.js` — 그러나 Vite 8은 esbuild를 설치하지 않는다(선택적 peer) |

  결론: **Linux(로컬 WSL, CI ubuntu)에서는 허용 목록이 필요 없을 가능성이 크다.** 전이 트리 전체(eslint, vitest 쪽 수십 개)는 검사하지 않았다. [미확인] macOS에서 설치하면 fsevents가 "ignored build" 경고를 낼 수 있다(fsevents는 미리 빌드된 바이너리를 포함한다고 알려져 있으나 미확인).

- 권장: 설치 후 `pnpm ignored-builds`(또는 설치 출력의 "Ignored build scripts" 경고)로 실제 차단 목록을 확인하고, 비어 있으면 설정을 넣지 않는다. 경고가 나면 그 패키지만 `allowBuilds`에 넣는다.
- `strictDepBuilds`의 pnpm 10 기본값: pnpm 11에서 `true`로 바뀐 것은 문서로 확인했고, 10의 기본값(`false`로 보임)은 미확인. 10이 `false`면 차단된 빌드는 경고만 내고 설치는 성공한다.

### 4.3 corepack 0.36과 `corepack enable pnpm`

- 로컬: `corepack` 0.36.0, nvm 설치(`~/.nvm/versions/node/v22.23.3/bin`). [확인]
- `corepack enable --help`: 인자로 패키지 매니저 이름을 받고(`corepack enable yarn` 예시), 기본 설치 위치는 `which corepack`이 있는 폴더, `--install-directory`로 바꿀 수 있다. [확인] 따라서 `corepack enable pnpm`은 올바른 문법이다.
- 쓰는 곳은 두 군데다.
  1. shim: `~/.nvm/versions/node/v22.23.3/bin/pnpm`, `pnpx` 링크 생성. 이 폴더는 현재 사용자가 쓸 수 있다(`test -w` 확인). sudo 불필요. [확인] 다만 사용자 홈의 nvm 폴더를 바꾸는 전역 상태 변경이다.
  2. 캐시: 처음 `pnpm`을 부를 때 `COREPACK_HOME`(미설정, 기본 `~/.cache/node/corepack`)에 pnpm 10.34.9를 내려받는다. 지금은 그 폴더가 없다. [확인: 폴더 없음 / 기본 경로는 문서 기준]
- `COREPACK_ENABLE_AUTO_PIN=0`이 환경에 설정돼 있다. [확인] corepack이 `package.json`에 `packageManager`를 자동으로 써넣지 않는다. CI에는 이 변수가 없지만 `packageManager`를 미리 넣으므로 영향 없다.
- 셸 해시: shim을 만든 같은 셸에서 `pnpm`이 바로 잡히지 않으면 `hash -r`. [미확인]
- 대안: `corepack enable` 없이 `corepack pnpm <cmd>`는 shim을 만들지 않고 캐시에만 쓴다(스펙 6장의 우회와 같다). [문서 기반 추론]
- CI: `actions/setup-node`가 설치하는 Node 22 최신판에 corepack이 포함된다(Node 25부터 제외). 번들된 corepack 버전은 미확인. 2025년 초 npm 서명 키 교체로 0.31 미만에서 서명 검증 오류가 있었던 문제는 0.36에서는 해당 없다. [미확인: 기억 기반]
- setup-node의 자동 캐시는 `packageManager`가 **npm**일 때만 켜진다. pnpm이면 꺼진 상태이고, `cache` 입력을 생략하면 된다(AC-12가 요구). [문서: setup-node advanced usage 미러] 최신 메이저(v6 또는 v7)는 공식 저장소에서 미확인.

### 4.4 `tools/validate-format.mjs`의 ESLint·Prettier 결과 (코드 읽기)

**Prettier**: 실패한다. [확인] 4.1이 아니라 3.2절 표 참조. 서식만 바꾸는 재작성은 FR-06이 허용한다. 재서식 후 AC-09 출력을 기준선과 비교한다.

**ESLint `js.configs.recommended` + `tseslint.configs.recommended`** [코드 읽기 기반, 실행은 미확인]

| 규칙                                                                      | 결과          | 근거                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-undef`                                                                | **위반 예상** | `process`(12, 75, 206행), `console`(74, 204, 205, 208행). flat config는 ES 내장 전역만 넣고 Node 전역은 넣지 않는다. typescript-eslint의 `eslint-recommended` 덮어쓰기(`no-undef` 끔)는 `.ts/.tsx/.mts/.cts`에만 적용된다 |
| `no-unused-vars` / `@typescript-eslint/no-unused-vars`                    | 통과 예상     | import 11개 모두 사용. `Node: (_, n)`의 `_`는 사용된 인자 앞이라 기본 `args: after-used`에서 통과                                                                                                                         |
| `@typescript-eslint/no-unused-expressions`                                | 통과 예상     | `void err(...)`는 화살표 함수 본문(식)이지 식 문장이 아니다                                                                                                                                                               |
| `preserve-caught-error`, `no-useless-assignment` 등 ESLint 9~10 추가 규칙 | 통과 예상     | `catch` 안에서 `throw`하지 않음. `let data;`는 분기마다 한 번 대입                                                                                                                                                        |

대응(동작 무변경): `eslint.config.js`에 `tools/**/*.mjs`와 루트 `*.js` 대상 블록을 두고 `languageOptions.globals`에 `process: 'readonly'`, `console: 'readonly'`를 직접 적는다. `globals` 패키지는 FR-09 목록에 없으므로 쓰려면 스펙을 바꿔야 한다(전이 의존성으로 들어와 있어도 직접 import는 pnpm에서 해석되지 않는다). 파일 안의 `/* global */` 주석보다 설정 쪽이 파일을 덜 건드린다.

**발견한 결함(고치지 않음)**: 32~38행 `load()`의 JSON 파싱 실패 경로가 `return err(file, e.message)`이고, `err`는 `errors.push(...)`의 반환값(배열 길이, 참)을 돌려준다. `loadAll`의 `.filter(Boolean)`을 통과해 `layouts`에 숫자가 들어가고 190~191행 `data.subjectArea`에서 TypeError로 죽는다. 깨진 레이아웃 JSON에서만 나타난다. FR-08이 동작 변경을 막으므로 F01에서는 고치지 않고 F02 이후로 넘긴다.

### 4.5 `pnpm --filter web`과 `@erdmaker/web`

pnpm 필터는 정확한 이름을 먼저 찾고, 없으면 스코프를 뺀 이름이 유일하게 맞는 패키지를 고른다(`--filter=core` → `@babel/core`). 같은 이름이 여러 스코프에 있으면 아무것도 고르지 않는다. [문서: pnpm.io filtering, 번역본에 명시. 영어판에는 `@scope/pkg` 예시만 확인] 이 워크스페이스에는 `web`이라는 이름의 다른 패키지가 없으므로 `@erdmaker/web`에 맞는다. 실제 동작은 설치 후 `pnpm --filter web exec pwd`로 확인한다. [실행 미확인]

### 4.6 직접 의존성 라이선스

4.1 표대로 모두 MIT, Apache-2.0, ISC다. GPL·AGPL 없음. [확인: 레지스트리 메타데이터] 계획에 넣을 점:

- AC-10 스크립트는 각 패키지 `node_modules/<name>/package.json`의 `license`를 읽는다. `cli`·`mcp`·`web`의 `@erdmaker/core`는 `packages/core`로의 링크이므로 `packages/core/package.json`에 `license`가 없으면 `"undefined"`가 출력된다. 통과는 하지만 각 패키지에 `"license": "Apache-2.0"`을 넣는 편이 출력이 분명하다.
- 각 패키지가 devDependencies를 따로 두지 않으면(루트에만 두면) 스크립트가 읽을 것이 루트뿐이다. 4.7 참고.

### 4.7 pnpm으로 만든 `node_modules`에서 `npm run validate:format`

- 지금 `node_modules`는 npm이 만든 평면 구조다(ajv, fast-deep-equal, fast-uri, json-schema-traverse, require-from-string, yaml). [확인]
- pnpm은 루트의 직접 의존성 `ajv`, `yaml`을 `node_modules/ajv`, `node_modules/yaml`에 `.pnpm/` 저장소로의 링크로 둔다. Node는 기본으로 실제 경로로 해석하므로 ajv의 하위 의존성도 `.pnpm/` 안에서 찾는다.
- `ajv`에는 `exports` 필드가 없어 `ajv/dist/2020.js` 깊은 import가 그대로 된다. `yaml`의 `exports["."]`에 `node` 조건이 있어 `import { parseDocument, visit } from 'yaml'`이 된다. [확인: 설치된 package.json]
- `npm run`은 스크립트만 실행하고 의존성 트리를 검사하지 않는다. `packageManager: pnpm@...`가 있어도 npm은 거부하지 않는다(`devEngines`만 강제 — 스펙이 이미 제외). corepack npm shim은 `corepack enable pnpm`으로 만들어지지 않는다. [문서 기반 추론, 실행 미확인]
- 결론: 동작할 것으로 본다. AC-09로 확인한다. [미확인]
- **주의 1**: 이후 `npm install`은 쓰면 안 된다. `workspace:*` 프로토콜을 npm이 지원하지 않아 실패한다(EUNSUPPORTEDPROTOCOL). CLAUDE.md "명령" 절에 적는다. [기억 기반, 미확인]
- **주의 2**: npm이 만든 기존 `node_modules`가 있는 상태에서 `pnpm install`을 하면 pnpm이 다른 매니저가 설치한 패키지를 `node_modules/.ignored`로 옮기거나 재설치 확인을 묻는다(비대화형에서 중단 가능). [미확인] 계획에서는 루트의 `node_modules`만 지우고(`rm -rf ./node_modules`) 설치한다. `spikes/canvas-perf/node_modules`는 지우지 않는다.

### 4.8 기타 위험

| 위험                                   | 내용                                                                                                                       | 대응                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `README.md` Prettier 불일치            | 제목 뒤 빈 줄이 없어 `prettier --check .`가 실패한다 [확인]                                                                | 한 줄 서식 수정 또는 `.prettierignore`에 추가. 스펙 FR-06은 "루트의 설정 파일"만 대상이라 둘 다 허용 범위. 계획에서 결정 |
| `CLAUDE.md`                            | 지금은 Prettier 기본과 같다 [확인]. FR-10 수정 뒤에도 서식을 맞춰야 `pnpm lint`가 통과한다(무시하지 않는 경우)             | 수정 후 `pnpm format`                                                                                                    |
| Prettier의 `.gitignore` 반영           | Prettier 3 CLI는 기본으로 `.gitignore`와 `.prettierignore`를 함께 읽지만, AC-08은 `ignorePath: ".prettierignore"`만 넘긴다 | `dist/`, `spikes/` 등을 `.prettierignore`에 직접 적는다 [CLI 기본값은 기억 기반, 미확인]                                 |
| ESLint 10 설정 탐색                    | v10은 각 파일 폴더에서 위로 설정을 찾는다. `spikes/canvas-perf` 최상위에는 ESLint 설정이 없다 [확인: 이름만]               | 루트 설정의 `ignores`에 `spikes/**`                                                                                      |
| 루트 바이너리                          | pnpm은 워크스페이스 패키지 스크립트의 PATH에 `<root>/node_modules/.bin`을 넣는다 [문서: pnpm.io cli/run]                   | `tsc`, `vite`를 루트 devDeps에만 두어도 패키지 `build` 스크립트에서 실행된다                                             |
| AC-03 `pnpm -r list --depth -1 --json` | 출력 형식(`name`, `path`)이 pnpm 10에서 스펙 가정과 같은지                                                                 | 설치 후 실행 [미확인]                                                                                                    |
| AC-08 API                              | ESLint 10 `ESLint#isPathIgnored`, Prettier 3 `getFileInfo(f, { ignorePath })`                                              | 둘 다 존재하는 API로 알고 있으나 [미확인]                                                                                |
| `pnpm build` 순서                      | `pnpm -r build`는 위상 순서로 돈다. `core`가 먼저 빌드돼야 `cli` 등이 `dist/index.d.ts`를 찾는다                           | 루트 `build`: `pnpm -r build`                                                                                            |
| 빈 `src/index.ts`의 산출물             | `moduleDetection: "force"`면 빈 파일도 `export {};`가 있는 모듈로 출력된다                                                 | AC-04로 확인                                                                                                             |

## 5. 아키텍처

### 결과 구조

```
erdmaker/ (root, private, type: module, packageManager pnpm@10.34.9, engines ^22.13.0)
├─ pnpm-workspace.yaml  → packages/*
├─ tsconfig.base.json   ← packages/*/tsconfig.json (extends)
├─ vitest.config.ts     → packages/*/src/**/*.test.ts
├─ eslint.config.js, .prettierrc.json, .prettierignore
├─ .github/workflows/ci.yml
├─ packages/
│  ├─ core  (tsc → dist, lib ES2022, types [])
│  ├─ cli   (tsc → dist, types [node])  ─┐
│  ├─ mcp   (tsc → dist, types [node])  ─┼─ dependencies: @erdmaker/core workspace:*
│  └─ web   (tsc --noEmit && vite build, lib DOM) ─┘
├─ tools/validate-format.mjs  (변경 없음, 서식만)
├─ format/  (무시)
└─ spikes/  (무시, 워크스페이스 밖)
```

### 공통 관심사

| 관심사    | 패턴                                      | 위치                        |
| --------- | ----------------------------------------- | --------------------------- |
| 인증·권한 | 없음 (CI만 `permissions: contents: read`) | `.github/workflows/ci.yml`  |
| 로깅·오류 | 기존 도구는 `console.error` + 종료 코드   | `tools/validate-format.mjs` |
| 검증      | Ajv 2020 + yaml core schema               | `tools/validate-format.mjs` |
| 캐시      | CI 캐시 없음(스펙)                        |                             |

### 확장 지점

- F02가 `core`에 모델·명령 API와 파일 어댑터 인터페이스를 넣는다. `core`의 `lib`/`types` 제한이 첫 장치다.
- F09가 `web` 위에 React와 PWA를 얹는다. `vite.config.ts`는 F01에서 필요 없으면 만들지 않아도 된다(Vite는 설정 없이 `index.html`을 진입점으로 쓴다).
- `cli`의 `bin`은 F02.

## 6. 기술 부채

| 위치                           | 문제                                           | 권장                                        | 우선순위 |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------- | -------- |
| `tools/validate-format.mjs:38` | JSON 파싱 실패 시 숫자를 반환해 이후 TypeError | `err(...); return;`로 분리. F02 이후        | 중       |
| `tools/validate-format.mjs`    | 단일 파일 211줄, 테스트 없음                   | F02에서 `core` 검증기로 옮길 때 테스트 추가 | 중       |
| `docs/planning.md`             | Prettier 기본 서식과 다름                      | `docs/` 무시로 F01 영향 없음                | 낮음     |

## 7. 계획에 넘길 권장 사항

1. 구현 시작 전에 AC-11의 `spikes/` 해시를 찍는다.
2. 버전 고정: `pnpm@10.34.9`, `typescript ~6.0.3`, `@types/node ^22`, 나머지는 4.1 표의 최신. `engines.node: "^22.13.0"`.
3. `pnpm-workspace.yaml`에는 처음에 빌드 허용 설정을 넣지 않고, 설치 출력에 차단 경고가 나올 때만 `allowBuilds`에 그 패키지만 넣는다. 스펙 7장의 esbuild 항목은 Vite 8에 맞게 고쳐 읽는다.
4. ESLint 설정에서 `tools/**`와 루트 JS 설정 파일에 `process`, `console` 전역을 준다.
5. Prettier printWidth를 정하고 `tools/validate-format.mjs`를 재서식한 뒤 AC-09 출력을 기준선과 비교한다. `README.md` 처리 방식을 정한다.
6. 설치 전 루트 `node_modules`만 지운다. 광역 삭제·서식 명령을 쓰지 않는다.
7. TS 6 기본값 때문에 `rootDir`, `types`, `lib`를 모든 패키지에 명시한다.

### 단계 제안

1. 기준선 기록(AC-11 해시, AC-09 출력) → 루트 `package.json`·`pnpm-workspace.yaml`·설치(AC-01, AC-02)
2. 패키지 4개와 TypeScript(AC-03, AC-04, AC-05)
3. Vitest(AC-06)
4. ESLint·Prettier, 기존 파일 서식(AC-07, AC-08, AC-09)
5. CI, CLAUDE.md, 라이선스·spikes 검사(AC-10, AC-11, AC-12) → PR 후 AC-13

## 8. 반드시 읽을 파일

| 파일                                   | 이유                      | 우선순위 |
| -------------------------------------- | ------------------------- | -------- |
| `docs/specs/repo-scaffold.md`          | 요구사항과 검사 스크립트  | 필수     |
| `tools/validate-format.mjs`            | 서식·린트 대상, 동작 고정 | 필수     |
| `package.json`                         | 고칠 대상                 | 필수     |
| `CLAUDE.md`                            | FR-10 대상, 결정 사항     | 필수     |
| `.gitignore`                           | 고칠 대상                 | 권장     |
| `docs/stage1-backlog.md` F01, F02, F09 | 후속 기능과의 경계        | 권장     |

## 9. 출처

- npm 레지스트리 (`npm view`, 2026-11-27): pnpm, typescript, vitest, vite, rolldown, lightningcss, eslint, @eslint/js, typescript-eslint, @typescript-eslint/parser, @typescript-eslint/typescript-estree, eslint-config-prettier, prettier, @types/node, ajv, yaml, fsevents, esbuild
- [pnpm 10.26 릴리스 노트](https://pnpm.io/blog/releases/10.26), [pnpm build settings](https://pnpm.io/settings/build), [pnpm 10.0 스크립트 차단 정리 (socket.dev)](https://socket.dev/blog/pnpm-10-0-0-blocks-lifecycle-scripts-by-default), [pnpm 11 discussion](https://github.com/orgs/pnpm/discussions/11377)
- [pnpm filtering](https://pnpm.io/filtering), [pnpm filtering (일본어)](https://pnpm.io/ja/filtering)
- [pnpm run (10.x)](https://pnpm.io/10.x/cli/run)
- [Announcing TypeScript 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6.0/), [socket.dev TypeScript 6.0 정리](https://socket.dev/blog/typescript-6-0-released-final-javascript-based-version)
- [setup-node advanced usage (미러)](https://gitea.psi.ch/actions/setup-node/src/branch/main/docs/advanced-usage.md)
- 로컬: `corepack enable --help` (0.36.0), `node -v` v22.23.3, 캐시된 prettier 3.10.1(stdin 입출력만)

---

Design Recommendation: none — 설정·도구 구성만 바꾸고 API, 데이터 모델, 화면이 없으며 구조 결정은 스펙 4장에 이미 있다.
Layer Detection: [config, build-tooling, ci, docs]
