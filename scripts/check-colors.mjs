#!/usr/bin/env node
// 非设计系统色值闸门（verify 第 11 道）
//
// 判据不是「用了不在设计系统里的色就失败」—— 那会把第三方品牌色（Google/微软/支付宝图标）
// 和书法性的装饰色一起判死，信号会被淹没。真正要抓的是这一种：
//   **你重新发明了一个已经存在的令牌。**
// 即：某处写死的色值与设计系统某个令牌的 CIE76 dE < NEAR_DUPLICATE。
// 这种色值看起来"是新的"，实际只是同一颜色的另一种写法，改令牌不会传导到这里，
// 各门户于是从这些看不见的裂缝里重新漂开。
//
// 分两类输出：
//   NEAR  → 与已有令牌近似（dE < 4）：ERROR，应当改用令牌
//   NEW   → 确实是新的色：INFO，列出来供人工判断（可能是第三方品牌色，也可能是真的该进设计系统）
//
// 排除（每一条都是踩过的坑，见 // 注释）：
//   - **/generated/**、scripts/generate/  : 生成文件的 JSDoc @example 里有色值，第一次盘点
//                                           把 #0066cc x36 当成了最大簇，全在这里
//   - packages/tailwind-preset|tokens|ui/ : 设计系统被**投递**到站点的副本，色值本来就在
//   - public/                             : 第三方 vendored 产物
//   - *.test.*/*.spec.*/*.config.*/*.d.ts : 断言、工具清单、类型声明
//
// 用法: node scripts/check-colors.mjs [--json]

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import { ROOT, loadTokens, resolvedIn, parseHex, stripMeta, flatten } from './lib/tokens.mjs';

const AS_JSON = process.argv.includes('--json');
const SITES = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');
const NEAR_DUPLICATE = 4;   // CIE76 dE 阈值：低于此视为「同一颜色的另一种写法」
const HEX = /#[0-9a-fA-F]{6}\b/g;

// 第三方品牌色白名单：这些**不该**改成令牌，改了才是错的。
// 每一条都注明来源，避免以后有人以为是漏网的。
const THIRD_PARTY = new Map([
  ['#4285f4', 'Google 品牌蓝'], ['#ea4335', 'Google 品牌红'],
  ['#fbbc05', 'Google 品牌黄'], ['#34a853', 'Google 品牌绿'],
  ['#0078d4', 'Microsoft 品牌蓝'], ['#00a4ef', 'Microsoft 品牌蓝(旧)'], ['#107c10', 'Microsoft 品牌绿'],
  ['#1677ff', '支付宝品牌蓝'], ['#21759b', 'WordPress 品牌蓝'],
  ['#e4393c', '京东品牌红'], ['#ff9900', 'Amazon 品牌橙'],
  ['#cb3837', 'npm 品牌红'], ['#24292f', 'GitHub 品牌黑'],
  ['#ff0000', 'YouTube 品牌红'],
  ['#000000', '纯黑（描边/图标底色，非设计系统色阶）'],
  ['#ffffff', '纯白'],
]);

// 整体排除的文件：**第三方品牌色注册表**。身份提供方图标（Google/微软/微信/GitHub/Stripe/…）
// 用的就是各家官方的品牌色，把它们改成设计系统令牌是**错**的——那会让 Google 的图标不是 Google 的蓝。
// 这类文件的每一行都是第三方品牌定义，不构成「Autional 自己的设计决定」，因此整文件排除。
// 注意：这是按「文件性质」排除，不是按色值排除——白名单开得越宽越容易把真问题一起放行。
const THIRD_PARTY_FILES = [
  /\/apps\/authenticator-app\/src\/lib\/icons\.ts$/,
];

const toRgb = (h) => { const c = parseHex(h); return c ? [c.r, c.g, c.b] : null; };
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
function rgbToLab(rgb) {
  const r = lin(rgb[0]), g = lin(rgb[1]), b = lin(rgb[2]);
  const x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
  const z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x / 0.95047) - f(y)), 200 * (f(y) - f(z / 1.08883))];
}
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

if (!existsSync(SITES)) {
  console.log('check-colors：本次工作区没有 sites/，跳过（CI 里同样跳过）');
  process.exit(0);
}

// ── 设计系统的全部色值（所有上下文合并，任一上下文里是令牌即算已知）──────────
const T = loadTokens();
const PROFILES = Object.keys(T.profiles).filter((p) => Object.keys(flatten(stripMeta(T.profiles[p]))).length > 0);
// 只取**亮色**上下文作为比对目标。
// 曾经的写法把暗色上下文也算进来，结果出了两处假阳性：暗色主题把中性色阶**反相**了
// （dark 的 neutral.50 = #0f1a2e 是深色），于是站点里正常的深色 #0f172a 被判定成
// 「≈ neutral.50」。反相色阶不是「你该用的令牌」，不能当比对目标。
const contexts = [{ profile: null, variant: null }, { profile: null, variant: 'dark' }];
for (const p of PROFILES) { contexts.push({ profile: p, variant: null }); contexts.push({ profile: p, variant: 'dark' }); }
// 「这算不算设计系统的色」用**全部上下文**判定——#0a2940 是暗色的 bg-surface，必须能匹配上。
const dsColors = new Map();  // hex -> token 名
for (const ctx of contexts) {
  const R = resolvedIn(T, ctx);
  for (const [k, v] of Object.entries(R)) {
    if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) continue;
    const h = v.toLowerCase();
    if (!dsColors.has(h)) dsColors.set(h, k);
  }
}

// 但「你该改用哪个令牌」的**建议目标**只取亮色上下文，外加暗色里的非中性令牌。
// 原因：暗色主题把中性色阶**整体反相**（dark neutral.50 = #0f1a2e 是深色），
// 拿反相值当建议目标会给出荒谬结论——站点里正常的深色 #0f172a 会被建议改用
// 「neutral.50」，而 neutral.50 在亮色下是 #fafbfc（近白）。
// 暗色里 primary/sky/amber/chart/bg/text/border 不是简单的反相，保留。
const adviceColors = new Map();
for (const ctx of contexts) {
  const R = resolvedIn(T, ctx);
  for (const [k, v] of Object.entries(R)) {
    if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) continue;
    if (ctx.variant === 'dark' && /^color\.neutral\./.test(k)) continue;
    const h = v.toLowerCase();
    if (!adviceColors.has(h)) adviceColors.set(h, k);
  }
}
const dsLabs = [...adviceColors.entries()].map(([h, name]) => ({ h, name, lab: rgbToLab(toRgb(h)) }));

// 文件级豁免：与 known-issues 同样的模式（必须有 reason / owner / expires）。
// 用来登记「已知但需要专门处置而不是机械替换」的文件，例如整份手写的暗色主题覆盖——
// 正确的修法是改用设计系统的暗色令牌（P6 的工作），不是把 slate 色号逐一换掉。
const EXEMPT_PATH = join(ROOT, 'verification', 'color-exemptions.json');
const TODAY = new Date().toISOString().slice(0, 10);
let exemptions = [];
if (existsSync(EXEMPT_PATH)) exemptions = JSON.parse(readFileSync(EXEMPT_PATH, 'utf8')).exemptions || [];
const expiredEx = exemptions.filter((e) => e.expires && e.expires < TODAY);
const exemptFor = (rel) => exemptions.find((e) => rel.indexOf(e.match) >= 0);

const SKIPDIR = new Set(['node_modules', '.git', 'dist', '.astro', '.next', 'public', 'build', 'coverage', 'generated', '.turbo']);
const SKIPREL = [/\/packages\/tailwind-preset\//, /\/packages\/tokens\//, /\/packages\/ui\//, /\/scripts\/generate\//];
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.astro', '.html', '.vue', '.svelte']);
function walk(d, out) {
  let es; try { es = readdirSync(d, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of es) {
    if (SKIPDIR.has(e.name)) continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXTS.has(extname(e.name))) out.push(p);
  }
  return out;
}

const near = [];
const fresh = new Map();
const perSite = [];
for (const site of readdirSync(SITES)) {
  const dir = join(SITES, site);
  if (!statSync(dir).isDirectory()) continue;
  let nNear = 0; const seen = new Set();
  for (const f of walk(dir, [])) {
    const rel = f.replace(/\\/g, '/');
    const base = rel.split('/').pop();
    if (/\.(test|spec)\./.test(base) || /\.config\./.test(base) || /\.d\.ts$/.test(base)) continue;
    if (SKIPREL.some((rx) => rx.test(rel))) continue;
    if (THIRD_PARTY_FILES.some((rx) => rx.test(rel))) continue;
    const ex = exemptFor(rel);
    if (ex) continue;
    const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    text.split('\n').forEach((line, i) => {
      for (const m of (line.match(HEX) || [])) {
        const h = m.toLowerCase();
        if (dsColors.has(h) || THIRD_PARTY.has(h)) continue;
        const lab = rgbToLab(toRgb(h));
        let best = { d: Infinity, name: null, hex: null };
        for (const c of dsLabs) { const d = dE(lab, c.lab); if (d < best.d) best = { d, name: c.name, hex: c.h }; }
        const at = relative(SITES, f).replace(/\\/g, '/') + ':' + (i + 1);
        if (best.d < NEAR_DUPLICATE) {
          nNear++;
          if (!seen.has(h)) { seen.add(h); near.push({ site, hex: h, near: best.name, nearHex: best.hex, dE: +best.d.toFixed(1), at }); }
        } else if (!fresh.has(h)) {
          fresh.set(h, { hex: h, at, nearest: best.name, dE: +best.d.toFixed(1) });
        }
      }
    });
  }
  if (nNear) perSite.push({ site, n: nNear });
}

for (const e of exemptions) {
  const tag = e.expires && e.expires < TODAY ? '已过期' : '登记中';
  console.log('  [KNOWN] 豁免 ' + e.match + '（owner ' + e.owner + '，到期 ' + e.expires + '，' + tag + '）');
}
for (const e of expiredEx) console.log('  [ERROR] 豁免已过期：' + e.match + '（' + e.expires + '）—— 要么修掉，要么重新评估并续期');

// ── P1 primitives.css 的「只吃 var()」契约 ────────────────────────────────
// primitives.css 是**手工维护**的共享组件层（不是生成物），却因为放在 packages/ 下
// 被本脚本的「交付物副本」排除规则一并跳过了——于是它里面写死的东西没人管。
// U66 第⑦项点名的就是这个：.developer-panel 的阴影硬编码。
//
// 判据刻意**不是**「一个原始值都不许有」：全文件还有 22 处 rgba(255,255,255,α) 与 #ffffff，
// 那是玻璃拟态的加亮叠层，是渲染手法而不是品牌色——为 7 个 alpha 值造 7 个令牌是噪声。
// 真正要守的是两类：
//   ① box-shadow / text-shadow 写死（阴影本来就是设计令牌的一族）
//   ② 出现非纯黑/纯白的十六进制色（说明有品牌色被写死在这里）
const PRIM = join(ROOT, 'packages', 'tokens', 'primitives.css');
const primProblems = [];
if (existsSync(PRIM)) {
  const txt = readFileSync(PRIM, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  txt.split('\n').forEach((line, i) => {
    const sh = line.match(/(box-shadow|text-shadow)\s*:\s*([^;]+);/);
    if (sh && !/var\(/.test(sh[2])) primProblems.push('PC1 primitives.css:' + (i + 1) + ' 阴影写死：' + sh[2].trim().slice(0, 60));
    for (const h of (line.match(/#[0-9a-fA-F]{6}\b/g) || [])) {
      const v = h.toLowerCase();
      if (v === '#ffffff' || v === '#000000') continue;
      primProblems.push('PC2 primitives.css:' + (i + 1) + ' 品牌色写死：' + h);
    }
  });
}
near.push(...primProblems.map((p) => ({ site: 'ui', hex: '', near: p, nearHex: '', dE: 0, at: 'packages/tokens/primitives.css' })));

if (AS_JSON) {
  console.log(JSON.stringify({ threshold: NEAR_DUPLICATE, nearDuplicates: near, newColors: [...fresh.values()], perSite }, null, 2));
} else {
  console.log('非设计系统色值闸门：判据 = 是否与已有令牌近似（CIE76 dE < ' + NEAR_DUPLICATE + '）');
  console.log('');
  if (near.length) {
    console.log('  [ERROR] 与已有令牌近似、应当改用令牌的色值（' + near.length + ' 个 / ' + perSite.reduce((a, b) => a + b.n, 0) + ' 处）：');
    for (const n of near.sort((a, b) => a.dE - b.dE)) {
      if (n.site === 'ui') { console.log('    ' + n.near); continue; }   // primitives.css 的契约违规
      console.log('    ' + n.hex + '  ≈ ' + n.nearHex + ' (' + n.near + ')  dE=' + n.dE + '   ' + n.site + '  ' + n.at);
    }
    console.log('');
  }
  const others = [...fresh.values()].sort((a, b) => a.dE - b.dE);
  if (others.length) {
    console.log('  [INFO ] 确实是新的色值（' + others.length + ' 个）——可能是第三方品牌色，也可能该进设计系统：');
    for (const o of others) console.log('    ' + o.hex + '  最近令牌 ' + o.nearest + ' dE=' + o.dE + '   ' + o.at);
  }
  console.log('');
  // 两类问题分开报——把 primitives 的契约违规说成「重复发明令牌」是错的描述。
  const dup = near.filter((n) => n.site !== 'ui');
  const contract = near.filter((n) => n.site === 'ui');
  if (dup.length) console.log('结论：有 ' + dup.length + ' 个色值只是在重复已有令牌（' + perSite.map((p) => p.site + ' ' + p.n + ' 处').join(', ') + '）');
  if (contract.length) console.log('结论：primitives.css 有 ' + contract.length + ' 处违反「只吃 var()」契约');
  if (!near.length) console.log('结论：没有「重新发明已有令牌」的色值，primitives.css 也未违反 var() 契约');
}
process.exit(near.length === 0 && expiredEx.length === 0 ? 0 : 1);
