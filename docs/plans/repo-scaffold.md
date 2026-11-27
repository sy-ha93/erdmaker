# F01 `repo-scaffold` 구현 계획

**작성일**: 2026-11-27
**스펙**: [docs/specs/repo-scaffold.md](../specs/repo-scaffold.md)
**분석 보고서**: [docs/analysis/repo-scaffold.md](../analysis/repo-scaffold.md)
**설계 문서**: 없음 (설정과 도구 구성만 다루므로 설계 단계를 건너뛰었다)
**브랜치**: `feature/repo-scaffold`
**상태**: 진행 중 (단계 3의 3.8 대기)

스펙과 분석이 다르면 분석을 따른다. 분석은 스펙을 쓴 뒤에 레지스트리로 확인한 내용이다.

## 1. 요구사항 요약

| 요구사항 | 내용                                                                              | 확인하는 수용 기준  |
| -------- | --------------------------------------------------------------------------------- | ------------------- |
| FR-01    | pnpm 워크스페이스, `packageManager`, `engines.node`, 잠금 파일 교체, `.gitignore` | AC-01, AC-02, AC-03 |
| FR-02    | 빈 패키지 4개 (`core`, `cli`, `mcp`, `web`)                                       | AC-03, AC-04        |
| FR-03    | `tsconfig.base.json`과 패키지별 TypeScript 설정                                   | AC-04, AC-05        |
| FR-04    | 루트 스크립트 `build`, `test`, `lint`, `format`, `validate:format`                | AC-04, AC-06, AC-07 |
| FR-05    | 루트 Vitest 설정 하나, `core` 스모크 테스트 하나                                  | AC-06               |
| FR-06    | ESLint flat config, Prettier, 무시 경로                                           | AC-07, AC-08        |
| FR-07    | GitHub Actions 워크플로 하나, 작업 하나                                           | AC-12, AC-13        |
| FR-08    | `validate:format`의 동작 유지                                                     | AC-09               |
| FR-09    | 런타임 의존성 추가 없음, 도구는 devDependencies, GPL·AGPL 없음                    | AC-10               |
| FR-10    | `CLAUDE.md` 갱신                                                                  | AC-07 (서식)        |
| 제약     | `spikes/`를 건드리지 않는다                                                       | AC-11               |

DB, API, 화면 요구사항은 없다.

## 2. 분석 보고서 반영

### 적용한 권장 사항

| 분석 항목                                  | 계획에 반영한 내용                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| TypeScript 7을 쓸 수 없다 (0장 1)          | `typescript`를 `~6.0.3`으로 고정한다                                                                         |
| Vite 8은 esbuild에 의존하지 않는다 (0장 2) | 스펙 7장의 esbuild 허용 항목을 버린다. 빌드 허용 설정은 처음에 넣지 않는다                                   |
| 검사 도구가 Prettier를 통과하지 못한다     | `tools/validate-format.mjs`를 Prettier로 재서식한다. 동작은 바꾸지 않고 AC-09로 확인한다                     |
| `no-undef`가 `process`, `console`을 잡는다 | `eslint.config.js`의 `tools/**` 블록에 두 전역을 `readonly`로 선언한다                                       |
| `README.md`가 기본 서식과 다르다           | 무시 목록에 넣지 않고 Prettier로 재서식한다                                                                  |
| `engines.node` 하한                        | `^22.13.0`                                                                                                   |
| TypeScript 6 기본값 변화 (4.1절)           | `types`, `rootDir`, `lib`, `module`, `moduleResolution`, `strict`를 기본값에 기대지 않고 명시한다            |
| npm이 만든 `node_modules` (4.7절 주의 2)   | 첫 `pnpm install` 전에 루트의 `./node_modules`만 지운다                                                      |
| 광역 명령의 위험 (2장)                     | 삭제와 서식 명령은 경로를 한정한다. `.prettierignore`를 확인하기 전에는 `prettier --write`를 실행하지 않는다 |
| AC-10 출력 (4.6절)                         | 패키지 4개의 `package.json`에 `"license": "Apache-2.0"`을 넣는다                                             |

### 재사용하는 것

| 대상                         | 위치                          | 쓰임                                          |
| ---------------------------- | ----------------------------- | --------------------------------------------- |
| `validate:format` 스크립트   | `package.json`                | 그대로 둔다. CI의 마지막 단계                 |
| `yaml` (루트 devDependency)  | `node_modules/yaml`           | AC-12 검사 스크립트가 워크플로를 읽을 때 쓴다 |
| 스펙 6.1~6.6의 검사 스크립트 | `docs/specs/repo-scaffold.md` | 각 단계의 검증 명령으로 쓴다(5장의 예외 참고) |

### 고정하는 버전

분석 4.1절의 표(2026-11-27 레지스트리 조회)를 따른다.

| 패키지                   | `package.json`에 쓸 값 | 비고                                                         |
| ------------------------ | ---------------------- | ------------------------------------------------------------ |
| pnpm                     | `pnpm@10.34.9`         | `packageManager` 필드. npm의 `latest`(pnpm 12)를 쓰지 않는다 |
| `typescript`             | `~6.0.3`               | typescript-eslint가 `<6.1.0`만 받는다                        |
| `vitest`                 | `^5.1.2`               |                                                              |
| `vite`                   | `^8.4.0`               |                                                              |
| `eslint`                 | `^10.15.0`             |                                                              |
| `@eslint/js`             | `^10.0.1`              |                                                              |
| `typescript-eslint`      | `^8.74.0`              |                                                              |
| `eslint-config-prettier` | `^10.1.8`              |                                                              |
| `prettier`               | `^3.10.1`              |                                                              |
| `@types/node`            | `^22.20.7`             | Node 22 계열에 맞춘다                                        |
| `ajv`, `yaml`            | 지금 값 그대로         | `^8.17.1`, `^2.6.0`                                          |

도구는 모두 루트 `devDependencies`에만 둔다. pnpm은 패키지 스크립트의 PATH에 루트의 `node_modules/.bin`을 넣으므로 패키지의 `build` 스크립트가 `tsc`, `vite`를 찾는다. 패키지의 `dependencies`에는 `@erdmaker/core`(`workspace:*`)만 있다.

### 제약

- `spikes/` 아래의 어떤 파일도 만들거나 고치거나 지우지 않는다. 재귀 삭제 패턴(`**/node_modules`, `find ... -exec rm` 등)을 쓰지 않는다.
- `format/`, `docs/`는 서식 도구의 대상이 아니다.
- `tools/validate-format.mjs`의 동작을 바꾸지 않는다. 38행의 결함도 고치지 않는다(6장 알려진 문제).
- 기능 코드, PWA 설정, React, CLI의 `bin`, `vite.config.ts`는 넣지 않는다.
- `devEngines`를 넣지 않는다.

## 3. 영향 분석 (Dry-Run)

### 전체 위험도: 중간

기존 코드는 서식만 바뀌고, 나머지는 새 설정 파일이다. 되돌리기 어려운 변경은 없다.

### 새로 만드는 파일 (22개)

손으로 쓰는 파일이 21개, `pnpm install`이 만드는 파일이 1개(`pnpm-lock.yaml`)다.

| 파일                              | 위험 | 내용                                                               |
| --------------------------------- | ---- | ------------------------------------------------------------------ |
| `pnpm-workspace.yaml`             | 낮음 | `packages/*`만 대상                                                |
| `pnpm-lock.yaml`                  | 낮음 | `pnpm install`이 만든다. 손으로 고치지 않는다                      |
| `tsconfig.base.json`              | 낮음 | 공통 컴파일러 옵션                                                 |
| `packages/core/package.json`      | 낮음 | `@erdmaker/core`, `exports`가 `dist/`의 JS와 타입을 가리킨다       |
| `packages/core/tsconfig.json`     | 낮음 | `lib: ["ES2022"]`, `types: []`                                     |
| `packages/core/src/index.ts`      | 낮음 | 내용 없음                                                          |
| `packages/core/src/index.test.ts` | 낮음 | 스모크 테스트 하나                                                 |
| `packages/cli/package.json`       | 낮음 | `@erdmaker/cli`                                                    |
| `packages/cli/tsconfig.json`      | 낮음 | `types: ["node"]`                                                  |
| `packages/cli/src/index.ts`       | 낮음 | 내용 없음                                                          |
| `packages/mcp/package.json`       | 낮음 | `@erdmaker/mcp`                                                    |
| `packages/mcp/tsconfig.json`      | 낮음 | `types: ["node"]`                                                  |
| `packages/mcp/src/index.ts`       | 낮음 | 내용 없음                                                          |
| `packages/web/package.json`       | 낮음 | `@erdmaker/web`                                                    |
| `packages/web/tsconfig.json`      | 낮음 | `lib: ["ES2022", "DOM"]`, `noEmit`                                 |
| `packages/web/index.html`         | 낮음 | `<script type="module" src="/src/main.ts">` 한 줄을 가진 최소 문서 |
| `packages/web/src/main.ts`        | 낮음 | 내용 없음                                                          |
| `vitest.config.ts`                | 낮음 | `include: packages/*/src/**/*.test.ts`                             |
| `eslint.config.js`                | 낮음 | flat config, 무시 경로, `tools/**`의 Node 전역                     |
| `.prettierrc.json`                | 낮음 | `singleQuote: true`만. 폭은 기본값(80)                             |
| `.prettierignore`                 | 중간 | 빠뜨리면 `pnpm format`이 `format/`, `docs/`, `spikes/`를 고친다    |
| `.github/workflows/ci.yml`        | 중간 | PR과 `main` push에서 실행. `contents: read`만                      |

### 고치는 파일 (5개)

| 파일                        | 위험 | 내용                                                                       |
| --------------------------- | ---- | -------------------------------------------------------------------------- |
| `package.json`              | 중간 | `packageManager`, `engines.node`, 스크립트 4개, devDependencies 9개 추가   |
| `.gitignore`                | 낮음 | `dist/`, `*.tsbuildinfo`, `coverage/` 추가                                 |
| `tools/validate-format.mjs` | 중간 | Prettier 재서식만. 폭 80에서 약 238줄이 바뀐다(분석 3.2절). 동작 변경 없음 |
| `README.md`                 | 낮음 | Prettier 재서식(제목 뒤 빈 줄 하나)                                        |
| `CLAUDE.md`                 | 낮음 | "지금 상태", "명령" 절과 라이선스 항목                                     |

이 계획 파일(`docs/plans/repo-scaffold.md`)도 구현하면서 바뀐다(체크박스, 7장 기록). 그 변경은 각 단계의 커밋에 함께 넣는다.

### 지우는 파일 (1개)

| 파일                | 위험 | 내용                                                |
| ------------------- | ---- | --------------------------------------------------- |
| `package-lock.json` | 낮음 | `git rm`. 추적 중인 파일이라 Git에서 되살릴 수 있다 |

### 저장소 밖과 추적하지 않는 곳의 변경

| 대상                                                                                | 변경                                                                                                                                                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 루트 `./node_modules`                                                               | 한 번 지우고 pnpm이 다시 만든다. 추적하지 않는 폴더다                                                                                                               |
| `packages/{core,cli,mcp,web}/node_modules`, `packages/{core,cli,mcp,web}/dist`      | pnpm과 빌드가 만든다. `.gitignore` 대상이다                                                                                                                         |
| `/home/pc/.nvm/versions/node/v22.23.3/bin/`                                         | **`corepack enable pnpm`이 `pnpm`, `pnpx` 링크를 추가한다.** 사용자의 nvm 폴더가 바뀌는 전역 변경이다. 예상한 변경이고 허용됐다. 되돌리려면 `corepack disable pnpm` |
| `~/.cache/node/corepack`                                                            | 처음 `pnpm`을 부를 때 pnpm 10.34.9를 내려받는다                                                                                                                     |
| pnpm 저장소 (`pnpm store path`로 확인)                                              | 내려받은 패키지가 쌓인다                                                                                                                                            |
| `/tmp/spikes-before.sha256`, `/tmp/spikes-after.sha256`, `/tmp/validate-before.txt` | 기준선 파일                                                                                                                                                         |

### 파괴적 작업

| 작업                       | 평가                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `git rm package-lock.json` | Git 이력에 남는다. 아래 "되돌리기"의 명령으로 되살린다                              |
| `rm -rf ./node_modules`    | 루트 한 곳만. 설치로 다시 만든다. `spikes/canvas-perf/node_modules`는 대상이 아니다 |

DB, API, 인증 변경은 없다.

### 되돌리기

브랜치를 지우지 않는다. 스펙, 분석, 계획 문서가 이 브랜치에만 커밋돼 있어서 브랜치를 지우면 함께 사라진다. `git clean`과 glob 삭제도 쓰지 않는다(`spikes/`가 추적하지 않는 폴더다).

- **단계 1을 커밋하기 전**: `git restore --staged --worktree -- package-lock.json package.json .gitignore`로 추적 중인 파일을 되살린다. 새로 만든 파일은 3장 표의 경로를 하나씩 지정해 지운다. 이어서 아래 "생성물 삭제"를 하고 `npm install`을 실행한다.
- **커밋한 뒤 (전체)**: 문서 커밋(1.2, 해시는 7장)은 남기고 구현 커밋(단계 1~3)만 `git revert`한다. 이어서 "생성물 삭제"를 하고 `npm install`을 실행한다.
- **생성물 삭제**: 저장소 루트에서 다음 경로만, 정확히 이 이름으로 지운다.

  ```bash
  rm -rf ./node_modules \
    ./packages/core/dist ./packages/cli/dist ./packages/mcp/dist ./packages/web/dist \
    ./packages/core/node_modules ./packages/cli/node_modules \
    ./packages/mcp/node_modules ./packages/web/node_modules
  ```

- pnpm 링크: `corepack disable pnpm`.
- 서식 변경만: `git checkout main -- tools/validate-format.mjs README.md`.

## 4. 구현 순서

각 단계가 끝나면 그 단계의 "검증" 명령을 모두 돌릴 수 있다. 단계마다 커밋 하나(영어 명령형 메시지)를 만든다. 이 계획 파일의 체크박스 표시와 7장 기록은 그 단계의 커밋에 함께 넣는다.

### 단계 1: 기준선, 워크스페이스, 패키지

**목표**: `pnpm install`과 `pnpm build`가 통과하고 기존 형식 검사가 그대로 돈다.
**위험**: 중간 · **상태**: 완료 · **수용 기준**: AC-01, AC-02, AC-03, AC-04, AC-05, AC-09

- [x] 1.1 **(가장 먼저, 다른 어떤 명령보다 앞서)** 저장소 루트에서 `spikes/`의 "작업 전" 목록을 찍는다. 스펙 6.5절과 같은 내용을 오류가 숨지 않게 실행한다.

  ```bash
  (set -euo pipefail
   { find spikes -type f -print0 | sort -z | xargs -0 sha256sum
     find spikes -type l -printf '%p -> %l\n' | sort
   } > /tmp/spikes-before.sha256); echo "exit=$?"
  ```

  `exit=0`이고 `test -s /tmp/spikes-before.sha256`이 통과해야 한다. 아니면 멈추고 알린다(불완전한 기준선으로 진행하지 않는다). 이 파일은 다시 만들 수 없으므로 AC-11이 끝날 때까지 지우지 않는다.

- [x] 1.2 `git branch --show-current`가 `feature/repo-scaffold`인지 확인한다(확인된 상태다. 다르면 멈추고 알린다). 이어서 문서 세 개만 먼저 커밋한다: `git add docs/specs/repo-scaffold.md docs/analysis/repo-scaffold.md docs/plans/repo-scaffold.md` 뒤 커밋한다. 해시는 7장에 적고, 그 기록은 단계 1의 커밋(1.15)에 들어간다. 되돌릴 때 이 문서 커밋은 남긴다.
- [x] 1.3 형식 검사 기준선을 찍는다: `npm run --silent validate:format > /tmp/validate-before.txt; echo "exit=$?"`. `exit=0`이고 파일에 `OK:` 줄 하나만 있어야 한다(`--silent`가 npm의 스크립트 머리말을 뺀다). 오류 경로도 찍는다: `node tools/validate-format.mjs /nonexistent-erdmaker-dir; echo "exit=$?"`가 `exit=2`인지 확인한다.
- [x] 1.4 `corepack enable pnpm`을 실행한다(nvm bin 폴더에 `pnpm`, `pnpx` 링크가 생긴다). **실패하면 멈추고 사용자에게 알린다.** `corepack pnpm`으로 우회하지 않는다(루트 스크립트가 `pnpm`을 직접 부르므로 PATH에 `pnpm`이 없으면 `build`가 실패한다). pnpm 버전은 `packageManager`를 넣은 뒤인 1.5에서 확인한다.
- [x] 1.5 `package.json`을 고친다: `packageManager: "pnpm@10.34.9"`, `engines.node: "^22.13.0"`, 스크립트 `build: "pnpm -r build"` 추가, devDependencies에 2장 표의 도구 9개 추가. `validate:format`, `ajv`, `yaml`은 그대로 둔다. `test`, `lint`, `format` 스크립트는 단계 2에서 넣는다(설정 없이 돌면 `spikes/`를 훑는다). `devEngines`는 넣지 않는다. 고친 뒤 `hash -r; pnpm --version`이 `10.34.9`인지 확인한다. 아니면 멈추고 알린다.
- [x] 1.6 `pnpm-workspace.yaml`을 만든다: `packages`에 `packages/*`만. 빌드 허용 설정은 넣지 않는다.
- [x] 1.7 `.gitignore`에 `dist/`, `*.tsbuildinfo`, `coverage/`를 더한다.
- [x] 1.8 `tsconfig.base.json`을 만든다: `strict: true`, `target: "ES2022"`, `moduleDetection: "force"`, `skipLibCheck: true`. 출력 경로와 `lib`, `types`, `module`은 패키지마다 적는다.
- [x] 1.9 `packages/core/`를 만든다.
  - `package.json`: `name: "@erdmaker/core"`, `private: true`, `type: "module"`, `license: "Apache-2.0"`, `exports["."]`가 `types: ./dist/index.d.ts`와 `default: ./dist/index.js`, 스크립트 `build: "tsc"`.
  - `tsconfig.json`: 기본 설정 확장. `rootDir: "src"`, `outDir: "dist"`, `declaration: true`, `lib: ["ES2022"]`, `types: []`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `include: ["src"]`, `exclude: ["src/**/*.test.ts"]`.
  - `src/index.ts`: 내용 없음.
- [x] 1.10 `packages/cli/`와 `packages/mcp/`를 `core`와 같은 구성으로 만든다. 다른 점: 이름(`@erdmaker/cli`, `@erdmaker/mcp`), `dependencies`에 `"@erdmaker/core": "workspace:*"`, `types: ["node"]`. `bin`은 넣지 않는다.
- [x] 1.11 `packages/web/`을 만든다.
  - `package.json`: `name: "@erdmaker/web"`, `private`, `type: "module"`, `license`, `dependencies`에 `@erdmaker/core`(`workspace:*`), 스크립트 `build: "tsc --noEmit && vite build"`.
  - `tsconfig.json`: 기본 설정 확장. `rootDir: "src"`, `noEmit: true`, `lib: ["ES2022", "DOM"]`, `types: []`, `module: "ESNext"`, `moduleResolution: "Bundler"`, `include: ["src"]`.
  - `index.html`: `<script type="module" src="/src/main.ts"></script>`를 가진 최소 HTML. `src/main.ts`: 내용 없음. `vite.config.ts`는 만들지 않는다.
- [x] 1.12 잠금 파일을 바꾼다. 이 순서대로, 저장소 루트에서 실행한다: `git rm package-lock.json` → `rm -rf ./node_modules`(루트 한 곳만, 다른 경로나 glob을 붙이지 않는다) → `pnpm install`. 여기서 막혀 되돌려야 하면 3장 "단계 1을 커밋하기 전"을 따른다.
- [x] 1.13 설치 출력을 확인한다: engine 경고가 없는지, "Ignored build scripts" 경고가 없는지(`pnpm ignored-builds`로도 확인). 차단된 패키지가 없으면 아무것도 넣지 않는다. 있으면 그 패키지만 `pnpm-workspace.yaml`의 `allowBuilds`에 넣고, `pnpm rebuild <패키지>`로 그 스크립트를 실행한 뒤 `pnpm ignored-builds`가 비었는지 확인하고, 7장에 패키지 이름을 적는다. esbuild는 넣지 않는다.
- [x] 1.14 **검증**: AC-01(`pnpm install --frozen-lockfile`), AC-02, AC-03(스펙 6.1), AC-04(5장의 명령), AC-05(`pnpm --filter @erdmaker/core exec tsc --showConfig`에서 `lib`에 `dom`이 없고 `types`가 `[]`), AC-09(2.10의 비교 방법으로). 추가로 `pnpm --filter web exec pwd`가 `packages/web`을 가리키는지, 네 패키지의 `tsc --showConfig`에 `strict: true`가 나오는지 본다.
- [x] 1.15 구현 변경과 이 계획 파일의 변경을 커밋한다. `spikes/`와 `docs/.yyy-workflow-state.json`은 스테이징하지 않는다(`git add -A`를 쓰지 않고 경로를 지정한다).

### 단계 2: 테스트, 린트, 서식

**목표**: `pnpm test`와 `pnpm lint`가 통과한다. 기존 파일은 서식만 바뀐다.
**위험**: 중간 · **상태**: 완료 · **수용 기준**: AC-06, AC-07, AC-08, AC-09

- [x] 2.1 `vitest.config.ts`를 루트에 만든다: `test.include`는 `packages/*/src/**/*.test.ts` 하나뿐.
- [x] 2.2 `packages/core/src/index.test.ts`에 스모크 테스트 하나를 쓴다(`vitest`에서 `expect`, `test`를 가져와 자명한 단언 하나).
- [x] 2.3 `package.json`에 스크립트 `test: "vitest run"`을 더한다.
- [x] 2.4 `.prettierrc.json`을 만든다: `singleQuote: true`만. `printWidth`는 적지 않는다(기본 80).
- [x] 2.5 `.prettierignore`를 만든다: `spikes/`, `format/`, `docs/`, `dist/`, `coverage/`, `pnpm-lock.yaml`. `.gitignore`에 기대지 않고 여기에 직접 적는다.
- [x] 2.6 `eslint.config.js`를 만든다(`.ts`가 아닌 `.js`, ESM).
  - 전역 무시: `spikes/**`, `format/**`, `docs/**`, `**/dist/**`, `coverage/**`, `pnpm-lock.yaml`.
  - 규칙: `@eslint/js`의 권장 설정, `typescript-eslint`의 권장 설정, 마지막에 `eslint-config-prettier`.
  - `tools/**/*.mjs` 블록의 `languageOptions.globals`에 `process: 'readonly'`, `console: 'readonly'`를 선언한다. `globals` 패키지는 더하지 않는다.
- [x] 2.7 `package.json`에 스크립트 `lint: "eslint . && prettier --check ."`, `format: "prettier --write ."`를 더한다.
- [x] 2.8 **`prettier --write`를 실행하기 전에** AC-08(스펙 6.3)을 돌려 무시 경로가 맞는지 확인한다. 이어서 읽기 전용인 `pnpm exec prettier --check .`의 목록을 본다. `spikes/`, `format/`, `docs/` 경로가 하나라도 나오면 멈추고 2.5를 고친다.
- [x] 2.9 `pnpm format`을 앞뒤 상태를 비교하며 실행한다: `git status --porcelain > /tmp/status-before-format.txt` → `pnpm format` → `git status --porcelain | diff /tmp/status-before-format.txt -`. `diff`에 새로 나타나는 줄은 `tools/validate-format.mjs`와 `README.md`의 수정 표시 둘뿐이어야 한다(`package.json`과 이 계획 파일처럼 이미 바뀌어 있던 파일은 앞뒤가 같아 나오지 않는다). `format/`, `docs/`, `spikes/` 경로가 나오면 멈추고 알린다.
- [x] 2.10 `tools/validate-format.mjs`의 동작이 같은지 확인한다(AC-09). 출력 전체가 아니라 `OK:` 줄만 비교하고 종료 코드는 따로 본다.
  - `npm run validate:format; echo "exit=$?"`와 `pnpm validate:format; echo "exit=$?"`가 각각 `exit=0`이다.
  - `diff <(grep '^OK:' /tmp/validate-before.txt) <(npm run --silent validate:format | grep '^OK:')`와, `npm run --silent`를 `pnpm --silent`로 바꾼 같은 명령이 둘 다 출력 없이 종료 코드 0이다.
  - `node tools/validate-format.mjs /nonexistent-erdmaker-dir; echo "exit=$?"`가 여전히 `exit=2`다.
  - `git diff -w tools/validate-format.mjs`를 훑어 줄바꿈과 공백, 괄호 외의 변경이 없는지 본다.
- [x] 2.11 `pnpm exec eslint .`을 돌린다. `tools/validate-format.mjs`에서 2.6의 전역 선언으로 풀리지 않는 위반이 나오면 코드를 고치지 않고 그 규칙을 이 파일에서만 끈 뒤 7장에 규칙 이름을 적는다.
- [x] 2.12 **검증**: AC-06(`pnpm test`: 종료 코드 0, 통과한 테스트 1개 이상, 출력에 `spikes/` 없음), AC-07(`pnpm lint`), AC-08(스펙 6.3, `pnpm build` 뒤에), AC-04를 다시(5장의 명령. `dist/`에 `*.test.*`가 없다), AC-09(2.10).
- [x] 2.13 구현 변경과 이 계획 파일의 변경을 커밋한다.

### 단계 3: CI, 문서, 마지막 검사

**목표**: CI가 같은 명령을 돌리고 문서가 pnpm 기준이다. 로컬 관문(AC-12까지)을 모두 통과한다.
**위험**: 중간 · **상태**: 진행 중 (3.1~3.7 완료, 3.8 대기) · **수용 기준**: AC-10, AC-11, AC-12, AC-13

- [x] 3.1 `actions/checkout`과 `actions/setup-node`의 현재 메이저 버전을 공식 저장소에서 확인한다(`gh api repos/actions/checkout/releases/latest --jq .tag_name`, `setup-node`도 같게). 분석에서 확인하지 못한 값이다. 확인한 태그를 7장에 적는다.
- [x] 3.2 `.github/workflows/ci.yml`을 만든다.
  - `on`: `pull_request`와 `push`(`branches: [main]`)를 키로 갖는 매핑.
  - 워크플로 수준 `permissions: contents: read`. 작업에는 `permissions`를 두지 않는다. `continue-on-error` 없음.
  - 작업 하나, `ubuntu-latest`. 단계: checkout → setup-node(`node-version: 22`, `cache` 없음) → `run` 단계 7개를 이 순서로, 단계 하나에 명령 하나: `corepack enable pnpm`, `pnpm --version`, `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm validate:format`.
- [x] 3.3 `CLAUDE.md`를 고친다.
  - "지금 상태": 모노레포 골격(pnpm 워크스페이스, 빈 패키지 `core`·`cli`·`mcp`·`web`, CI)이 있고 기능 코드는 아직 없다고 쓴다.
  - "명령": `corepack enable pnpm` 뒤 `pnpm install`, `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm format`, `pnpm validate:format`. "F01 뒤에 생기는 것" 구분을 없앤다. 다음을 적는다: 설치는 `pnpm install`로 한다. 루트에서 `npm install`을 쓰지 않는다(워크스페이스 패키지를 연결하지 않고 `package-lock.json`을 다시 만든다). `npm run validate:format`은 계속 된다. `npm install`이 "실패한다"고 쓰지 않는다(확인하지 않은 동작이다).
  - "바꾸지 않는 결정"의 라이선스 항목: MPL-2.0, EPL-2.0 같은 약한 카피레프트는 수정 없이 의존성으로만 쓰는 한 허용하고, GPL과 AGPL은 쓰지 않는다고 쓴다.
  - 다른 절은 고치지 않는다.
- [x] 3.4 `pnpm exec prettier --write CLAUDE.md .github/workflows/ci.yml`로 두 파일만 서식을 맞춘다.
- [x] 3.5 **검증 (로컬 전체)**: CI와 같은 순서로 돌린다: `pnpm install --frozen-lockfile` → `pnpm build` → `pnpm test` → `pnpm lint` → `pnpm validate:format`. 이어서 AC-10(스펙 6.4), AC-12(스펙 6.6), AC-02, AC-03을 돌린다.
- [x] 3.6 **AC-11**: 1.1과 같은 명령으로 출력 파일만 `/tmp/spikes-after.sha256`으로 바꿔 "작업 후" 목록을 찍는다. `exit=0`이어야 한다. 이어서 `diff /tmp/spikes-before.sha256 /tmp/spikes-after.sha256; echo "exit=$?"`가 출력 없이 `exit=0`이어야 한다. 두 목록 중 하나라도 실패했거나 `diff`가 0이 아니면 커밋하지 않고 멈춘 뒤 사용자에게 알린다.
- [x] 3.7 구현 변경과 이 계획 파일의 변경(체크박스, 7장)을 커밋한다. 커밋 뒤 `git status --porcelain --untracked-files=no`의 출력이 비어야 한다(추적 중인 파일에 남은 변경이 없다). `git status --short`의 추적하지 않는 항목은 `spikes/`와 `docs/.yyy-workflow-state.json`뿐이어야 한다.
- [ ] 3.8 push하고 PR을 연 뒤 AC-13을 확인한다. push와 PR 생성은 사용자가 승인한 뒤에 한다. `gh pr checks --watch`는 보고된 검사가 아직 없으면 바로 끝나므로, 검사가 나타날 때까지 최대 2분 기다린 뒤에 지켜본다.

  ```bash
  (n=0
   until [ "$(gh pr checks --json name --jq length 2>/dev/null || echo 0)" -gt 0 ]; do
     n=$((n + 1)); [ "$n" -le 24 ] || { echo 'no checks after 2 minutes'; exit 1; }
     sleep 5
   done
   gh pr checks --watch); echo "exit=$?"
  ```

  `exit=0`이고 CI 작업이 성공(`pass`)으로 나와야 AC-13을 닫는다. 2분 안에 검사가 나타나지 않거나, 대기 중이거나, 실패면 닫지 않고 알린다.

## 5. 품질 관문

모두 저장소 루트에서 실행한다.

- [x] 설치: `pnpm install --frozen-lockfile`
- [x] 빌드: `pnpm build`
- [x] 테스트: `pnpm test`
- [x] 린트와 서식: `pnpm lint`
- [x] 형식 검사: `pnpm validate:format`, `npm run validate:format`
- [x] 스펙 6.1, 6.3, 6.4, 6.6의 검사 스크립트(AC-03, 08, 10, 12)
- [x] AC-04: 스펙 6.2의 마지막 줄(`! find ... | grep -q .`)은 `find`가 실패해도 통과하므로 아래 명령으로 바꿔 실행한다. `find`가 종료 코드 0으로 끝나고 출력이 비어야 한다.

  ```bash
  rm -rf packages/*/dist && pnpm build &&
  ls packages/{core,cli,mcp}/dist/index.{js,d.ts} packages/web/dist/index.html &&
  grep -q '<script type="module" src="/src/main.ts">' packages/web/index.html &&
  out=$(find packages/core/dist packages/cli/dist packages/mcp/dist packages/web/dist -name '*.test.*') &&
  test -z "$out"; echo "exit=$?"
  ```

- [x] AC-11: 3.6의 방식으로 실행한다
- [ ] PR 뒤 AC-13: 3.8의 명령이 `exit=0`이고 CI 작업이 성공이다

스펙 6장의 스크립트는 도구를 설치하기 전에 쓴 것이다. 도구의 API나 출력 형식이 달라 스크립트가 틀리면 같은 조건을 검사하도록 스크립트를 고치고 7장에 적는다. 조건을 낮추지 않는다.

## 6. 위험과 참고

### 위험

| 위험                                                                              | 가능성 | 대응                                                                                                    |
| --------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| 서식 명령이 `format/`, `docs/`, `spikes/`를 고친다                                | 중간   | 2.8에서 쓰기 전에 무시 경로를 확인한다. 2.9와 3.6에서 다시 확인한다                                     |
| 삭제 명령이 `spikes/canvas-perf/node_modules`에 닿는다                            | 낮음   | 삭제는 `rm -rf ./node_modules`, AC-04의 `rm -rf packages/*/dist`, 3장 "생성물 삭제"의 정확한 경로뿐이다 |
| 재서식이 검사 도구의 동작을 바꾼다                                                | 낮음   | 2.10에서 `OK:` 줄과 종료 코드를 기준선과 비교한다                                                       |
| `/tmp/spikes-before.sha256`이 사라진다(재부팅 등)                                 | 낮음   | 한 작업 세션 안에 끝낸다. 사라지면 AC-11을 증명할 수 없으므로 사용자에게 알린다                         |
| `corepack enable pnpm`이 실패한다                                                 | 낮음   | 1.4에서 멈추고 알린다. 우회하지 않는다                                                                  |
| pnpm 10이 설치 스크립트를 막아 도구가 돌지 않는다                                 | 낮음   | 1.13에서 확인하고 그 패키지만 `allowBuilds`에 넣은 뒤 `pnpm rebuild`한다                                |
| 전이 의존성의 `engines.node`가 `^22.13.0`보다 높다                                | 낮음   | 1.13의 engine 경고로 확인한다. 높으면 하한을 올리고 7장에 적는다                                        |
| CI의 corepack이 pnpm을 내려받지 못한다                                            | 낮음   | AC-13에서 드러난다. `pnpm --version` 단계가 먼저 실패해 원인이 분명하다                                 |
| 분석에서 확인하지 못한 API(`isPathIgnored`, `getFileInfo`, `pnpm -r list --json`) | 중간   | 실행해서 확인한다. 다르면 같은 조건의 스크립트로 바꾼다                                                 |
| `npm run`이 pnpm이 만든 `node_modules`에서 실패한다                               | 낮음   | AC-09가 단계 1에서 바로 확인한다                                                                        |

### 알려진 문제 (이 기능에서 고치지 않는다)

- **`tools/validate-format.mjs` 38행**: JSON 파싱에 실패하면 `load()`가 `err()`의 반환값(숫자)을 돌려준다. `loadAll`의 `.filter(Boolean)`을 통과해 `layouts`에 숫자가 들어가고 뒤의 `data.subjectArea` 접근에서 TypeError로 죽는다. 깨진 레이아웃 JSON에서만 나타난다. FR-08이 동작 변경을 막으므로 F02 이후에 고친다. 재서식 뒤에는 행 번호가 달라진다.
- `tools/validate-format.mjs`에는 테스트가 없다. F02에서 코어로 옮길 때 더한다.
- `docs/planning.md`는 Prettier 기본 서식과 다르다. `docs/`를 무시하므로 영향이 없다.

### 구현할 때 참고

- 스모크 테스트는 `exclude`로 빌드에서 빠지므로 `tsc`가 타입을 검사하지 않는다. Vitest와 ESLint만 본다. 빈 스캐폴드에서는 충분하고, 테스트의 타입 검사는 F02에서 정한다.
- `core`·`cli`·`mcp`는 `module: "NodeNext"`라 상대 경로 가져오기에 `.js` 확장자가 필요하다. F01에는 가져오기가 없어 영향이 없다.
- `web`은 `core`를 의존하지만 가져오지 않는다. 빌드 순서만 `core` 다음이 된다.
- macOS에서 설치하면 `fsevents`의 빌드가 막혔다는 경고가 날 수 있다(분석 4.2절, 미확인). 이 계획의 대상은 Linux(WSL, CI)다.
- `CLAUDE.md`의 "Test Environment"에 있는 `pnpm --filter web dev`는 F09에서 생긴다. 이번에는 `dev` 스크립트를 넣지 않는다.

## 7. 구현 기록

(구현하면서 적는다: 문서 커밋 해시(1.2), `allowBuilds`에 넣은 패키지, 끈 ESLint 규칙, 고친 검사 스크립트, 확인한 액션 버전, 올린 `engines.node` 하한. 이 절의 변경은 각 단계의 커밋에 넣는다)

### 단계 1 (2026-11-27)

- 문서 커밋(1.2): `af18457b68e1d4285ff0916f6ba4892ecab067ad`
- 만든 파일 16개(`pnpm-lock.yaml` 포함), 고친 파일 3개(`package.json`, `.gitignore`, 이 계획), 지운 파일 1개(`package-lock.json`, `git rm`). 루트 `./node_modules`를 지우고 다시 설치했다.
- `spikes/` 기준선(1.1): `exit=0`, 866줄.
- `allowBuilds`: 넣지 않았다. 설치 출력에 "Ignored build scripts"와 engine 경고가 없었다.
- `pnpm ignored-builds`(1.13): pnpm 10.34.9는 `node_modules/.modules.yaml`에 `ignoredBuilds` 키가 없으면 `node_modules`가 있어도 "Cannot identify as no node_modules found"를 출력한다(pnpm 소스 `getAutomaticallyIgnoredBuilds` 확인). 그래서 `.modules.yaml`에 `ignoredBuilds` 키가 없고 `pendingBuilds: []`인 것으로 차단된 빌드가 없음을 확인했다.
- `engines.node`: `^22.13.0` 그대로. 올리지 않았다.
- 검사 스크립트: 스펙 6.1(AC-03)은 고치지 않고 통과했다. AC-04는 5장의 명령을 그대로 썼다. AC-05는 `tsc --showConfig` 출력을 사람이 보고, 같은 출력의 `lib`에 `dom`이 없고 `types`가 `[]`인지 Node로 한 번 더 검사했다.
- 포매터 훅이 `pnpm-workspace.yaml`의 `'packages/*'`를 `"packages/*"`로 바꿨다. 단계 2의 `singleQuote` 설정 뒤 `pnpm format`에서 다시 바뀔 수 있다.

### 단계 2 (2026-11-27)

- 만든 파일 5개(`vitest.config.ts`, `packages/core/src/index.test.ts`, `.prettierrc.json`, `.prettierignore`, `eslint.config.js`), 고친 파일 5개(`package.json`, `tools/validate-format.mjs`, `README.md`, `pnpm-workspace.yaml`, 이 계획).
- `eslint.config.js`: `eslint/config`의 `defineConfig`, `globalIgnores`를 쓰고 `eslint-config-prettier`는 `eslint-config-prettier/flat`으로 가져온다.
- 2.8: AC-08이 `exit=0`. 읽기 전용 `prettier --check .`의 목록에 `spikes/`, `format/`, `docs/`, `dist/`, `pnpm-lock.yaml` 경로가 없었다. `eslint . -f json`이 검사한 파일도 `eslint.config.js`, `vitest.config.ts`, `packages/*/src`의 파일, `tools/validate-format.mjs`뿐이었다.
- 2.9 계획과 다른 점: `pnpm format` 앞뒤 `git status` 비교에 `tools/validate-format.mjs`, `README.md` 말고 `pnpm-workspace.yaml`도 새로 나왔다. 단계 1에서 포매터 훅이 큰따옴표로 바꿔 커밋한 것을 `singleQuote` 설정이 작은따옴표로 되돌린 것이다(`"packages/*"` → `'packages/*'`, 한 줄). 단계 1 기록에서 예상한 변경이고 `format/`, `docs/`, `spikes/` 경로는 나오지 않았다. 추적하지 않는 새 파일 `vitest.config.ts`, `index.test.ts`도 훅이 넣은 큰따옴표가 작은따옴표로 바뀌었다(`??` 표시는 그대로라 비교에는 안 나온다).
- 2.10: `git diff -w` 훑기에 더해, 바뀌기 전(`HEAD`)과 뒤의 `tools/validate-format.mjs`를 espree로 파싱해 위치 정보와 `raw`를 뺀 AST가 같고 주석 8개의 내용이 같음을 확인했다. `git diff --numstat` 기준 +187/-49줄.
- 2.11: `pnpm exec eslint .`이 위반 없이 통과했다. 끈 규칙은 없다.
- 검사 스크립트: 스펙 6.3(AC-08)은 고치지 않고 통과했다(`isPathIgnored`, `getFileInfo`가 분석이 가정한 대로 동작한다). AC-04는 5장의 명령을 그대로 썼다.

### 단계 3 (2026-11-27 12:29, 3.1~3.7)

- 만든 파일 1개(`.github/workflows/ci.yml`), 고친 파일 2개(`CLAUDE.md`, 이 계획).
- 액션 버전(3.1): `gh api repos/actions/<저장소>/releases/latest`로 확인했다. `actions/checkout`은 `v7.0.1`(2026-07-20), `actions/setup-node`는 `v7.1.0`(2026-10-08). 두 저장소 모두 `refs/tags/v7` 태그가 있음을 `gh api .../git/ref/tags/v7`로 확인하고 워크플로에 `@v7`로 적었다. setup-node v7의 `action.yml`에서 자동 캐시가 `packageManager`가 npm일 때만 켜진다는 설명(`package-manager-cache`)을 확인했다. 이 저장소는 pnpm이라 `cache`를 생략하면 캐시가 꺼진다.
- 작업 이름은 `check`.
- `CLAUDE.md`: "지금 상태", "명령" 절과 "바꾸지 않는 결정"의 라이선스 항목만 고쳤다. `## Design System`, `## Test Environment` 절은 그대로다(FR-10이 요구하는 변경이 없다).
- 3.4: `prettier --write`가 두 파일을 바꾸지 않았다(`unchanged`).
- 3.5: CI 순서 다섯 명령, `npm run validate:format`, AC-10, AC-12, AC-02, AC-03이 모두 종료 코드 0. 5장 관문을 채우려고 AC-04(5장 명령)와 AC-08(스펙 6.3)도 다시 돌렸고 둘 다 `exit=0`. `prettier --file-info`로 `ci.yml`이 `pnpm lint`의 서식 검사 대상(`ignored: false`)임을 확인했다.
- AC-11(3.6): "작업 후" 목록 `exit=0`, 866줄. `diff` 출력 없음, `exit=0`.
- 고친 검사 스크립트: 없다. 스펙 6.4, 6.6은 그대로 통과했다.
- 3.8(push, PR, AC-13)은 사용자 승인을 기다린다.

---

마지막 수정: 2026-11-27 12:29
상태: 진행 중 (단계 3, 3.8 대기)
