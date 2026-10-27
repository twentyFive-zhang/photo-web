# ADR 0002: TypeScript 统一在 6.0.3，TS 7 延后至 7.1 stable

日期：2026-10-27
状态：已接受

## 背景

依赖升级时各 workspace 的 TypeScript 版本不一致（root ^6.0.3 / apps/web ^5 / apps/admin ~6.0.3 / apps/api ^6.0.2），目标是统一到最新版。npm latest 为 TypeScript 7.0.2（原生 Go 编译器，2026-07 发布）。

## 决策

全仓统一 TypeScript **6.0.3**（6.x 线 latest），**不采用 7.0.2**。

## 原因（均经官方来源核实）

1. **typescript@7.0.2 不包含 JS 编译器 API**。官方博客（Announcing TypeScript 7.0）明确 "it does not ship with an API"，新 API 预计随 7.1 发布（7.1.0-beta 已于 2026-10-20 发布）。
2. **NestJS 12 官方不支持 TS 7**：`@nestjs/cli`（依赖钉死 `typescript ~6.0.2`）在 TS7 下 `nest build` 直接崩溃（`getParsedCommandLineOfConfigFile is not a function`，见 nest-cli issues #3477/#3479）；维护者表态等编程 API 稳定后再适配。`nest build` 是 api 的构建与 dev watch 通道，绕不开。
3. Next.js 16.2.12+ 提供实验性 opt-in（`experimental.useTypeScriptCli`）支持 TS7，但属实验特性；社区并存 workaround（`npm:@typescript/typescript6` 别名）非官方，不引入。

## 影响

- 版本统一目标仍达成（四处收敛为一个精确 pin）。
- TS 7 升级单独立项，前置条件：**TS 7.1 stable**（编程 API 回归）且 **nest-cli #3479 关闭**（官方适配 TS7）。届时需重估 Next.js 侧是否已从实验 flag 转正。

## 参考

- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- https://github.com/nestjs/nest-cli/issues/3479
- https://github.com/vercel/next.js/pull/95831
