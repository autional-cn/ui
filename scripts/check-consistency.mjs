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
//   C5 直接 import antd 的入口数没有记账
//      收敛是分批次做的（D10：按组件种类分批，不按文件）。批次之间必须有个东西记住
//      「现在是多少」，否则这一批刚清掉的 import 会被下一批悄悄加回来。
//      台账 verification/antd-entries.json 就是那个东西：数字只许减不许增。
//// 判据必须跟着事实走：下面 C2 的「设计系统色值表」直接从 tokens 派生，
// 不写死清单——令牌改了，检查自动跟上。

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
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

// ── antd 依赖台账（C1 / C5 共用一次扫描）────────────────────────────────
// 为什么要台账而不是每次现算：antd 是「14 个 portal 看起来像同一个产品」这条路上最大的
// 一处各自为政 —— 实测三个控制台各有 100+ 处直接 import antd。收敛按 D10 分种类分批做，
// 批次之间必须有个东西记住「现在是多少」，否则这一批刚清掉的 import 会被下一批悄悄加回来。
const ANTD_REGISTRY_PATH = join(ROOT, 'verification', 'antd-entries.json');
const WRITE_REGISTRY = process.argv.includes('--write-registry');
const ANTD_KINDS = ['Table', 'DatePicker', 'Drawer', 'icons', 'other', 'subpath'];
const antdKindOf = (name) => {
  if (name === 'Table') return 'Table';
  if (name === 'DatePicker' || name === 'RangePicker' || name === 'TimePicker' || name === 'Calendar') return 'DatePicker';
  if (name === 'Drawer') return 'Drawer';
  return 'other';
};

// 计的是**入口数**（具名导入的个数），不是用法数：一个文件 import 了 5 个组件算 5 个入口。
function countAntdText(txt) {
  const specifiers = {};
  for (const k of ANTD_KINDS) specifiers[k] = 0;
  // ⚠ 不能用 [\s\S]*? —— 它会跨语句匹配：从一个普通的 import 开头一路吃到下一个 import 的 }
  // 上，把中间那些导入的名字全算到自己头上。实测踩过：下面的自检样例一开始把 icons 数成 2。
  const reAntd = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]antd['"]/g;
  const reIcons = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]@ant-design\/icons['"]/g;
  let touchesAntd = false;
  let touchesIcons = false;
  for (const m of txt.matchAll(reAntd)) {
    touchesAntd = true;
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name) specifiers[antdKindOf(name)]++;
    }
  }
  if (/import\s+(?:type\s+)?(?:\*\s+as\s+\w+|\w+)\s+from\s+['"]antd['"]/.test(txt)) { touchesAntd = true; specifiers.other++; }
  if (/from\s+['"]antd\/(?:es|lib)\//.test(txt)) { touchesAntd = true; specifiers.subpath++; }
  for (const m of txt.matchAll(reIcons)) {
    touchesIcons = true;
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name) specifiers.icons++;
    }
  }
  return { specifiers, touchesAntd, touchesIcons };
}

function measureAntdSite(siteDir) {
  const files = walk(siteDir, [], (n) => /\.(tsx|ts|jsx|js)$/.test(n), SKIP);
  const specifiers = {};
  for (const k of ANTD_KINDS) specifiers[k] = 0;
  const rec = { specifiers, filesAntd: 0, filesIcons: 0, bridge: [], ownTheme: [] };
  for (const f of files) {
    const txt = readFileSync(f, 'utf8');
    const rel = relative(SITES, f).replace(/\\/g, '/');
    const c = countAntdText(txt);
    for (const k of ANTD_KINDS) specifiers[k] += c.specifiers[k];
    if (c.touchesAntd) rec.filesAntd++;
    if (c.touchesIcons) rec.filesIcons++;
    if (/AntdThemeProvider/.test(txt) && /from\s+['"]@autional-cn\/ui\/antd['"]/.test(txt)) rec.bridge.push(rel);
    if (/ConfigProvider/.test(txt) && /theme\s*=/.test(txt)) {
      const m = /theme\s*=\s*\{\{([\s\S]*?)\n\s*\}\}/.exec(txt) || /theme\s*=\s*\{\{([\s\S]*?)\}\}/.exec(txt);
      const block = m ? m[1] : '';
      const hexes = [...new Set((block.match(HEX_RE) || []).map((h) => h.toLowerCase()))].filter((h) => colorToToken.has(h));
      rec.ownTheme.push({ rel, hasToken: /token\s*:/.test(block), hexes, consumesBridge: /antd-theme|antdTheme|@autional-cn\/tokens/.test(txt) });
    }
  }
  return rec;
}

const antdRegistry = existsSync(ANTD_REGISTRY_PATH) ? JSON.parse(readFileSync(ANTD_REGISTRY_PATH, 'utf8')) : null;
const antdMeasured = {};
const antdSites = [];
for (const site of readdirSync(SITES)) {
  const sp = join(SITES, site);
  if (!statSync(sp).isDirectory()) continue;
  const rec = measureAntdSite(sp);
  // 走设计系统桥的站点也算 antd 消费方：它渲染的就是 antd 组件，只是入口换成了 DS。
  if (!rec.filesAntd && !rec.filesIcons && !rec.bridge.length) continue;
  antdMeasured[site] = rec;
  antdSites.push(site);
}

// 度量器自检（正负控制）。解析器一旦失灵，棘轮会**全绿**——那比红危险得多，
// 因为它看起来在保护一致性，实际什么都没数。
{
  const c = countAntdText("import { Table, Button as B } from 'antd';\nimport type { MessageInstance } from 'antd/es/message/interface';\nimport { PlusOutlined } from '@ant-design/icons';\n");
  if (!(c.specifiers.Table === 1 && c.specifiers.other === 1 && c.specifiers.subpath === 1 && c.specifiers.icons === 1 && c.touchesAntd && c.touchesIcons)) {
    problems.push('C5 度量器正向控制失败：解析结果 ' + JSON.stringify(c) + '，期望 Table=1 other=1 subpath=1 icons=1 —— antd 入口计数解析器出错了，棘轮因此失去意义');
  }
  const n = countAntdText("import { Table } from './table';\nconst x = 'antd';\n// from 'antd'\n");
  if (n.touchesAntd || n.specifiers.Table !== 0) {
    problems.push('C5 度量器负向控制失败：不 import antd 的文本被计成了 ' + JSON.stringify(n) + ' —— 度量器在误报，会让闸门失去可信度');
  }
}

if (WRITE_REGISTRY) {
  const prev = (antdRegistry && antdRegistry.sites) || {};
  const out = {
    $comment: 'antd 直接依赖台账（棘轮）。specifiers 计的是**入口数**（具名导入个数），不是用法数。数字只许减不许增：新增直接 import antd 会被 C5 判红。closedKinds 里的种类必须为 0（该批收敛完了）。themeConverged=true 的站点另受 C1 强判据约束：不许自己拿 ConfigProvider。',
    updated: TODAY,
    kinds: ANTD_KINDS,
    closedKinds: (antdRegistry && antdRegistry.closedKinds) || [],
    sites: {},
  };
  for (const [site, rec] of Object.entries(antdMeasured)) {
    out.sites[site] = {
      themeConverged: !!(prev[site] && prev[site].themeConverged),
      specifiers: rec.specifiers,
      filesAntd: rec.filesAntd,
      filesIcons: rec.filesIcons,
      bridgeFiles: rec.bridge.length,
      ownThemeFiles: rec.ownTheme.length,
    };
  }
  writeFileSync(ANTD_REGISTRY_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log('已写入 ' + relative(ROOT, ANTD_REGISTRY_PATH).replace(/\\/g, '/') + '（' + Object.keys(out.sites).length + ' 个站点）');
  process.exit(0);
}

// ── C1 antd 主题是否接到设计系统（唯一桥）──────────────────────────────
// 判据分两档，跟着**该站点是否已在台账里收敛**走：
//   · 未收敛：站点仍可自持 ConfigProvider，但必须有 token，且不得手写设计系统已有的色值；
//   · 已收敛（themeConverged=true）：**不许**再自己拿 ConfigProvider —— 必须挂
//     @autional-cn/ui/antd 的 AntdThemeProvider，主题只能从设计系统下发。
// 为什么必须分档：2026-10 起三个控制台把主题收进了设计系统，本地已经没有 ConfigProvider。
// 旧判据「没有 ConfigProvider 就是没接主题」会把已经收敛的站点判成红的，方向正好相反；
// 而如果把判据整体放宽成「有桥或有 ConfigProvider 都算」，收敛状态就再也没人守了。
const c1 = [];
const themeConverged = (site) => !!(antdRegistry && antdRegistry.sites && antdRegistry.sites[site] && antdRegistry.sites[site].themeConverged);
for (const site of antdSites) {
  const rec = antdMeasured[site];
  const converged = themeConverged(site);
  if (!rec.bridge.length && !rec.ownTheme.length) {
    problems.push('C1 ' + site + ' 源码里使用了 antd，但既没有自己的 ConfigProvider theme，也没有挂设计系统的 AntdThemeProvider——antd 组件将使用出厂配色（primary #1677ff），与已接入品牌的控制台不一致');
  }
  if (converged && !rec.bridge.length) {
    problems.push('C1 ' + site + ' 在台账里登记为 themeConverged=true，但源码里没有任何文件挂 @autional-cn/ui/antd 的 AntdThemeProvider——登记与事实不符：要么补挂桥，要么把台账改回 false');
  }
  for (const o of rec.ownTheme) {
    if (converged) {
      problems.push('C1 ' + site + ' 已收敛到设计系统，但 ' + o.rel + ' 仍自己拿 ConfigProvider theme= —— antd 主题只能由 @autional-cn/ui/antd 下发，本地再拿一份就是又一处会各自漂移的实现（这正是 KI-011 的成因）');
      continue;
    }
    if (!o.hasToken) {
      problems.push('C1 ' + o.rel + ' 的 ConfigProvider 只设了 algorithm、没有 token——antd 组件走出厂配色，未接品牌');
      continue;
    }
    if (o.hexes.length && !o.consumesBridge) {
      problems.push('C1 ' + o.rel + ' 的 antd 主题手写了 ' + o.hexes.length + ' 个设计系统已有色值（' + o.hexes.slice(0, 5).join(' ') + '）而不是消费 @autional-cn/tokens/antd-theme——令牌变更不会传导到这里');
    }
  }
}
info.push('C1 使用 antd 的站点：' + antdSites.length + ' 个（' + antdSites.join(', ') + '）；主题已收敛到设计系统的：' + (antdSites.filter(themeConverged).join(', ') || '无'));

// ── C5 直接 import antd 的入口数（棘轮：只许减，不许增）─────────────────
// 收敛是分批次做的，台账是批次之间的记忆。没有它，每一批刚清掉的 import 都可能在下一批
// 被重新加回来，而且没人会注意到——因为「多一处 import antd」本身不会让任何检查变红。
if (!antdRegistry) {
  problems.push('C5 verification/antd-entries.json 缺失——antd 收敛分批次进行（D10：按组件种类分批），批次之间靠这份台账记住基线。用 node scripts/check-consistency.mjs --write-registry 生成。');
} else {
  const closedKinds = new Set(antdRegistry.closedKinds || []);
  for (const k of closedKinds) {
    if (!ANTD_KINDS.includes(k)) {
      problems.push('C5 台账里的 closedKinds 含有未定义种类「' + k + '」——种类拼错会让该批的闸门静默失效（合法种类：' + ANTD_KINDS.join(' / ') + '）');
    }
  }
  let total = 0;
  for (const [site, rec] of Object.entries(antdMeasured)) {
    const entry = antdRegistry.sites ? antdRegistry.sites[site] : null;
    if (!entry) {
      problems.push('C5 ' + site + ' 有 antd 直接依赖但没有登记在 verification/antd-entries.json——新出现的消费方先登记（--write-registry）并在评审里说明为什么不能走 @autional-cn/ui/antd');
      continue;
    }
    for (const k of ANTD_KINDS) total += rec.specifiers[k] || 0;
    const grew = [];
    const shrank = [];
    for (const k of ANTD_KINDS) {
      const now = rec.specifiers[k] || 0;
      const was = (entry.specifiers && entry.specifiers[k]) || 0;
      if (now > was) grew.push(k + ' ' + was + '→' + now);
      else if (now < was) shrank.push(k + ' ' + was + '→' + now);
    }
    if (grew.length) {
      problems.push('C5 ' + site + ' 新增了直接 import antd 的入口（' + grew.join('、') + '）。全舰队的 antd 入口只减不增：能走 @autional-cn/ui/antd 的走设计系统，确实缺能力就先把能力补进设计系统，而不是在站点里直接 import。');
    }
    if (closedKinds.has('Table') && (rec.specifiers.Table || 0) > 0) {
      problems.push('C5 ' + site + ' 仍有 ' + rec.specifiers.Table + ' 处直接从 antd import Table，而种类「Table」在台账里已登记为 closed（该批收敛完了）——closed 的含义是 0 处。');
    }
    if (shrank.length) {
      warns.push('C5 ' + site + ' 的直接 import 比台账少了（' + shrank.join('、') + '）——这是进展，但请跑 node scripts/check-consistency.mjs --write-registry 更新台账，否则台账会慢慢变成一段没人相信的数字。');
    }
  }
  info.push('C5 直接 import antd 的入口总数：' + total + ' 处（' + ANTD_KINDS.join(' / ') + '），分布在 ' + Object.keys(antdMeasured).length + ' 个站点');
}


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
// ⑤ theme-color / theme_color 这一类是**写给浏览器与清单的字面量**，不经过 CSS 解析。
//    在这类位置写 var() 不是「更规范」，而是**失效**——浏览器视作非法值直接忽略。
//    实测踩过：wiki 的 <meta name="theme-color" content="var(--color-primary-700)">
//    实际效果是「没有 theme-color」。与 ④ 同理，这类行降级为 INFO，不判失败。
const isLiteralOnlyContext = (line) => /theme[-_]color/i.test(line);
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
      (isTest(f) || isBuildConfig(f) || isLiteralOnlyContext(line) ? testHits : hits).push(rec);
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

// ── C3 packages/ui 的本地副本 ───────────────────────────────────────────
// 判据变过一次，跟着**交付方式**变：
//   · 2026-09 之前：组件库以 9 份逐字节相同的副本存在，C3 守的是「它们不许分叉」；
//   · 2026-09 起：组件库发布为 @autional-cn/ui@0.1.0-rc，14 个站点全部改为 npm 依赖，
//     本地副本清零。于是判据从「N 份里只有 1 种实现」改成 **「0 份」** ——与 P4 对
//     packages/tailwind-preset 的处理完全同构。
// 为什么要改而不是留着：留着「1 种实现」会让副本悄悄长回来时**照样全绿**
// （副本只要彼此一致就没问题），而那时「站点真的从 npm 消费组件库」已经没人看了。
const uiCopies = [];
for (const site of readdirSync(SITES)) {
  if (existsSync(join(SITES, site, 'packages', 'ui'))) uiCopies.push(site);
}
info.push('C3 packages/ui 的本地副本：' + uiCopies.length + ' 个站点' +
  (uiCopies.length ? '（' + uiCopies.join('/') + '）' : '——全部走已发布的 @autional-cn/ui'));
if (uiCopies.length) {
  problems.push('C3 有 ' + uiCopies.length + ' 个站点还留着组件库副本 packages/ui（' + uiCopies.join('/') +
    '）。组件库已发布为 @autional-cn/ui@0.1.0-rc，站点应声明 npm 依赖、删除副本——' +
    '「拷贝而非依赖」正是这一层要消灭的东西。');
}

// ── C4 站点本地覆盖设计系统令牌（同名、不同值）──────────────────────────
// 与 C2 的区别：C2 查「硬编码了某个等于令牌的色值」；C4 查「把设计系统已有的变量名
// 在本地重新定义成别的值」——后者更隐蔽，因为它看起来在「用令牌」，实际把令牌改掉了。
// 实测（2026-09）：全舰队只有 3 处，都在 admin 的图表色上。
// ⚠️ 判据必须**分上下文**：站点在 [data-theme="dark"] 里写 --color-bg-primary 本就该与 :root 不同，
// 正确的参照是设计系统的 .dark 块，不是 :root。早期版本只取 :root 作参照，又用
// `if (/^var\(/.test(val)) continue;` 把「用 var() 引了错令牌」整类跳过——
// 于是 5 个站把暗色底色写成中性灰（--color-neutral-900/800），而设计系统是品牌深蓝
// （--color-primary-900 / #0a2940），**一处都没报**，全绿了整整几轮。
// 「看起来在引用令牌」正是最隐蔽的一种分叉，判据不能把它排除在外。
const DS_CSS = readFileSync(join(ROOT, 'packages', 'tokens', 'tokens.css'), 'utf8');
// 去掉 @layer/@media/@supports 外壳（保留内部规则）与 @keyframes（整块丢弃），
// 这样下面按「选择器 { 声明 }」逐块扫描时，选择器就是真正的选择器。
// 按**配对花括号**摘块，不用正则：第一版用贪婪的 /@layer[^{]*\{([\s\S]*)\n\}/，
// 它一路吃到文件里最后一个 \n}，把紧随其后的站点暗色块连外层一起吞掉，
// 结果是 platform 的 6 处分叉一处都没报（而同一份内容在 admin 上报了）。
// 「闸门少报」比「闸门误报」危险得多——它看起来是绿的。
const AT_WRAPPER = /^@(layer|media|supports|container)\b/;
const AT_KEYFRAMES = /^@(-webkit-)?keyframes\b/;
function spliceBlocks(css, pred, keepInner) {
  let out = '';
  let i = 0;
  let changed = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) { out += css.slice(i); break; }
    const sel = css.slice(i, open);
    if (!pred(sel.trim())) { out += css.slice(i, open + 1); i = open + 1; continue; }
    let depth = 0; let j = open;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') { depth--; if (!depth) break; }
    }
    out += keepInner ? css.slice(open + 1, j) : '';
    i = j + 1;
    changed++;
  }
  return { out, changed };
}
function shellOut(css) {
  let out = spliceBlocks(css, (s) => AT_KEYFRAMES.test(s), false).out;
  for (let i = 0; i < 12; i++) {
    const r = spliceBlocks(out, (s) => AT_WRAPPER.test(s), true);
    if (!r.changed) break;
    out = r.out;
  }
  return out;
}
function varMapOf(css, wantDark) {
  const m = new Map();
  for (const r of shellOut(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const dark = /\.dark|\[data-theme=["']?dark/.test(r[1]);
    if (dark !== wantDark) continue;
    for (const d of r[2].matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) m.set(d[1], d[2].trim());
  }
  return m;
}
const dsVars = varMapOf(DS_CSS, false);
const dsDarkVars = varMapOf(DS_CSS, true);
const c4rows = [];
{
  for (const site of readdirSync(SITES)) {
    const sp = join(SITES, site);
    if (!statSync(sp).isDirectory()) continue;
    const files = walk(sp, [], (n) => /\.(css|astro|tsx|ts)$/.test(n), SKIP)
      .filter((f) => !relative(sp, f).replace(/\\/g, '/').startsWith('public/'));
    for (const f of files) {
      const rel = relative(sp, f).replace(/\\/g, '/');
      const text = shellOut(stripComments(readFileSync(f, 'utf8')));
      for (const r of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sel = r[1].trim().replace(/\s+/g, ' ');
        if (!sel || sel.startsWith('@')) continue;
        // 站点自己的暗色块 → 与设计系统的 .dark 比；其余 → 与 :root 比
        const dark = /\.dark|\[data-theme=["']?dark/.test(sel);
        const ref = dark ? dsDarkVars : dsVars;
        for (const d of r[2].matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
          const name = d[1]; const val = d[2].trim();
          if (!ref.has(name)) continue;
          if (val === ref.get(name)) continue;
          // 自引用（--x: var(--x)）不是分叉，跳过；其余一律算。
          if (new RegExp('^var\\(\\s*' + name.replace(/[-]/g, '\\-') + '\\s*[,)]').test(val)) continue;
          c4rows.push({ site, rel, sel, dark, name, val, ds: ref.get(name) });
        }
      }
    }
  }
}
info.push('C4 本地覆盖设计系统令牌且值不同的处数：' + c4rows.length + ' 处，分布在 ' +
  new Set(c4rows.map((r) => r.site)).size + ' 个站点');
for (const s of new Set(c4rows.map((r) => r.site))) {
  const list = c4rows.filter((r) => r.site === s);
  const darkN = list.filter((r) => r.dark).length;
  problems.push('C4 ' + s + '：' + list.length + ' 处把设计系统已有的变量名在本地重新定义成了别的值' +
    (darkN ? '（其中 ' + darkN + ' 处在暗色/主题选择器里，参照的是设计系统的 .dark 块）' : '') + '（' +
    list.slice(0, 4).map((r) => r.sel.slice(0, 24) + ' ' + r.name + ' = ' + r.val + '，设计系统为 ' + r.ds).join('；') +
    '）。这看起来像在用令牌，实际把令牌改掉了——各 portal 因此会各自漂移。' +
    '修法二选一：改用设计系统的值（暗色块通常直接删掉即可，tokens.css 的 .dark 已经定义），' +
    '或把该站点确实需要的差异补成设计系统里的新令牌。');
}

// ── C6 打包分块策略（同一套键名 + 同一套归属）──────────────────────────
// 同一产品的 portal 不该因为「谁当年记得加 vendor 块」而在首屏体积上差一个量级。
// 实测踩过：admin 的 manualChunks 里没有 antd，于是 1.3MB 的 antd 混进了入口块
// （入口 2,698KB / gzip 739KB），而 platform 与 security 把它单独成块（入口 224–282KB）。
// 判据只对**已经采纳分块策略**的站点生效（有 manualChunks 才算采纳）；
// 一旦采纳，键名与归属就必须与下面这张策略表完全一致，且本站依赖到的库不许漏。
const CHUNK_POLICY = {
  'vendor-react': ['react', 'react-dom', 'react-router'],
  'vendor-ui': ['antd', '@ant-design/icons', 'lucide-react'],
  'vendor-charts': ['recharts'],
  'vendor-query': ['@tanstack/react-query'],
  'vendor-i18n': ['i18next', 'react-i18next'],
  'shared-api': ['@autional-cn/shared'],
};
const libToChunk = new Map();
for (const [chunk, libs] of Object.entries(CHUNK_POLICY)) for (const l of libs) libToChunk.set(l, chunk);
const c6sites = new Set();
for (const site of readdirSync(SITES)) {
  const sp = join(SITES, site);
  if (!statSync(sp).isDirectory()) continue;
  for (const cfg of walk(sp, [], (n) => /^vite\.config\.[cm]?ts$/.test(n), SKIP)) {
    const txt = readFileSync(cfg, 'utf8');
    const m = /manualChunks\s*:\s*\{([\s\S]*?)\n\s*\}/.exec(txt);
    if (!m) continue;
    const rel = relative(SITES, cfg).replace(/\\/g, '/');
    c6sites.add(site);
    const assigned = new Map();
    for (const e of m[1].matchAll(/['"]([^'"]+)['"]\s*:\s*\[([^\]]*)\]/g)) {
      const chunk = e[1];
      for (const lib of e[2].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)) {
        assigned.set(lib, chunk);
        const want = libToChunk.get(lib);
        if (!want) {
          problems.push('C6 ' + rel + ' 把 ' + lib + ' 分到了 ' + chunk + '，但这个库没有登记在分块策略里——先把它登记进 check-consistency 的 CHUNK_POLICY，否则各站会各自发明归属');
        } else if (want !== chunk) {
          problems.push('C6 ' + rel + ' 把 ' + lib + ' 分到了 ' + chunk + '，策略里是 ' + want + '——同一个库在不同 portal 属于不同块，缓存与体积口径就不一致了');
        }
      }
    }
    if (!assigned.size) {
      problems.push('C6 ' + rel + ' 写了 manualChunks 却一个条目都没解析出来——判据会因此静默失效（写法变了或解析器坏了）');
      continue;
    }
    const pkgPath = join(dirname(cfg), 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const missing = Object.keys(pkg.dependencies || {}).filter((d) => libToChunk.has(d) && !assigned.has(d));
    if (missing.length) {
      problems.push('C6 ' + rel + ' 没有给这些依赖分块：' + missing.map((d) => d + '（应属 ' + libToChunk.get(d) + '）').join('、') + '——它们会混进入口块，业务代码一改就要用户重下整个依赖库');
    }
  }
}
info.push('C6 已采纳分块策略的站点：' + c6sites.size + ' 个（' + [...c6sites].join(', ') + '）');

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
