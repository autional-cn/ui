#!/usr/bin/env node
// 图标套件闸门（verify 第 12 道）
//
// 守的是「浏览器标签页上那一眼」——用户最先看到、也最容易各站不一致的东西。
// 实测（2026-09-29）修复前的状态：
//   14 站里只有 3 站（developer/docs/web）有完整图标组；
//   8 个 SPA 站只声明 1 个 link；user 声明 0 个；authenticator 声明 0 个；
//   status 的 /favicon-32x32.png 返回的是 SPA fallback（text/html 947B）——
//   文件根本不存在，被前端路由掩盖，肉眼与普通抓取都看不出来。
//
// 断言四件事：
//   ① 每站声明 standard 图标组（>=4 个 rel=icon + apple-touch + manifest）
//   ② 引用的本地文件**真的存在**于该站 public/（这正是 status 那种「被路由掩盖的 404」）
//   ③ theme-color 是**字面量**：它由浏览器消费、不经过 CSS，写 var() 等于没写
//   ④ site.webmanifest 的 theme_color 与页面 meta 一致（同一个值不该有两个来源）
//
// 用法: node scripts/check-icons.mjs [--json]

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, loadTokens, resolvedIn } from './lib/tokens.mjs';

const AS_JSON = process.argv.includes('--json');
const SITES = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');
const CONFIG = join(ROOT, 'verification', 'consumer-targets.json');

const REQUIRED_ICON = 4;   // ico + 32 + 16 + svg
const problems = [];
const rows = [];

if (!existsSync(SITES)) {
  console.log('check-icons：本次工作区没有 sites/，跳过（CI 里同样跳过）');
  process.exit(0);
}

const CT = JSON.parse(readFileSync(CONFIG, 'utf8'));
const publicDirs = CT.publicDirs || {};
const THEME_COLORS = CT.themeColors || {};
const ICON_SOURCES = (CT.iconSources || {}).files || [];
// 与 sync-consumers 用同一份声明，这样「theme-color 的唯一来源」是 consumer-targets.json，
// 而不是散在 14 个站点的 HTML 里。页面 <meta> 是手写的，由本闸门断言它与声明一致。
const RES = resolvedIn(loadTokens(), {});
const declaredThemeColor = (site) => {
  const raw = THEME_COLORS[site] || THEME_COLORS.default || null;
  if (!raw) return null;
  const m = /^\{([^}]+)\}$/.exec(raw);
  return m ? (RES[m[1]] || null) : raw;
};
const SKIPDIR = new Set(['node_modules', '.git', 'dist', '.astro', '.next', 'public', 'build', 'coverage']);
function walk(d, out, depth) {
  if (depth > 4) return out;
  let es; try { es = readdirSync(d, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of es) {
    if (SKIPDIR.has(e.name)) continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else if (['.astro', '.html'].includes(extname(e.name))) out.push(p);
  }
  return out;
}

for (const site of readdirSync(SITES)) {
  const dir = join(SITES, site);
  if (!statSync(dir).isDirectory()) continue;
  const pubRel = publicDirs[site];
  if (!pubRel) { problems.push('I0 ' + site + '：consumer-targets.json 的 publicDirs 缺少该站点'); continue; }
  const pubDir = join(dir, pubRel);

  // 找声明图标的 head 文件
  const candidates = walk(dir, [], 0).filter((f) => /rel=["']?(?:shortcut )?icon["']?/i.test(readFileSync(f, 'utf8')));
  if (!candidates.length) { problems.push('I1 ' + site + '：没有任何文件声明 rel="icon"'); continue; }
  const headFile = candidates[0];
  const text = readFileSync(headFile, 'utf8');
  const rel = relative(SITES, headFile).replace(/\\/g, '/');

  const icons = [...text.matchAll(/<link\b[^>]*\brel=["']?(?:shortcut )?icon["']?[^>]*>/gi)].map((m) => m[0]);
  const apple = /rel=["']?apple-touch-icon["']?/i.test(text);
  const manifest = /rel=["']?manifest["']?/i.test(text);
  const tcMatch = text.match(/<meta\s+name=["']theme-color["'][^>]*content=["']([^"']*)["']/i);
  const tc = tcMatch ? tcMatch[1] : null;

  if (icons.length < REQUIRED_ICON) problems.push('I2 ' + site + '：只声明了 ' + icons.length + ' 个 rel="icon"，应有 >= ' + REQUIRED_ICON + '（' + rel + '）');
  if (!apple) problems.push('I3 ' + site + '：没有 apple-touch-icon（' + rel + '）');
  if (!manifest) problems.push('I4 ' + site + '：没有 manifest 链接（' + rel + '）');
  if (!tc) problems.push('I5 ' + site + '：没有 theme-color（' + rel + '）');
  else if (/var\(/.test(tc)) problems.push('I6 ' + site + '：theme-color 是 var()（' + tc + '）——该值由浏览器消费、不经过 CSS，写 var() 等于没写');

  // 引用的本地文件是否真的存在（catch 掉「被 SPA fallback 掩盖的 404」）
  const hrefs = [...text.matchAll(/<link\b[^>]*\brel=["']?(?:shortcut )?icon["']?[^>]*\bhref=["']([^"']+)["']/gi)]
    .concat([...text.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']?(?:shortcut )?icon["']?/gi)])
    .map((m) => m[1]);
  const appleHref = (text.match(/<link\b[^>]*rel=["']?apple-touch-icon["']?[^>]*href=["']([^"']+)["']/i) || [])[1];
  if (appleHref) hrefs.push(appleHref);
  const missingFiles = [];
  for (const h of new Set(hrefs)) {
    if (/^https?:/i.test(h)) continue;               // 外部绝对 URL（CDN）不查本地
    const clean = h.split('?')[0].split('#')[0];
    if (!clean.startsWith('/')) { missingFiles.push(h + '(非绝对路径)'); continue; }
    if (!existsSync(join(pubDir, clean.slice(1)))) missingFiles.push(h);
  }
  if (missingFiles.length) problems.push('I7 ' + site + '：引用的文件在 ' + pubRel + '/ 里不存在 → ' + missingFiles.join(', ') + '（浏览器会拿到 SPA fallback 的 text/html，肉眼看不出来）');

  // site.webmanifest 与 meta 的 theme_color 一致性
  const wmPath = join(pubDir, 'site.webmanifest');
  let wmTc = null;
  if (!existsSync(wmPath)) problems.push('I8 ' + site + '：' + pubRel + '/site.webmanifest 不存在');
  else {
    try { wmTc = JSON.parse(readFileSync(wmPath, 'utf8')).theme_color || null; } catch (e) { problems.push('I9 ' + site + '：site.webmanifest 不是合法 JSON'); }
    if (wmTc && tc && wmTc !== tc) problems.push('I10 ' + site + '：site.webmanifest 的 theme_color=' + wmTc + ' 与页面 meta 的 ' + tc + ' 不一致——同一个值不该有两个来源');
  }

  const declared = declaredThemeColor(site);
  if (declared && tc && tc !== declared) {
    problems.push('I11 ' + site + '：页面 theme-color=' + tc + ' 与 consumer-targets.json 声明的 ' + declared + ' 不一致——theme-color 只能有一个来源');
  }
  // 逐字节漂移校验：站点 public/ 里的图标必须与 ui/assets 的权威产物完全一致。
  // 这是「有交付通道」与「有交付通道且不漂移」的区别——没有这一步，
  // 手工放进去的图标仍然会在下一次被人悄悄换掉。
  for (const s of ICON_SOURCES) {
    const authPath = join(ROOT, s.from);
    const copyPath = join(pubDir, s.to);
    if (!existsSync(authPath)) { problems.push('I12 ' + site + '：权威图标不存在 ' + s.from); continue; }
    if (!existsSync(copyPath)) { problems.push('I13 ' + site + '：' + s.to + ' 未下发到 ' + pubRel + '/'); continue; }
    const a = createHash('sha256').update(readFileSync(authPath)).digest('hex').slice(0, 12);
    const b = createHash('sha256').update(readFileSync(copyPath)).digest('hex').slice(0, 12);
    if (a !== b) problems.push('I14 ' + site + '：' + s.to + ' 与权威不一致（' + b + ' != ' + a + '）——重新生成：pnpm sync:consumers --write');
  }

  rows.push({ site, icons: icons.length, apple, manifest, themeColor: tc, manifestThemeColor: wmTc, declared, head: rel });
}

if (AS_JSON) console.log(JSON.stringify({ rows, problems }, null, 2));
else {
  console.log('图标套件闸门：' + rows.length + ' 个站点');
  console.log('');
  console.log('  站点'.padEnd(17) + 'icon  apple  manifest  theme-color   webmanifest');
  for (const r of rows) {
    console.log('  ' + r.site.padEnd(15) + String(r.icons).padStart(4) + String(r.apple ? 'Y' : 'N').padStart(7) + String(r.manifest ? 'Y' : 'N').padStart(10) + '  ' + String(r.themeColor || '（无）').padEnd(12) + (r.manifestThemeColor || '（无）'));
  }
  console.log('');
  for (const p of problems) console.log('  [ERROR] ' + p);
  console.log(problems.length ? '结论：图标套件有 ' + problems.length + ' 项不达标' : '结论：图标套件一致（' + rows.length + ' 站）');
}
process.exit(problems.length ? 1 : 0);
