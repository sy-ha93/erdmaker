# F01 `repo-scaffold` 스펙

작성: 2026-11-27 · 기준 문서: [stage1-backlog.md](../stage1-backlog.md) F01, [planning.md](../planning.md) 5.3절, `CLAUDE.md`

- **상태**: Draft
- **브랜치**: `feature/repo-scaffold`
- **분량**: 1일

## 1. 목적

기능 코드를 넣을 모노레포 골격을 만든다. 이 기능이 끝나면 `pnpm build`, `pnpm test`, `pnpm lint`가 빈 패키지에서 통과하고, CI가 같은 명령을 돌린다. 기능 코드는 넣지 않는다.

## 2. 지금 상태

- 루트에 `package.json`(devDependencies `ajv`, `yaml`, 스크립트 `validate:format`)과 `package-lock.json`이 있다.
- `tools/validate-format.mjs`가 유일한 코드다. `npm run validate:format`의 출력은 `OK: 10 entities, 11 relationships, ...`이고 종료 코드는 0이다.
- `packages/`, `.github/`, TypeScript·린트 설정이 없다. `LICENSE`(Apache-2.0)는 이미 있다.
- Node v22, corepack 0.36이 있다. pnpm은 전역에 없다.
- `spikes/canvas-perf/`는 추적하지 않는 폴더이고 자체 `package.json`, `node_modules`, `dist`를 갖고 있다.

## 3. 범위

**포함**: pnpm 워크스페이스, 빈 패키지 4개, TypeScript·Vitest·ESLint·Prettier 설정, GitHub Actions CI, 기존 형식 검사 유지.

**제외**: 기능 코드, PWA 설정(매니페스트, 서비스 워커), 배포·호스팅, npm 배포, React와 캔버스 라이브러리 추가(F09), CLI의 `bin` 등록(F02).

## 4. 정한 것

| 항목                                   | 선택                                                                                                          | 이유                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| pnpm 설치                              | corepack과 루트 `packageManager` 필드. 버전은 구현 시점의 pnpm 10 안정판 하나로 고정한다                      | 전역 설치 없이 로컬과 CI가 같은 버전을 쓴다                                                    |
| 패키지 이름                            | `@erdmaker/core`, `@erdmaker/cli`, `@erdmaker/mcp`, `@erdmaker/web`. 모두 `private: true`                     | 배포 이름은 릴리스(R)에서 정한다. `pnpm --filter web`은 스코프 없이도 `@erdmaker/web`에 맞는다 |
| 모듈 형식                              | ESM만 (`"type": "module"`)                                                                                    | 루트와 기존 도구가 이미 ESM이다                                                                |
| 라이브러리 빌드 (`core`, `cli`, `mcp`) | `tsc`로 `dist/`에 JS와 `.d.ts`를 낸다. 번들러를 쓰지 않는다                                                   | 의존성이 늘지 않는다. 번들이 필요한지는 배포할 때 정한다                                       |
| `web` 빌드                             | `tsc --noEmit` 뒤 `vite build`                                                                                | Vitest와 설정을 공유하고, F09의 PWA 틀이 그 위에 올라간다. Vite는 타입을 검사하지 않는다       |
| 테스트                                 | 루트의 Vitest 설정 하나로 전체를 돌린다                                                                       | 빈 패키지 4개에 설정을 따로 둘 이유가 없다                                                     |
| 린트                                   | ESLint flat config(루트 하나) + `typescript-eslint` 권장 규칙. `pnpm lint`가 `prettier --check`도 함께 돌린다 | CI의 명령 세 개로 서식까지 검사한다                                                            |
| `npm run validate:format`              | 루트 스크립트를 그대로 두어 npm과 pnpm 양쪽에서 실행된다                                                      | 수용 기준의 명령이 바뀌지 않는다. 스크립트는 `node`만 부른다                                   |
| CI에서 pnpm 준비                       | Node를 설정한 뒤 `corepack enable pnpm`                                                                       | 로컬과 같은 경로다. 액션을 더하지 않는다                                                       |

## 5. 요구사항

### FR-01 pnpm 워크스페이스

- 루트 `package.json`에 `packageManager`(pnpm 고정 버전)와 `engines.node`를 넣는다. `engines.node`는 CI가 쓰는 Node 22 계열로 닫아 `^22.x.y`로 쓴다. x.y는 설치한 도구들(Vite, Vitest, ESLint 등)의 `engines.node` 하한 중 가장 높은 값으로 구현할 때 정한다. `^22.13.0`이 될 것으로 보지만 확인하지 않았다.
- `devEngines`는 넣지 않는다(npm이 `npm run`을 거부하게 된다).
- `pnpm-workspace.yaml`의 대상은 `packages/*`뿐이다. `spikes/`는 워크스페이스에 넣지 않는다.
- `package-lock.json`을 지우고 `pnpm-lock.yaml`을 커밋한다.
- `.gitignore`에 `dist/`, `*.tsbuildinfo`, `coverage/`를 더한다.

### FR-02 빈 패키지 4개

- `packages/core`, `packages/cli`, `packages/mcp`, `packages/web`을 만든다. 각 패키지에는 `package.json`, `tsconfig.json`, 내용이 없는 `src/index.ts`를 둔다. `web`은 `src/index.ts` 대신 `index.html`과 `src/main.ts`를 두고, `index.html`이 `<script type="module" src="/src/main.ts">`로 `main.ts`를 읽는다. 이 밖의 소스는 FR-05의 스모크 테스트 하나뿐이다.
- `cli`, `mcp`, `web`은 `core`를 `workspace:*`로 의존한다. 빌드 순서는 pnpm의 의존 순서를 따른다.
- `core`의 `exports`는 JS(`./dist/index.js`)와 타입(`./dist/index.d.ts`)을 함께 가리킨다. 그래서 순서는 빌드 → 테스트 → 린트다.

### FR-03 TypeScript

- 루트 `tsconfig.base.json`에 공통 옵션(`strict`, ES2022, ESM, `moduleDetection: "force"`)을 두고 패키지가 이를 확장한다. `moduleDetection`이 없으면 내용이 없는 `src/index.ts`가 스크립트로 취급돼 나중에 가져올 때 TS2306이 난다.
- `core`, `cli`, `mcp`의 출력 설정은 `rootDir: src`, `outDir: dist`, `declaration: true`다. 빌드에서 `src/**/*.test.ts`를 빼서 테스트 파일이 `dist/`에 들어가지 않게 한다.
- `core`의 컴파일러 설정에는 `lib`에 DOM을 넣지 않고 `types`를 빈 배열로 둔다(`@types/node` 없음). 이것은 컴파일러 설정 수준의 점검일 뿐이다. 브라우저와 Node 양쪽에서 실제로 도는지의 보장과 어댑터 설계는 F02에서 한다.
- `cli`, `mcp`는 `@types/node`를 쓰고, `web`은 DOM `lib`를 쓴다.

### FR-04 루트 스크립트

| 스크립트               | 하는 일                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm build`           | 모든 패키지를 의존 순서로 빌드한다. `core`·`cli`·`mcp`는 `tsc`, `web`은 `tsc --noEmit && vite build` |
| `pnpm test`            | Vitest를 한 번 실행한다 (watch 아님)                                                                 |
| `pnpm lint`            | ESLint와 `prettier --check`                                                                          |
| `pnpm format`          | `prettier --write`                                                                                   |
| `pnpm validate:format` | 기존 그대로                                                                                          |

### FR-05 Vitest

- 대상은 `packages/*/src/**/*.test.ts`뿐이다.
- 테스트가 실제로 도는지 보이도록 `core`에 스모크 테스트 하나(`src/index.test.ts`)를 둔다. 나머지 패키지는 테스트 파일이 없어도 통과한다.

### FR-06 ESLint, Prettier

- 대상은 `packages/`, `tools/`, 루트의 설정 파일이다.
- 두 도구 모두 `spikes/`, `format/`, `docs/`, `**/dist/`, `pnpm-lock.yaml`을 무시한다. Prettier의 무시 목록은 `.prettierignore`에 둔다. `format/`의 예제는 F02의 바이트 단위 왕복 기준이라 서식 도구가 건드리면 안 된다.
- Prettier 설정은 기존 `tools/validate-format.mjs`에 맞춰 작은따옴표를 쓴다. 이 파일에 서식 변경이나 린트 수정이 필요하면 동작을 바꾸지 않는 범위에서만 한다.
- ESLint와 Prettier가 충돌하는 규칙은 `eslint-config-prettier`로 끈다.

### FR-07 CI

- `.github/workflows/ci.yml` 하나, 작업 하나. `on`은 `pull_request`와 `push`(`branches: [main]`)를 키로 갖는 매핑으로 쓴다.
- 단계 순서: checkout → Node 22 설정(`actions/setup-node`, `cache` 옵션 없음) → `corepack enable pnpm` → `pnpm --version` → `pnpm install --frozen-lockfile` → `pnpm build` → `pnpm test` → `pnpm lint` → `pnpm validate:format`. pnpm을 쓰는 단계는 모두 `corepack enable pnpm` 뒤에 온다. `run` 단계 하나에 명령 하나만 쓴다.
- 권한은 워크플로 수준의 `permissions`에 `contents: read`만 준다. 작업에는 `permissions`를 따로 두지 않는다. 작업과 단계에 `continue-on-error`를 쓰지 않는다. 배포 단계는 없다.

### FR-08 기존 형식 검사 유지

- `tools/validate-format.mjs`의 동작과 `validate:format` 스크립트를 바꾸지 않는다. `ajv`와 `yaml`은 루트 devDependencies에 그대로 둔다.
- `pnpm install` 뒤에 `npm run validate:format`과 `pnpm validate:format`이 같은 결과를 낸다.

### FR-09 의존성

- 외부 런타임 의존성을 새로 더하지 않는다. 패키지의 `dependencies`에는 `workspace:*`인 `@erdmaker/core`만 있다.
- 도구는 devDependencies로 더한다: `typescript`, `vitest`, `vite`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`, `prettier`, `@types/node`.
- 직접 의존성에 GPL, AGPL이 없어야 한다. 전이 의존성은 검사하지 않는다. MPL-2.0 같은 약한 카피레프트는 수정 없이 의존성으로 쓰는 한 허용한다.

### FR-10 문서 갱신

- `CLAUDE.md`의 "지금 상태"와 "명령" 절을 pnpm 기준으로 고친다(`npm install` → `corepack enable` 뒤 `pnpm install`).

## 6. 수용 기준

모두 저장소 루트에서, bash로, `corepack enable`을 한 뒤에 실행한다. `corepack enable`이 권한 문제로 실패하는 환경에서는 `pnpm` 대신 `corepack pnpm`을 쓴다. 통과 조건을 따로 적지 않은 것은 종료 코드 0이 통과다.

| #     | 요구사항     | 명령                                                                                                          | 통과 조건                                                                                                                                       |
| ----- | ------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 | FR-01        | `pnpm install --frozen-lockfile`                                                                              | 종료 코드 0                                                                                                                                     |
| AC-02 | FR-01        | `test ! -e package-lock.json && test -f pnpm-lock.yaml && node -p "require('./package.json').packageManager"` | 종료 코드 0이고 `pnpm@<버전>`이 나온다                                                                                                          |
| AC-03 | FR-01, FR-02 | 6.1                                                                                                           | 워크스페이스 패키지가 루트를 빼고 정확히 4개다                                                                                                  |
| AC-04 | FR-02~04     | 6.2                                                                                                           | `dist/`를 지우고 빌드하면 산출물이 모두 생긴다                                                                                                  |
| AC-05 | FR-03        | `pnpm --filter @erdmaker/core exec tsc --showConfig`                                                          | `lib`에 `dom`이 없고 `types`가 `[]`다                                                                                                           |
| AC-06 | FR-05        | `pnpm test`                                                                                                   | 종료 코드 0. 통과한 테스트가 1개 이상이고 `spikes/` 경로가 출력에 없다                                                                          |
| AC-07 | FR-06        | `pnpm lint`                                                                                                   | 종료 코드 0                                                                                                                                     |
| AC-08 | FR-06        | 6.3 (AC-04 뒤에 실행)                                                                                         | 무시 대상 경로는 무시되고 소스 경로는 검사 대상이다                                                                                             |
| AC-09 | FR-08        | `npm run validate:format` 과 `pnpm validate:format`                                                           | 둘 다 종료 코드 0이고 `OK: 10 entities, 11 relationships, 1 subtype clusters, 3 subject areas, 2 layouts, 5 words, 4 terms, 8 domains`가 나온다 |
| AC-10 | FR-09        | 6.4                                                                                                           | 직접 의존성의 라이선스에 GPL, AGPL이 없다                                                                                                       |
| AC-11 | 제약         | 6.5                                                                                                           | `spikes/`의 파일 목록과 해시가 작업 전과 같다                                                                                                   |
| AC-12 | FR-07        | 6.6                                                                                                           | 워크플로의 트리거와 실행 단계가 FR-07과 같다                                                                                                    |
| AC-13 | FR-07        | PR을 연 뒤 `gh pr checks`                                                                                     | CI 작업이 성공으로 나온다                                                                                                                       |

### 6.1 AC-03 워크스페이스 구성

```bash
pnpm -r list --depth -1 --json | node --input-type=module -e '
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
const got = JSON.parse(readFileSync(0, "utf8"))
  .map((p) => `${p.name} ${relative(process.cwd(), p.path)}`)
  .filter((s) => !s.endsWith(" "))
  .sort();
assert.deepEqual(got, [
  "@erdmaker/cli packages/cli",
  "@erdmaker/core packages/core",
  "@erdmaker/mcp packages/mcp",
  "@erdmaker/web packages/web",
]);'
```

### 6.2 AC-04 빌드 산출물

```bash
rm -rf packages/*/dist && pnpm build &&
ls packages/{core,cli,mcp}/dist/index.{js,d.ts} packages/web/dist/index.html &&
grep -q '<script type="module" src="/src/main.ts">' packages/web/index.html &&
! find packages/*/dist -name '*.test.*' | grep -q .
```

### 6.3 AC-08 무시 경로

```bash
node --input-type=module -e '
import assert from "node:assert/strict";
import { ESLint } from "eslint";
import { getFileInfo } from "prettier";
const ignored = [
  "spikes/canvas-perf/measure.mjs",
  "format/v0/examples/shop/model.yaml",
  "docs/planning.md",
  "packages/core/dist/index.js",
  "pnpm-lock.yaml",
];
const included = ["packages/core/src/index.ts", "tools/validate-format.mjs"];
const eslint = new ESLint();
const prettierIgnored = async (f) => (await getFileInfo(f, { ignorePath: ".prettierignore" })).ignored;
for (const f of ignored) {
  assert.equal(await eslint.isPathIgnored(f), true, `eslint: ${f}`);
  assert.equal(await prettierIgnored(f), true, `prettier: ${f}`);
}
for (const f of included) {
  assert.equal(await eslint.isPathIgnored(f), false, `eslint: ${f}`);
  assert.equal(await prettierIgnored(f), false, `prettier: ${f}`);
}'
```

### 6.4 AC-10 직접 의존성 라이선스

```bash
node --input-type=module -e '
import { readFileSync, readdirSync } from "node:fs";
const read = (f) => JSON.parse(readFileSync(f, "utf8"));
for (const dir of [".", ...readdirSync("packages").map((p) => `packages/${p}`)]) {
  const pkg = read(`${dir}/package.json`);
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    const license = String(read(`${dir}/node_modules/${name}/package.json`).license);
    console.log(dir, name, license);
    if (/\bA?GPL/i.test(license)) process.exitCode = 1;
  }
}'
```

### 6.5 AC-11 `spikes/` 보존

구현을 시작하기 전에 한 번 실행한다.

```bash
spikes_list() {
  find spikes -type f -print0 | sort -z | xargs -0 sha256sum
  find spikes -type l -printf '%p -> %l\n' | sort
}
spikes_list > /tmp/spikes-before.sha256
```

일반 파일은 해시로, 심볼릭 링크는 가리키는 경로로 비교한다.

구현이 끝난 뒤에 실행한다. 출력이 없어야 한다.

```bash
spikes_list() {
  find spikes -type f -print0 | sort -z | xargs -0 sha256sum
  find spikes -type l -printf '%p -> %l\n' | sort
}
spikes_list | diff /tmp/spikes-before.sha256 -
```

### 6.6 AC-12 워크플로 내용

```bash
node --input-type=module -e '
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
const wf = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
assert.ok("pull_request" in wf.on);
assert.deepEqual(wf.on.push.branches, ["main"]);
const jobs = Object.values(wf.jobs);
assert.equal(jobs.length, 1, "exactly one job");
assert.deepEqual(wf.permissions, { contents: "read" });
assert.equal(jobs[0].permissions, undefined);
const steps = jobs[0].steps;
assert.ok([jobs[0], ...steps].every((x) => !("continue-on-error" in x)), "no continue-on-error");
const checkout = steps.findIndex((s) => s.uses?.startsWith("actions/checkout@"));
const setupNode = steps.findIndex((s) => s.uses?.startsWith("actions/setup-node@"));
const firstRun = steps.findIndex((s) => s.run);
assert.ok(checkout >= 0 && checkout < setupNode, "checkout comes before setup-node");
assert.ok(setupNode < firstRun, "setup-node comes before every run step");
assert.equal(String(steps[setupNode].with?.["node-version"]), "22");
assert.equal(steps[setupNode].with?.cache, undefined);
assert.deepEqual(
  steps.filter((s) => s.run).map((s) => s.run.trim()),
  [
    "corepack enable pnpm",
    "pnpm --version",
    "pnpm install --frozen-lockfile",
    "pnpm build",
    "pnpm test",
    "pnpm lint",
    "pnpm validate:format",
  ],
);'
```

## 7. 구현할 때 확인할 것

- **pnpm 10의 설치 스크립트 차단**: pnpm 10은 의존성의 설치 스크립트를 기본으로 막는다. `esbuild`(Vite의 의존성)에서 경고가 나면 `pnpm-workspace.yaml`의 `onlyBuiltDependencies`에 `esbuild`만 허용한다.
- **`tools/validate-format.mjs`의 린트 결과**: 권장 규칙을 어기는 곳이 있는지는 실행해 봐야 안다. 수정이 동작에 영향을 주면 그 규칙을 이 파일에서만 끄고 AC-09로 확인한다.
- **6장의 검사 스크립트**는 도구를 설치하기 전에 쓴 것이라 실행해 보지 않았다. 도구의 API나 출력 형식이 달라 스크립트가 틀리면, 같은 조건을 검사하도록 스크립트를 고친다(조건을 낮추지 않는다).
- **AC-13**은 push 뒤에만 확인할 수 있다. 로컬에서는 AC-12까지가 관문이다.
