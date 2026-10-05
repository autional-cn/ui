#!/usr/bin/env node
// check-antd-bridge — 设计系统 → antd 的**组件级令牌是不是真的生效**
// 用法: node scripts/check-antd-bridge.mjs
//
// 为什么需要它：
//   组件级 token 有一条「配了等于没配」的历史 —— 桥里写过 cellPaddingBlock / cellPaddingInline，
//   而 antd 的 Table 在 middle 尺寸下读的是 cellPaddingBlockMD，于是那两行在浏览器里**什么都没改**，
//   而且看不出来任何异常（见 scripts/generate.mjs 的注释）。同类风险还有 L19 的卡片边框：
//   桥里写 Card.colorBorderSecondary 是一回事，antd 的 Card 把它用在自己的 border 上是另一回事。
//   静态断言只能证明「桥上写了这个键」，证明不了「站点看到的东西变了」。
//   所以这条闸门把桥下发的东西**在真实 chromium 里渲染出来量一遍**。
//
// 判据（正负对照在同一次渲染里同时给出，缺一半就不成立）：
//   ① 桥下发的值必须等于令牌 --color-border-subtle（浅色 / 深色两套）；
//   ② 走桥的 Card 的**计算样式**必须等于那个值；
//   ③ 同一页里「同样的 token、但不给 components」的 Card 必须**不等于**它
//      —— 少了③，一个被 antd 完全忽略的键也会让②「通过」，因为期望值正是它自己。
//
// 无 esbuild / 无 chromium 时跳过（与其他浏览器闸门同一约定）。

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { ROOT, loadTokens, resolvedIn } from './lib/tokens.mjs';

const problems = [];
const warns = [];
const info = [];

const BRIDGE = join(ROOT, 'packages', 'tokens', 'dist', 'antd-theme.mjs');
if (!existsSync(BRIDGE)) {
  console.log('check-antd-bridge：找不到 ' + BRIDGE + '（先跑 pnpm gen），跳过');
  process.exit(0);
}

const bridge = (await import(pathToFileURL(BRIDGE).href)).default;
const TOKENS = loadTokens();
const expectLight = resolvedIn(TOKENS, {})['color.border-subtle'];
const expectDark = resolvedIn(TOKENS, { variant: 'dark' })['color.border-subtle'];
// KI-016 / KI-017：侧栏**选中态**（Menu）的柔和底 + 文字角色。此前桥里没有 Menu 组件级 token，
// antd 便从 colorPrimary 自行推导选中底色（实测 rgb(133,144,148)），#003153 铺上去只有 4.1:1。
const menuBgLight = resolvedIn(TOKENS, {})['color.primary-soft'];
const menuBgDark = resolvedIn(TOKENS, { variant: 'dark' })['color.primary-soft'];
const menuFgLight = resolvedIn(TOKENS, {})['color.brand-text'];
const menuFgDark = resolvedIn(TOKENS, { variant: 'dark' })['color.brand-text'];

// ① 桥上声明的值必须等于令牌（令牌是 SSOT，桥是它的投影）
for (const [mode, expect, declared] of [
  ['light', expectLight, bridge.light.components?.Card?.colorBorderSecondary],
  ['dark', expectDark, bridge.dark.components?.Card?.colorBorderSecondary],
]) {
  if (!declared) {
    problems.push('antd-bridge 桥（' + mode + '）没有下发 Card.colorBorderSecondary —— antd 的 Card 边框会回落到 antd 出厂值，与设计系统的 SectionCard 不是一个颜色（L19）');
  } else if (String(declared).toLowerCase() !== String(expect).toLowerCase()) {
    problems.push('antd-bridge 桥（' + mode + '）下发的 Card.colorBorderSecondary=' + declared + '，而令牌 color.border-subtle=' + expect + ' —— 桥与 SSOT 不一致');
  }
}

// ①-b 同上，但针对 Menu 的两个键（缺了它们 antd 会自己推导选中底色）
for (const [mode, bgExpect, fgExpect, comps] of [
  ['light', menuBgLight, menuFgLight, bridge.light.components?.Menu],
  ['dark', menuBgDark, menuFgDark, bridge.dark.components?.Menu],
]) {
  if (!comps?.itemSelectedBg || !comps?.itemSelectedColor) {
    problems.push('antd-bridge 桥（' + mode + '）没有下发 Menu.itemSelectedBg / itemSelectedColor —— 侧栏选中态会回落到 antd 从 colorPrimary 自行推导的底色（KI-016 / KI-017）');
  } else {
    if (String(comps.itemSelectedBg).toLowerCase() !== String(bgExpect).toLowerCase()) {
      problems.push('antd-bridge 桥（' + mode + '）下发的 Menu.itemSelectedBg=' + comps.itemSelectedBg + '，而令牌 color.primary-soft=' + bgExpect + ' —— 桥与 SSOT 不一致');
    }
    if (String(comps.itemSelectedColor).toLowerCase() !== String(fgExpect).toLowerCase()) {
      problems.push('antd-bridge 桥（' + mode + '）下发的 Menu.itemSelectedColor=' + comps.itemSelectedColor + '，而令牌 color.brand-text=' + fgExpect + ' —— 桥与 SSOT 不一致');
    }
  }
}

// ── 探针页：同页四张卡 + 三个选中态菜单，一次采集给出正负对照 ────────────
const PROBE = join(ROOT, 'packages', 'ui', 'node_modules', '.antd-bridge-probe');
// 探针在 packages/ui/node_modules/ 下（那里才解析得到 antd/react），桥在 packages/tokens/dist/，
// 所以用相对路径引它 —— esbuild 不解析 file:// 形式的 specifier。
const BRIDGE_FROM_PROBE = relative(PROBE, BRIDGE).split(sep).join('/');

const MAIN = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, Card, Menu, theme } from 'antd';
import antdTheme from '${BRIDGE_FROM_PROBE}';

const cases = [
	['with-bridge', { token: antdTheme.light.token, components: antdTheme.light.components }],
	['without-components', { token: antdTheme.light.token }],
	['dark-with-bridge', { algorithm: theme.darkAlgorithm, token: antdTheme.dark.token, components: antdTheme.dark.components }],
];

createRoot(document.getElementById('root')).render(
	<StrictMode>
		{cases.map(([name, t]) => (
			<div key={name} style={{ padding: 12 }}>
				<ConfigProvider theme={t}>
					<Card title={name}>probe</Card>
					<Menu mode="inline" selectedKeys={[name]} items={[{ key: name, label: name }]} />
				</ConfigProvider>
			</div>
		))}
	</StrictMode>,
);
`;

const HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="./bundle.js"></script></body></html>';

let chromium;
try { chromium = (await import('playwright-core')).chromium; } catch (e) { chromium = null; }
if (!chromium) { console.log('check-antd-bridge：没有 playwright-core，跳过'); process.exit(0); }

let esbuild;
try { esbuild = await import('esbuild'); } catch (e) { esbuild = null; }
if (!esbuild) { warns.push('没有 esbuild，无法构建探针页 —— 这条闸门本次未执行'); }

let server;
let browser;
if (esbuild) {
  try {
    mkdirSync(PROBE, { recursive: true });
    writeFileSync(join(PROBE, 'index.html'), HTML);
    writeFileSync(join(PROBE, 'main.tsx'), MAIN);
    await esbuild.build({
      entryPoints: [join(PROBE, 'main.tsx')],
      bundle: true,
      outfile: join(PROBE, 'bundle.js'),
      jsx: 'automatic',
      format: 'iife',
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
    });
    server = createServer((req, res) => {
      const file = req.url === '/' ? 'index.html' : decodeURIComponent(String(req.url).split('?')[0]).replace(/^\//, '');
      const p = join(PROBE, file);
      if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
      res.end(readFileSync(p));
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const port = server.address().port;
    try { browser = await chromium.launch(); } catch (e) { warns.push('没有可用 chromium —— 这条闸门本次未执行：' + String(e.message || e).slice(0, 80)); }
    if (browser) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
      await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' });
      await page.waitForSelector('.ant-card', { timeout: 20000 });
      await page.waitForTimeout(500);
      const measured = await page.evaluate(() => {
        const out = {};
        for (const el of document.querySelectorAll('.ant-card')) {
          const t = el.querySelector('.ant-card-head-title');
          if (t) out[String(t.textContent).trim()] = getComputedStyle(el).borderTopColor;
        }
        return out;
      });
      const rgb = (hex) => {
        const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
        return m ? 'rgb(' + parseInt(m[1], 16) + ', ' + parseInt(m[2], 16) + ', ' + parseInt(m[3], 16) + ')' : null;
      };
      const rows = [];
      for (const [name, hex] of [['with-bridge', expectLight], ['dark-with-bridge', expectDark]]) {
        const got = measured[name];
        if (got === undefined) { problems.push('antd-bridge 探针页没有渲染出「' + name + '」这张卡 —— 探针本身坏了，这条闸门失去意义'); continue; }
        rows.push('  ' + name.padEnd(20) + ' 实测 ' + got.padEnd(20) + ' 期望 ' + rgb(hex) + (got === rgb(hex) ? '  ✅' : '  ❌'));
        if (got !== rgb(hex)) problems.push('antd-bridge「' + name + '」的 antd Card 边框实测 ' + got + '，期望 ' + rgb(hex) + '（令牌 color.border-subtle）—— 组件级令牌下发了但 antd 没有吃到，站点看到的仍是出厂值');
      }
      // ③ 阴性对照：同样的 token、不给 components，必须与阳性不同
      const neg = measured['without-components'];
      if (neg === undefined) problems.push('antd-bridge 探针页没有渲染出阴性对照卡 —— 少了对照，阳性断言不成立');
      else {
        rows.push('  ' + 'without-components'.padEnd(20) + ' 实测 ' + neg.padEnd(20) + ' 期望 ≠ ' + rgb(expectLight) + (neg !== rgb(expectLight) ? '  ✅' : '  ❌'));
        if (neg === rgb(expectLight)) problems.push('antd-bridge 阴性对照与阳性同值（都是 ' + neg + '）—— 测量没有区分力：这个颜色不是 components 带来的，阳性断言等于什么都没验');
      }
      // ── Menu 选中态：同样的三重口径 ────────────────────────────────────
      const menuMeasured = await page.evaluate(() => {
        const out = {};
        for (const li of document.querySelectorAll('li.ant-menu-item-selected')) {
          const cs = getComputedStyle(li);
          out[String(li.textContent).trim()] = { bg: cs.backgroundColor, color: cs.color };
        }
        return out;
      });
      for (const [name, bgHex, fgHex] of [
        ['with-bridge', menuBgLight, menuFgLight],
        ['dark-with-bridge', menuBgDark, menuFgDark],
      ]) {
        const got = menuMeasured[name];
        if (!got) { problems.push('antd-bridge 探针页没有渲染出「' + name + '」的选中态菜单项 —— 探针本身坏了，Menu 这一组断言失去意义'); continue; }
        const bgOk = got.bg === rgb(bgHex), fgOk = got.color === rgb(fgHex);
        rows.push('  ' + (name + ' menu').padEnd(20) + ' 实测 ' + got.bg.padEnd(20) + ' 期望 ' + rgb(bgHex) + (bgOk ? '  ✅' : '  ❌') +
          '   文字 ' + got.color + (fgOk ? ' ✅' : ' ❌ 期望 ' + rgb(fgHex)));
        if (!bgOk) problems.push('antd-bridge「' + name + '」的 antd Menu 选中底色实测 ' + got.bg + '，期望 ' + rgb(bgHex) + '（令牌 color.primary-soft）—— 组件级令牌下发了但 antd 没有吃到（KI-016 / KI-017）');
        if (!fgOk) problems.push('antd-bridge「' + name + '」的 antd Menu 选中文字实测 ' + got.color + '，期望 ' + rgb(fgHex) + '（令牌 color.brand-text）—— 同上');
      }
      // 阴性对照：不给 components 时必须与阳性不同（否则这一组断言等于什么都没验）
      const menuNeg = menuMeasured['without-components'];
      if (!menuNeg) problems.push('antd-bridge 探针页没有渲染出 Menu 的阴性对照 —— 少了对照，Menu 的阳性断言不成立');
      else {
        rows.push('  ' + 'without-components menu'.padEnd(20) + ' 实测 ' + menuNeg.bg.padEnd(20) + ' 期望 ≠ ' + rgb(menuBgLight) + (menuNeg.bg !== rgb(menuBgLight) ? '  ✅' : '  ❌'));
        if (menuNeg.bg === rgb(menuBgLight)) problems.push('antd-bridge Menu 阴性对照与阳性同值（都是 ' + menuNeg.bg + '）—— 测量没有区分力：这个底色不是 components 带来的');
      }
      info.push('antd-bridge 实测（真实 chromium）：\n' + rows.join('\n'));
    }
  } catch (e) {
    problems.push('antd-bridge 探针执行失败：' + String(e.message || e).slice(0, 200));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((done) => server.close(done));
    rmSync(PROBE, { recursive: true, force: true });
  }
}

for (const w of warns) console.log('⚠ ' + w);
for (const i of info) console.log(i);
for (const p of problems) console.log('✗ ' + p);
if (problems.length) {
  console.log('\ncheck-antd-bridge：' + problems.length + ' 项未通过');
  process.exit(1);
}
console.log('check-antd-bridge：通过（组件级令牌在真实浏览器里生效，且阴性对照有区分力）');
