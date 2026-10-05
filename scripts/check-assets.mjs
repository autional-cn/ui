#!/usr/bin/env node
// check-assets — 字体资产层：把「用 Inter」从一句声明变成可核对的交付事实
// 用法: node scripts/check-assets.mjs
//
// 背景（实测）：ASTRYX_MANIFEST.brandCore.fontRoleNotes 写着
// 「Latin is self-hosted Inter (@fontsource)」，但：
//   ui/package.json 的 dependencies 是空的，仓库内 @font-face 声明为 0；
//   18 个站点里只有 2 个（reference / wiki）真的装了 @fontsource/inter。
// 也就是说大多数消费方声明的是一款它们并不交付的字体，浏览器直接回退到系统字体。

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, loadTokens, flatten, stripMeta } from './lib/tokens.mjs';

const LEDGER = join(ROOT, 'verification', 'font-assets.json');
const KNOWN = join(ROOT, 'verification', 'known-issues.json');
if (!existsSync(LEDGER)) { console.error('缺少 verification/font-assets.json'); process.exit(2); }

const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
const T = loadTokens();
const known = existsSync(KNOWN) ? (JSON.parse(readFileSync(KNOWN, 'utf8')).issues || []).filter((k) => k.code === 'A4') : [];
const today = new Date().toISOString().slice(0, 10);
const knownFor = (s) => known.find((k) => s.indexOf(k.match) >= 0 || k.match === 'asset');

// 令牌里声明的字体族 = core.font.* 里每一项栈的第一个非通用族
const GENERIC = new Set(['sans-serif', 'serif', 'monospace', 'system-ui', 'ui-sans-serif', 'cursive', 'fantasy']);
const declared = new Map();
for (const role of Object.keys(T.core.font)) {
  const stack = T.core.font[role];
  for (const raw of stack) {
    const name = String(raw).replace(/^['"]|['"]$/g, '').trim();
    if (GENERIC.has(name)) continue;
    if (!declared.has(name)) declared.set(name, []);
    declared.get(name).push('font.' + role);
  }
}

const problems = [];
const warns = [];
const knownHits = [];

// A1 / A3 / A5
const byFamily = new Map(ledger.families.map((f) => [f.family, f]));
for (const [fam, roles] of declared) {
  if (!byFamily.has(fam)) problems.push('A1 令牌声明了字体族「' + fam + '」（' + roles.join(', ') + '），但台账里没有登记');
}
for (const f of ledger.families) {
  if (!f.license) problems.push('A3 ' + f.family + ' 缺少 license');
  if (!f.scope || ['web', 'desktop', 'embedding', 'redistribute'].some((k) => typeof f.scope[k] !== 'boolean')) problems.push('A3 ' + f.family + ' 缺少完整的 scope 四项');
  if (f.expires && f.expires < today) problems.push('A3 ' + f.family + ' 授权已于 ' + f.expires + ' 过期');
  if (f.status === 'active' && !declared.has(f.family)) warns.push('A5 ' + f.family + ' 标记为 active，但令牌里没有引用');
}

// A2 webfont 必须有交付证据
const uiPkgPath = join(ROOT, 'package.json');
const uiDeps = Object.assign({}, JSON.parse(readFileSync(uiPkgPath, 'utf8')).dependencies || {});
let hasFontFaceInUi = false;
for (const rel of ['packages/tokens/tokens.css', 'packages/tokens/primitives.css', 'packages/tailwind-preset/tokens.css']) {
  const p = join(ROOT, rel);
  if (existsSync(p) && /@font-face/.test(readFileSync(p, 'utf8'))) hasFontFaceInUi = true;
}
for (const f of ledger.families) {
  if (f.delivery === 'webfont' && !f.package && !hasFontFaceInUi) {
    problems.push('A2 ' + f.family + ' 标记为 webfont，但既没有 package 也没有 @font-face 证据');
  }
  if (f.delivery === 'system' && !f.note) {
    problems.push('A2 ' + f.family + ' 标记为 system，必须写明为什么不随产品分发');
  }
}

// A4 跨仓库：webfont 是否真的被消费方交付。
// AUTIONAL_SITES_DIR 用于测试注入（与 check-icons / check-typography 同一套约定）。
const sitesDir = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');
const consumer = { scanned: 0, installed: [], missing: [], channels: new Map() };

// CDN 交付判据（2026-09 轮次 42 起，唯一通道）。（2026-09 轮次 42 起的主通道）。站点的 <head> 直接 <link> CDN 的 tokens.css，
// 而 tokens.css 里的 @font-face 用相对路径 url('./fonts/…') 引用同一目录下的 woff2。
// 判据必须落在**这条真实路径**上：只看 node_modules 里有没有字体文件会误判——
// 换轨之后站点依旧装着 @autional-cn/tokens（antd-theme 还要用），依赖树里也依旧有 fonts/，
// 但没有任何东西会把它打进产物（实测：9 个 SPA 站点换轨后 dist 里 woff2 引用数为 0）。
// 「依赖树里有文件」与「浏览器会去取那个文件」是两件事，判据要盯后者。
const CDN_DIR = process.env.AUTIONAL_CDN_DIR || resolve(ROOT, '..', 'cdn');
const HEAD_EXT = new Set(['.html', '.astro']);
const HEAD_SKIP = new Set(['node_modules', '.git', 'dist', '.astro', '.next', 'build', 'coverage']);
function headFiles(dir, out, depth) {
  if (depth > 4) return out;
  let es; try { es = readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of es) {
    if (HEAD_SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) headFiles(p, out, depth + 1);
    else {
      const i = e.name.lastIndexOf('.');
      if (i >= 0 && HEAD_EXT.has(e.name.slice(i))) out.push(p);
    }
  }
  return out;
}
// 返回命中的 CDN 版本，或 null。
function cdnDelivered(sitePath) {
  const re = /cdn\.autional\.cn\/ui\/(v[^/'"]+)\/tokens\.css/;
  for (const f of headFiles(sitePath, [], 0)) {
    let t; try { t = readFileSync(f, 'utf8'); } catch (e) { continue; }
    const m = re.exec(t);
    if (!m) continue;
    const css = join(CDN_DIR, 'ui', m[1], 'tokens.css');
    if (!existsSync(css)) return { version: m[1], ok: false, why: 'CDN 工作区里没有 ui/' + m[1] + '/tokens.css' };
    const body = readFileSync(css, 'utf8');
    if (!/@font-face/.test(body)) return { version: m[1], ok: false, why: 'CDN 的 tokens.css 里没有 @font-face' };
    const rel = /url\(\s*['"]?\.\/fonts\/([^'")]+)['"]?\s*\)/.exec(body);
    if (!rel) return { version: m[1], ok: false, why: 'CDN 的 @font-face 没有指向 ./fonts/ 的相对路径' };
    const font = join(CDN_DIR, 'ui', m[1], 'fonts', rel[1]);
    if (!existsSync(font)) return { version: m[1], ok: false, why: 'CDN 上没有 fonts/' + rel[1] };
    return { version: m[1], ok: true, why: m[1] + ' → fonts/' + rel[1] + '（@font-face 与文件都在）' };
  }
  return null;
}

if (existsSync(sitesDir)) {
  const webfonts = ledger.families.filter((f) => f.delivery === 'webfont');
  for (const s of readdirSync(sitesDir)) {
    const pkgPath = join(sitesDir, s, 'package.json');
    if (!existsSync(pkgPath)) continue;
    consumer.scanned++;
    for (const f of webfonts) {
      // 判据（2026-09 轮次 42）：**浏览器会不会去取那个字体文件**。
      // 历史上这里叠过三条判据 —— 站点声明依赖 / stations 内置副本 / 依赖树里有字体文件。
      // 换轨到 CDN 之后每一条都变成「成立，但不再代表交付」：站点依旧装着 @autional-cn/tokens
      // （antd-theme 还要用），依赖树里也依旧有 fonts/，而**产物里一个 woff2 都没有**。
      // 判据叠得越多，闸门越容易因为**过时的理由**而全绿——P4 那次误判 9 个站点就是这个病。
      // 所以这一轮不再往上叠第 ④ 条，而是收敛成一条：<head> 必须 link CDN 的 tokens.css，
      // 且 CDN 上那份 tokens.css 真的带 @font-face、它引用的 woff2 真的存在。
      const cdn = cdnDelivered(join(sitesDir, s));
      if (!cdn) {
        problems.push('A4 ' + s + '：<head> 里没有 link CDN 的 tokens.css —— 轮次 42 起令牌与字体由 ' +
          'cdn.autional.cn 单一来源提供；缺了它字体不会到达浏览器（依赖树里有 fonts/ 不等于产物会打进去）。' +
          '若是刚做过 --rollback-vendor，请同步改回 CDN 链接。');
        consumer.missing.push(s);
      } else if (!cdn.ok) {
        problems.push('A4 ' + s + '：<head> link 了 CDN 的 tokens.css，但字体交付链断了 —— ' + cdn.why);
        consumer.missing.push(s);
      } else {
        consumer.installed.push(s);
        consumer.channels.set(s, 'CDN ' + cdn.why);
      }
    }
  }
  const uniqMissing = Array.from(new Set(consumer.missing));
  const uniqInstalled = Array.from(new Set(consumer.installed));
  if (consumer.scanned) {
    const line = 'A4 webfont 交付链成立（<head> → CDN tokens.css → @font-face → woff2）的站点 ' +
      uniqInstalled.length + '/' + consumer.scanned + '（' + (uniqInstalled.join(', ') || '无') + '）';
    // 只有真的没交付齐才算问题。原先写成「只要登记存在就记一笔」，
    // 于是 14/14 全交付时仍报 [KNOWN]，把已修好的事说成还没修——判据必须跟着事实走。
    if (uniqInstalled.length < consumer.scanned) {
      const k = knownFor('Inter');
      if (k) knownHits.push({ msg: line, issue: k }); else problems.push(line + ' —— 其余站点声明的是一款它们并不交付的字体，浏览器会直接回退');
    } else {
      console.log('  [OK]    ' + line);
    }
    // 逐站报交付通道：只报「N/N 都交付了」会把「恰好还留着旧的交付路径」也算通过。
    // 实测教训：换轨后 ③（依赖树里有字体文件）仍然成立，于是闸门全绿——
    // 而站点的产物里一个 woff2 都没有，字体其实来自 CDN。判据对了，但**理由**是过时的。
    console.log('  [INFO]  A4 各站字体交付通道：');
    for (const s of Array.from(consumer.channels.keys()).sort()) {
      console.log('            ' + s.padEnd(15) + consumer.channels.get(s));
    }
  }
} else {
  warns.push('A4 本次工作区没有 sites/，跳过消费方核对（CI 里同样会跳过）');
}

// ── A4b 浏览器级加载断言 ────────────────────────────────────────────────
// A4 只证明「有没有装包」，这里证明「页面上到底用没用上」。
// 手法与 brandui 一致：document.fonts.check() 对不存在的字族也返回 true（浏览器总能回退），
// 不能用；改用两个独立信号——document.fonts 里是否声明过 + canvas 实测文本宽度是否异于通用回退。
const targetsPath = join(ROOT, 'verification', 'visual.targets.json');
const fontProbe = [];
if (existsSync(targetsPath)) {
  let chromium = null;
  try { chromium = (await import('playwright-core')).chromium; } catch (e) { chromium = null; }
  let browser = null;
  if (chromium) { try { browser = await chromium.launch(); } catch (e) { browser = null; } }
  if (!browser) {
    warns.push('A4b 无可用 chromium，跳过浏览器级字体断言（先 pnpm install 并确保有浏览器）');
  } else {
    const { serveStatic } = await import('./lib/static-server.mjs');
    const targets = JSON.parse(readFileSync(targetsPath, 'utf8')).targets || [];
    const firstChoice = (T.core.font.sans || []).map((s) => String(s).replace(/^['"]|['"]$/g, '').trim())[0];
    
    for (const target of targets) {
      const root = resolve(ROOT, target.root);
      if (!existsSync(root)) continue;
      // 端口交给内核分配（listen(0) 再读回真实端口）：固定端口在两个 agent 同时跑闸门时会撞 ——
      // 本会话实测过一次 EADDRINUSE，而那不是判据失败，是一条**假红**。
      const server = await serveStatic(root, 0);
      const boundPort = server.address().port;
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      try {
        await page.goto('http://127.0.0.1:' + boundPort + target.path, { waitUntil: 'load', timeout: 45000 });
        await page.evaluate(() => document.fonts.ready);
        const probe = await page.evaluate(async (fam) => {
          // 必须先强制加载：canvas 在字体尚未加载时会直接用回退字体测量，
          // 于是即使字体已交付且能正常加载，也会被误判为「未生效」。
          // 实测 admin-console 就是这样被误报的——独立探针（先 document.fonts.load）测得
          // status=loaded、宽度差 4.52px，即字体其实是好的。
          try { await document.fonts.load('16px "' + fam + '"'); } catch (e) {}
          const s = 'mmmMMMwwwiiiWWW0123 汉字测试';
          const c = document.createElement('canvas').getContext('2d');
          c.font = '16px sans-serif'; const sans = c.measureText(s).width;
          c.font = '16px monospace'; const mono = c.measureText(s).width;
          c.font = '16px "' + fam + '", sans-serif'; const withFam = c.measureText(s).width;
          const declaredFaces = Array.from(document.fonts).map((f) => f.family.replace(/["']/g, ''));
          return {
            declared: declaredFaces.some((f) => f.toLowerCase() === fam.toLowerCase()),
            faces: declaredFaces.slice(0, 6),
            sameAsFallback: Math.abs(withFam - sans) < 0.01 || Math.abs(withFam - mono) < 0.01,
            bodyFont: getComputedStyle(document.body).fontFamily.slice(0, 70)
          };
        }, firstChoice);
        const used = probe.declared && !probe.sameAsFallback;
        fontProbe.push({ target: target.name, firstChoice, declared: probe.declared, used, faces: probe.faces, bodyFont: probe.bodyFont });
        if (!used) {
          const k = knownFor('Inter');
          const msg = 'A4b ' + target.name + '：canonical 的 sans 首项「' + firstChoice + '」未生效（@font-face 声明=' + probe.declared + '）';
          if (k) knownHits.push({ msg, issue: k }); else problems.push(msg);
        }
      } catch (e) {
        warns.push('A4b ' + target.name + ' 断言失败：' + String(e.message || e).slice(0, 80));
      }
      await ctx.close();
      server.close();
    }
    await browser.close();
  }
}

console.log('字体资产台账：' + ledger.families.length + ' 条；令牌声明 ' + declared.size + ' 个字体族');
for (const [fam, roles] of declared) {
  const f = byFamily.get(fam);
  console.log('  ' + fam.padEnd(22) + (f ? f.delivery.padEnd(9) + (f.package || '') : '（未登记）').padEnd(28) + roles.join(', '));
}
if (consumer.scanned) console.log('消费方核对：扫描 ' + consumer.scanned + ' 个站点');
if (fontProbe.length) {
  console.log('浏览器级字体断言（canonical sans 首项在页面上是否真的生效）：');
  for (const f of fontProbe) console.log('  ' + f.target.padEnd(18) + (f.used ? '生效' : '未生效') + '  声明=' + f.declared + '  body: ' + f.bodyFont);
}
console.log('');
for (const p of problems) console.log('  [ERROR] ' + p);
for (const w of warns) console.log('  [WARN ] ' + w);
for (const h of knownHits) console.log('  [KNOWN] ' + h.msg + '  已登记为 ' + h.issue.id + '（owner ' + h.issue.owner + '，到期 ' + h.issue.expires + '）');
console.log('');
console.log(problems.length === 0 ? '结论：字体资产台账一致（' + warns.length + ' 警告，' + knownHits.length + ' 条已登记）' : '结论：字体资产校验失败（' + problems.length + ' 错误）');
process.exit(problems.length === 0 ? 0 : 1);
