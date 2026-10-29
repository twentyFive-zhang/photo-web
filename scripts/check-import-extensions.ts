/**
 * 约定检查：admin/web 走 bundler 解析，相对导入一律不写 .js/.jsx 后缀；
 * api/shared 是 Node ESM（tsc 编译 + node 直跑），必须写 .js —— 该侧由
 * biome.json overrides 里的 useImportExtensions(forceJsExtensions) 把关。
 *
 * 本脚本只查「多写后缀」的方向，随 `bun run lint` 一起执行。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SCOPED_DIRS = ["apps/admin/src", "apps/web/src", "apps/web/app"];

const offenders: string[] = [];
let checked = 0;

function walk(dir: string) {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // 目录不存在（如 web/app）直接跳过
  }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
    } else if (/\.(ts|tsx)$/.test(name)) {
      const src = readFileSync(path, "utf8");
      const re = /(?:from|import)\s*["'](\.[^"']*?)\.(?:js|jsx)["']/g;
      for (const match of src.matchAll(re)) {
        offenders.push(`${path}: "${match[1]}.js|.jsx" 应去掉后缀`);
      }
      checked++;
    }
  }
}

for (const dir of SCOPED_DIRS) walk(dir);

if (offenders.length > 0) {
  console.error(
    `admin/web 相对导入不允许带 .js/.jsx 后缀（${offenders.length} 处）：\n` +
      offenders.map((line) => `  ${line}`).join("\n"),
  );
  process.exit(1);
}
console.log(`import extensions ok (${checked} files checked)`);
