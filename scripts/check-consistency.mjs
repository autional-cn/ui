#!/usr/bin/env node
// check-consistency — 跨 portal 视觉一致性检查
// 用法: node scripts/check-consistency.mjs [--json]
//
// 为什么需要它：
//   目标是「14 个 portal 看起来像同一家公司同一个产品的不同门户」。
//   令牌层已经打通（check-typography / check-consumers），但实测算下来，
//   真正让 portal 之间看起来不像一家的是下面三件事，此前没有任何检查覆盖：
//
//   C1 用 antd 的控制台没有把 antd 主题接到设计系统上
//      实测：admin 设了 token.colorPrimary = '#003153'（品牌蓝）；
//            platform 与 security 的 ConfigProvider **只设了 algorithm**，
//            渲染出来 18 处是 antd 出厂蓝 rgb(22,119,255)（含侧边栏 .ant-menu-item-selected）。
//            同一个产品，两个控制台的主色不是一个。
//      ui 仓库其实已经生成好 packages/tokens/dist/antd-theme.js，但无人消费——与 KI-006 同一种病。
//
//   C2 页面里硬编码设计系统已有的色值
//      实测 185 处：style 内联 66 / JS 常量 113 / CSS 6。
//      其中 antd 控制台的 antd-app.tsx 手写整套主题色，另有图标内联色、Statistic.valueStyle 等。
//
//   C3 packages/ui 共享组件库在 9 个站点各存一份
//      实测 29 个源文件里差 1–5 个（ErrorBoundary / PageContainer / package.json / test setup / vitest config）。
//      组件主体一致，但这是又一处「拷贝而非依赖」。
//
// 判据必须跟着事实走：下面 C2 的「设计系统色值表」直接从 tokens 派生，
// 不写死清单——令牌改了，检查自动跟上。

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, loadTokens, stripMeta, flatten } from './lib/tokens.mjs';

const AS_JSON = process.argv.includes('--json');
const SITES = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');
const KNOWN = join(ROOT, 'verification', 'known-issues.json');
const TODAY = new Date().toISOString().slice(0, 10);

const problems = [];
const warns = [];
const info = [];
const known = existsSync(KNOWN) ? (JSON.parse(readFileSync(KNOWN, 'utf8')).issues || []) : [];

// ── 设计系统"品牌定义色"表：从令牌派生 ──────────────────────────────────
// 只收品牌定义性的色，不收中性白/黑/浅灰——那些在各处合法出现，收了只会淹没信号。
const core = stripMeta(loadTokens().core);
const BRANDISH = /^(primary|sky|amber)\.|^(success|warning|danger|info)$|^brand|^bg-developer$|^accent$/;
const colorToToken = new Map();
for (const [p, v] of Object.entries(flatten({ color: core.color }))) {
  const name = p.replace(/^color\./, '');
  if (!BRANDISH.test(name)) continue;
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) continue;
  if (!colorToToken.has(v.toLowerCase())) colorToToken.set(v.toLowerCase(), 'color.' + name);
}
const HEX_RE = /#[0-9a-fA-F]{6}\b/g;

function walk(dir, acc, test, skip) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { return acc; }
  for (const e of entries) {
    if (skip && skip(e, dir)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc, test, skip);
    else if (test(e.name)) acc.push(p);
  }
  return acc;
}
const SKIP = (e, dir) => ['node_modules', '.git', 'dist', '.astro', '.next'].includes(e.name)
  || (e.isDirectory() && e.name === 'tailwind-preset' && dir.endsWith('packages'));

if (!existsSync(SITES)) {
  console.log('check-consistency：本次工作区没有 sites/，跳过（CI 里同样跳过）');
  process.exit(0);
}

// ── C1 antd 主题是否接到设计系统 ────────────────────────────────────────
const antdSites = [];
const c1 = [];
for (const site of readdirSync(SITES)) {
  const sp = join(SITES, site);
  if (!statSync(sp).isDirectory()) continue;
  const files = walk(sp, [], (n) => /\.(tsx|ts|jsx|js)$/.test(n), SKIP);
  let usesAntd = false;
  const providers = [];
  for (const f of files) {
    const txt = readFileSync(f, 'utf8');
    if (/from\s+['"]antd['"]/.test(txt)) usesAntd = true;
    if (/ConfigProvider/.test(txt) && /theme\s*=/.test(txt)) providers.push({ f, txt });
  }
  if (!usesAntd) continue;
  antdSites.push(site);
  if (!providers.length) {
    c1.push({ site, msg: site + ' 依赖并在源码中使用 antd，但没有任何 ConfigProvider theme——antd 组件将使用出厂配色（primary #1677ff），与已接入品牌的控制台不一致' });
    continue;
  }
  for (const { f, txt } of providers) {
    const rel = relative(SITES, f).replace(/\\/g, '/');
    const m = /theme\s*=\s*\{\{([\s\S]*?)\n\s*\}\}/.exec(txt) || /theme\s*=\s*\{\{([\s\S]*?)\}\}/.exec(txt);
    const block = m ? m[1] : '';
    if (!/token\s*:/.test(block)) {
      c1.push({ site, msg: rel + ' 的 ConfigProvider 只设了 algorithm、没有 token——antd 组件走出厂配色，未接品牌' });
      continue;
    }
    const hexes = [...new Set((block.match(HEX_RE) || []).map((h) => h.toLowerCase()))].filter((h) => colorToToken.has(h));
    if (hexes.length && !/antd-theme|antdTheme|@autional-cn\/tokens/.test(txt)) {
      c1.push({ site, msg: rel + ' 的 antd 主题手写了 ' + hexes.length + ' 个设计系统已有色值（' + hexes.slice(0, 5).join(' ') + '）而不是消费 @autional-cn/tokens/antd-theme——令牌变更不会传导到这里' });
    }
  }
}
info.push('C1 使用 antd 的站点：' + antdSites.length + ' 个（' + antdSites.join(', ') + '）');
for (const x of c1) problems.push('C1 ' + x.msg);

// ── C2 页面里硬编码设计系统色值 ─────────────────────────────────────────
// 判据细节（第一版有假阳性，按实测修）：
//   ① 跳过 public/ —— 那里是第三方 vendored 产物（如 reference/public/scalar/api-reference.js），不是站点自己的代码；
//   ② 扫之前先剥掉注释 —— 否则「文档里提到某个色值」会被当成硬编码（本项目自己的 global.css 头部注释就中过招）；
//   ③ 测试文件单列：断言里出现色值是正当的，降级为 INFO，不判失败；
//   ④ 构建配置文件（*.config.*）单列：那里的色值是写给工具/清单用的字面量，不是渲染样式。
//      实测踩过：status 的 vite.config.ts 里 theme_color: '#003153' 是 PWA manifest 字段，
//      写成 var(--color-primary-700) 在 manifest.webmanifest 里毫无意义（它不经过 CSS 解析）。
// 注意 m 标志：没有它时 `^` 只匹配整个字符串的开头，行内的 // 注释剥不掉——
// 实测本项目自己的 antd-app.tsx 头注释就被当成了硬编码（第二处同类假阳性）。
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
const isPublic = (f, sp) => relative(sp, f).replace(/\\/g, '/').startsWith('public/');
const isTest = (f) => /(__tests__|\.test\.|\.spec\.)/.test(f);
const isBuildConfig = (f) => /[^/]*\.config\.[cm]?[jt]s$/.test(f);
const c2rows = [];
const c2test = [];
for (const site of readdirSync(SITES)) {
  const sp = join(SITES, site);
  if (!statSync(sp).isDirectory()) continue;
  const files = walk(sp, [], (n) => /\.(tsx|ts|jsx|js|css|astro)$/.test(n), SKIP).filter((f) => !isPublic(f, sp));
  const hits = [];
  const testHits = [];
  for (const f of files) {
    const text = stripComments(readFileSync(f, 'utf8'));
    text.split('\n').forEach((line, i) => {
      const found = [...new Set((line.match(HEX_RE) || []).map((h) => h.toLowerCase()))].filter((h) => colorToToken.has(h));
      if (!found.length) return;
      const rec = { file: relative(sp, f).replace(/\\/g, '/'), line: i + 1, found: found.map((h) => h + '=' + colorToToken.get(h)) };
      (isTest(f) || isBuildConfig(f) ? testHits : hits).push(rec);
    });
  }
  if (hits.length) c2rows.push({ site, hits });
  if (testHits.length) c2test.push({ site, n: testHits.length });
}
const c2total = c2rows.reduce((a, r) => a + r.hits.length, 0);
info.push('C2 硬编码设计系统已有色值的行数：' + c2total + ' 处，分布在 ' + c2rows.length + ' 个站点');
if (c2test.length) info.push('C2b 测试文件与构建配置里的色值（正当，不判失败——前者是断言、后者是写给工具/清单的字面量）：' + c2test.map((t) => t.site + ' ' + t.n + ' 行').join(', '));
for (const r of c2rows) {
  problems.push('C2 ' + r.site + '：' + r.hits.length + ' 行硬编码了设计系统已有同值的色（示例：' +
    r.hits.slice(0, 3).map((h) => h.file + ':' + h.line + ' ' + h.found.join(' ')).join('；') +
    '）。这些颜色应引用 var(--color-*) 或令牌，否则改令牌不会传导、各 portal 会各自漂移。');
}

// ── C3 packages/ui 的份数 ───────────────────────────────────────────────
const uiGroups = new Map();
for (const site of readdirSync(SITES)) {
  const ui = join(SITES, site, 'packages', 'ui');
  if (!existsSync(ui)) continue;
  const files = walk(ui, [], () => true, (e) => ['node_modules', '.git', 'dist'].includes(e.name));
  const h = createHash('sha256');
  // 归一化行尾再比对：不归一化会把「同一份内容、行尾一个是 LF 一个是 CRLF」算成两个版本。
  // 实测：brand 的 PageContainer.tsx / package.json / test/setup.ts / vitest.config.ts
  // 与其余 8 个站点逐字节不同，归一化后**内容完全相同**——那是行尾符噪声，不是真分叉。
  for (const f of files.sort()) { h.update(relative(ui, f)); h.update(readFileSync(f, 'utf8').replace(/\r\n/g, '\n')); }
  const key = h.digest('hex').slice(0, 12);
  if (!uiGroups.has(key)) uiGroups.set(key, []);
  uiGroups.get(key).push(site);
}
info.push('C3 packages/ui 的实现份数：' + uiGroups.size + ' 份（' + [...uiGroups.values()].map((v) => v.length + ' 站点: ' + v.join('/')).join(' | ') + '）');
if (uiGroups.size > 1) {
  problems.push('C3 packages/ui 是共享组件库，却在 ' + uiGroups.size + ' 种实现间分叉（' +
    [...uiGroups.values()].map((v) => v.join('/')).join(' | ') +
    '）。这是又一处「拷贝而非依赖」——零件（Button/Input/Modal/Toast…）本该只有一份。');
}

// ── C4 站点本地覆盖设计系统令牌（同名、不同值）──────────────────────────
// 与 C2 的区别：C2 查「硬编码了某个等于令牌的色值」；C4 查「把设计系统已有的变量名
// 在本地重新定义成别的值」——后者更隐蔽，因为它看起来在「用令牌」，实际把令牌改掉了。
// 实测（2026-09）：全舰队只有 3 处，都在 admin 的图表色上。
const dsVars = new Map();
{
  const css = readFileSync(join(ROOT, 'packages', 'tokens', 'tokens.css'), 'utf8');
  const i0 = css.indexOf(':root');
  const open0 = css.indexOf('{', i0);
  let dep = 0; let end0 = open0;
  for (let j = open0; j < css.length; j++) {
    if (css[j] === '{') dep++;
    else if (css[j] === '}') { dep--; if (!dep) { end0 = j; break; } }
  }
  for (const m of css.slice(open0 + 1, end0).matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) dsVars.set(m[1], m[2].trim());
}
const c4rows = [];
{
  for (const site of readdirSync(SITES)) {
    const sp = join(SITES, site);
    if (!statSync(sp).isDirectory()) continue;
    const files = walk(sp, [], (n) => /\.(css|astro|tsx|ts)$/.test(n), SKIP)
      .filter((f) => !relative(sp, f).replace(/\\/g, '/').startsWith('public/'));
    for (const f of files) {
      const rel = relative(sp, f).replace(/\\/g, '/');
      const text = stripComments(readFileSync(f, 'utf8'));
      for (const m of text.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;\n}]+)/g)) {
        const name = m[1]; const val = m[2].trim();
        if (!dsVars.has(name)) continue;
        if (val === dsVars.get(name)) continue;
        if (/^var\(/.test(val)) continue;
        c4rows.push({ site, rel, name, val, ds: dsVars.get(name) });
      }
    }
  }
}
info.push('C4 本地覆盖设计系统令牌且值不同的处数：' + c4rows.length + ' 处，分布在 ' +
  new Set(c4rows.map((r) => r.site)).size + ' 个站点');
for (const s of new Set(c4rows.map((r) => r.site))) {
  const list = c4rows.filter((r) => r.site === s);
  problems.push('C4 ' + s + '：' + list.length + ' 处把设计系统已有的变量名在本地重新定义成了别的值（' +
    list.slice(0, 4).map((r) => r.name + ' = ' + r.val + '，设计系统为 ' + r.ds).join('；') +
    '）。这看起来像在用令牌，实际把令牌改掉了——各 portal 因此会各自漂移。' +
    '修法二选一：改用设计系统的值，或把该站点确实需要的差异补成设计系统里的新令牌。');
}

// ── 已知问题登记（与其它检查同一套约定）────────────────────────────────
const codeOf = (msg) => { const m = /^(C\d)/.exec(msg); return m ? m[1] : null; };
const knownFor = (msg) => { const c = codeOf(msg); return c ? known.find((k) => k.code === c && msg.indexOf(k.match) >= 0) : undefined; };
const suppressed = [];
const active = [];
for (const msg of problems) {
  const k = knownFor(msg);
  if (k) suppressed.push({ msg, issue: k }); else active.push(msg);
}
const expired = [];
for (const k of known) {
  if (!/^C\d/.test(k.code)) continue;
  for (const f of ['id', 'code', 'match', 'reason', 'owner', 'expires']) {
    if (!k[f]) active.push('C9 known-issue:' + (k.id || '?') + ' 缺少字段 ' + f);
  }
  if (k.expires && k.expires < TODAY) expired.push('C9 登记 ' + k.id + ' 已过期（' + k.expires + '）：要么修掉，要么重新评估并续期');
}
for (const e of expired) active.push(e);

if (AS_JSON) {
  console.log(JSON.stringify({ errors: active.length, warnings: warns.length, suppressed: suppressed.length, active, warns, suppressed, info }, null, 2));
} else {
  console.log('视觉一致性检查：站点 ' + readdirSync(SITES).filter((s) => statSync(join(SITES, s)).isDirectory()).length + ' 个');
  for (const i of info) console.log('  [INFO ] ' + i);
  for (const w of warns) console.log('  [WARN ] ' + w);
  for (const a of active) console.log('  [ERROR] ' + a);
  for (const sp of suppressed) console.log('  [KNOWN] ' + sp.msg.slice(0, 100) + '  已登记为 ' + sp.issue.id + '（owner ' + sp.issue.owner + '，到期 ' + sp.issue.expires + '）');
  console.log('');
  console.log(active.length === 0
    ? '结论：视觉一致性检查通过（' + warns.length + ' 警告，' + suppressed.length + ' 条已登记）'
    : '结论：视觉一致性检查失败（' + active.length + ' 错误，' + suppressed.length + ' 条已登记）');
}
process.exit(active.length === 0 ? 0 : 1);
