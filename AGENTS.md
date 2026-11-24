# photo-web 工程约定

对仓库内所有代码（`apps/*`、`packages/*`）生效。与 `docs/PROJECT.md`（产品与技术决策）、`GLOSSARY.md`（术语）、`docs/adr/`（架构决策）配合阅读。

## 源文件只用 TypeScript

- 一律使用 `.ts` / `.tsx`，**不创建任何 `.js` / `.jsx` / `.mjs` / `.cjs` 源文件**，无例外。
- 构建产物（`.next/`、`dist/`）与生成文件（`next-env.d.ts`、锁文件）不在此约束内。
- `apps/web/tsconfig.json` 已显式 `allowJs: false`，混入 JS 会直接编译报错。

## React 19 语法

1. **ref 作为普通 prop**：函数组件直接接收 `ref`，不使用 `forwardRef`。
2. **Context shorthand**：直接 `<SomeContext value={...}>`，不写 `<SomeContext.Provider>`。
3. **web 端数据变更优先 Server Actions**，配合 `useActionState` / `useOptimistic` / `useFormStatus`。
4. **admin 端表单维持 React Hook Form + Zod**（既定技术栈决策）；ref-as-prop 与 Context shorthand 在 admin 同样适用。
5. **SEO metadata 用 Next 的 metadata API**（页面级）；仅在 client 组件内需要动态控制时使用 React 19 的 `<title>` / `<meta>` 自动提升。
6. **`use()` API** 读取 promise / context（可替代 `useContext`）。

## 工具链边界

- Lint/格式化统一 Biome，不为 React 19 规则引入 ESLint（Biome 暂无 forwardRef 规则，靠本约定 + code review 执行）。
- 共享依赖版本在根 `package.json` 的 `catalog` 中单点管理，子包用 `catalog:` 引用；版本升级是显式动作。

## 相对导入的文件后缀

两类包，两种写法，都不是风格偏好而是模块解析机制决定的：

- **`apps/admin`、`apps/web`（bundler 解析，Vite/Next）**：相对导入**不写** `.js`/`.jsx` 后缀（`import { X } from "../lib/api"`）。
- **`apps/api`、`packages/shared`（Node ESM，`tsc` 编译后 `node` 直跑）**：相对导入**必须写** `.js` 后缀（`import { X } from "./foo.js"` 指向 `foo.ts` 源文件）——TS 不改写 import 路径，漏写会在 dist 运行时报 `ERR_MODULE_NOT_FOUND`。

防回归机制（双向把关，随 `bun run lint` 执行）：

- admin/web 侧多写后缀：`scripts/check-import-extensions.ts` 报错（Biome 无「禁止后缀」的现成规则，故用脚本）。
- api/shared 侧漏写后缀：`biome.json` overrides 中 `useImportExtensions` + `forceJsExtensions: true` 报错。

## 新 checkout 引导

- 全新 checkout（或删掉 `node_modules` 后）先跑 **`bun run bootstrap`**，再做其他事。它串起：`bun install` → build `packages/shared`（dist）→ `prisma generate`（Prisma Client）→ `next typegen`（`.next/types` 路由类型）。
- 只 `bun install` 不跑 bootstrap，会出两类**与代码无关的假红**：
  - `bun test`：`@prisma/client` 未生成，`prisma-errors.ts` 里 `instanceof PrismaClientKnownRequestError` 直接抛 TypeError，api 侧测试失败；
  - IDE 直接对 `apps/web` 跑 tsc 时：`.next/types` 缺失，`layout.tsx` 报 `Cannot find name 'LayoutProps'`（root `bun run typecheck` 不受影响，它已自带 generate 步骤）。
- bootstrap 幂等且无副作用，不依赖 `.env`，拉取后重跑无害；依赖有变动时建议重跑。
