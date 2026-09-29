#!/usr/bin/env node
// check-non-tenant — 各 portal 的「业务路由首段」名单是否与自己的路由表一致
// 用法: node scripts/check-non-tenant.mjs
//
// 背景（2026-09-29 实测）：extractSlugFromPath 只能靠 URL 形状判断首段是不是租户。
// 「这个首段是不是本站点自己的路由」是**应用知识**，通用层无从得知，所以由各 portal
// 在启动时调用 registerNonTenantSegments 注册。名单缺席时的实际后果：
//   /settings → 租户 'settings'、/users/123 → 'users'、/dashboard → 'dashboard'
//   即**一切业务路由**都被判成租户，发出毫无意义的品牌查询（还可能套上错误的品牌）。
//
// 本闸门把「声明」与「事实」钉在一起：名单由 App.tsx 的路由表机械派生，
// 派生规则与生成名单时完全一致——取每条 <Route path> 的首段，跳过通配 * 与参数 :param，
// 并跳过通用层 RESERVED_SEGMENTS 已覆盖的基础设施段。改了路由却不同步名单，这里就失败。
// 没有这道闸门，那份名单会像所有手写名单一样慢慢腐烂。

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from './lib/tokens.mjs';

const SITES = resolve(ROOT, '..', 'sites');

// 与 packages/shared/src/auth/slug-from-url.ts 的 RESERVED_SEGMENTS 保持一致。
// 这些是基础设施段，由通用层负责，不该出现在各 portal 的业务名单里。
const RESERVED = ['oauth', 'bff', 'api', 'api-v1', 'health', 'metrics', 'assets', 'docs', 'scalar', 'fonts', 'env.js', 'sdk', 'static'];

// 派生规则——必须与生成 non-tenant-segments.ts 时的规则逐字一致。
function deriveSegments(appTsx) {
  const paths = Array.from(readFileSync(appTsx, 'utf8').matchAll(/<Route[^>]*?\spath="([^"]*)"/g)).map((m) => m[1]);
  return Array.from(new Set(
    paths
      .map((p) => p.replace(/^\/+/, '').split('/')[0])
      .filter((x) => x && x !== '*' && x.indexOf(':') !== 0)
      .map((x) => x.toLowerCase()),
  )).filter((x) => RESERVED.indexOf(x) < 0).sort();
}

function declaredSegments(file) {
  const t = readFileSync(file, 'utf8');
  const m = /export const NON_TENANT_SEGMENTS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(t);
  if (!m) return null;
  return Array.from(m[1].matchAll(/'([^']*)'/g)).map((x) => x[1]).sort();
}

if (!existsSync(SITES)) {
  console.log('核对业务路由名单：本次工作区没有 sites/，跳过（CI 里同样跳过）');
  process.exit(0);
}

const problems = [];
const info = [];
let checked = 0;

for (const site of readdirSync(SITES)) {
  const sitePath = join(SITES, site);
  if (!statSync(sitePath).isDirectory()) continue;
  const appsDir = join(sitePath, 'apps');
  if (!existsSync(appsDir)) continue;
  for (const app of readdirSync(appsDir)) {
    const src = join(appsDir, app, 'src');
    const appTsx = join(src, 'App.tsx');
    if (!existsSync(appTsx)) continue;

    const expected = deriveSegments(appTsx);
    const declFile = join(src, 'non-tenant-segments.ts');

    // 没有路由的站点（brand 是无路由单页）：无可注册，属正常。
    if (expected.length === 0 && !existsSync(declFile)) {
      info.push(site + '：路由表里没有可注册的业务首段（无路由或全是租户绑定），无需注册模块');
      continue;
    }
    if (!existsSync(declFile)) {
      problems.push('NT1 ' + site + '：App.tsx 有 ' + expected.length + ' 个业务路由首段，但没有 src/non-tenant-segments.ts —— 业务路由会被判成租户');
      continue;
    }

    checked++;
    const declared = declaredSegments(declFile);
    if (declared === null) { problems.push('NT2 ' + site + '：non-tenant-segments.ts 里找不到 NON_TENANT_SEGMENTS 数组声明'); continue; }

    const missing = expected.filter((x) => declared.indexOf(x) < 0);
    const extra = declared.filter((x) => expected.indexOf(x) < 0);
    if (missing.length || extra.length) {
      if (missing.length) problems.push('NT3 ' + site + '：路由表里有、名单里缺 ' + missing.length + ' 段：' + missing.slice(0, 10).join(', ') + (missing.length > 10 ? ' …' : ''));
      if (extra.length) problems.push('NT4 ' + site + '：名单里有、路由表里没有 ' + extra.length + ' 段：' + extra.slice(0, 10).join(', ') + '（路由改名/删除后没同步，会误伤同名真实租户）');
      continue;
    }

    // 名单对了还不够——必须真的被调用。注册模块是副作用式 import，没人 import 就等于没注册。
    const mainTsx = join(src, 'main.tsx');
    if (!existsSync(mainTsx) || mainTsx && !/import\s+'\.\/non-tenant-segments'/.test(readFileSync(mainTsx, 'utf8'))) {
      problems.push('NT5 ' + site + '：main.tsx 没有 import \'./non-tenant-segments\' —— 名单存在但从未注册');
      continue;
    }
    info.push(site + '：' + declared.length + ' 段业务路由首段，已注册且与路由表一致');
  }
}

console.log('业务路由名单核对：检查 ' + checked + ' 个 portal');
for (const i of info) console.log('  [INFO ] ' + i);
for (const p of problems) console.log('  [ERROR] ' + p);
console.log('');
if (problems.length) {
  console.log('结论：业务路由名单与路由表不一致（' + problems.length + ' 处）。');
  console.log('      修法：按 App.tsx 重新派生名单并更新 apps/<app>/src/non-tenant-segments.ts。');
  process.exit(1);
}
console.log('结论：各 portal 的业务路由名单与自己的路由表一致，且均已注册');
