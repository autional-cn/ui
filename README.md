# Autional UI — canonical design system

单一真源的设计令牌仓库。18 个前端站点（8 个 SPA 门户 + www / docs / reference / wiki / developer）
从这里取品牌色、语义色、字阶、间距、圆角、阴影、动效与共享品牌类，不再各仓自造。

**唯一的 SSOT 是 [`tokens/tokens.json`](tokens/tokens.json)。** 它生成全部产物；生成物已入库，
消费者不需要构建步骤。文档与 JSON 冲突时以 JSON 为准。

## 目录结构

```text
ui/
├── tokens/tokens.json          ← 唯一手写文件（L1 core / L2 profiles / L3 variants）
├── scripts/generate.mjs        ← 生成器：pnpm gen / pnpm gen:check
├── packages/
│   ├── tokens/                 @autional-cn/tokens
│   │   ├── tokens.css          生成：L1 core + [data-theme] 变体块
│   │   ├── profiles/*.css      生成：L2 profile 覆盖（docs / developer）
│   │   ├── primitives.css      手写：品牌类 + 内容站 base 层
│   │   └── dist/               生成：tokens.json / index.d.ts / antd-theme.js / chart.js
│   └── tailwind-preset/        @autional-cn/tailwind-preset（生成）
├── assets/{logo,favicon}/      品牌图形与 favicon（唯一一套）
├── docs/                       规范细则（guidelines / case-studies / 资产套件说明）
├── DESIGN.md                   ← 设计规范 v1.0（人读；值与 JSON 保持一致）
├── ASTRYX_MANIFEST.json        ← 机器契约（站点 profile / 原语 / 资产 / 漂移策略）
├── astryx-manifest-cli.mjs     ← 契约查询 CLI
└── legacy/                     迁移参考（旧 tailwind 配置与全局样式，勿消费）
```

## 快速开始

```bash
pnpm install
pnpm gen          # 重新生成 packages/* 产物（改完 tokens.json 必跑）
pnpm gen:check    # 校验产物与 SSOT 一致（CI 用，有漂移退出 1）
```

站点接入：

```css
/* app/site 入口样式 */
@import '@autional-cn/tailwind-preset/tokens.css';   /* L1 core + 变体 */
@import '@autional-cn/tokens/profiles/docs.css';     /* L2，按站点选，必须在 core 之后 */
@import '@autional-cn/tokens/primitives.css';        /* 内容站共享品牌类 */
```

```ts
// tailwind.config.ts
import preset from '@autional-cn/tailwind-preset';
export default { darkMode: 'class', presets: [preset], content: ['./src/**/*.{ts,tsx}'], theme: { extend: {} } };
```

```tsx
// antd 应用：令牌桥接，别让组件回落到 antd 默认蓝
import antdTheme from '@autional-cn/tokens/antd-theme';
<ConfigProvider theme={{ algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
                         token: (isDark ? antdTheme.dark : antdTheme.light).token }}>
```

## 站群与 profile 对照

| profile | 站点 | 差异 |
|---|---|---|
| `console` | admin / auth / user / security / status / trust / platform / authenticator | 基线，不覆盖 L1 |
| `marketing` | web | 深色模式（`darkMode: 'class'`）、品牌背景图、完整暗色站 |
| `docs` | docs / reference / wiki | 更冷的 primary/sky 阶梯、更大的柔和阴影 |
| `developer` | developer | 与 docs 同阶（历史同源） |

L3 变体（沿用 `[data-theme]` 名）：`portal`、`auth`、`authenticator`（dark-first 纯黑，
压过 `.dark`）、`auth-tenant`（运行时注入租户品牌色，不产出样式表）。

## 契约查询

```bash
node astryx-manifest-cli.mjs sites
node astryx-manifest-cli.mjs resolve site:docs-site
node astryx-manifest-cli.mjs primitive docs-prose
node astryx-manifest-cli.mjs search token
```

## 硬约束

- 品牌色只用 primary / sky / amber 三族 + 语义色；不引入体系外颜色。
- 不手改 `packages/` 下的生成物；改 `tokens/tokens.json` 后跑 `pnpm gen`。
- 不在应用里写本地 `[data-theme]` / `.dark` 覆盖去重述令牌值——要改就改令牌。
- `.cn` 与 `.com` 双生站点的设计文件逐字节相同，改动同轮落到两侧。

## 相关文档

- [`DESIGN.md`](DESIGN.md) — 设计规范 v1.0（令牌架构 / 色彩 / 暗色 / 排版 / 动效 / 无障碍 / 组件 / 图标 / 资产治理）
- [`docs/brand-system-overview.md`](docs/brand-system-overview.md) — 品牌系统总览
- [`docs/logo-favicon-kit.md`](docs/logo-favicon-kit.md) — 图形标与 favicon 套件
- [`docs/guidelines/`](docs/guidelines) — 分站点落地规范
- [`docs/case-studies/`](docs/case-studies) — 三次品牌化改造复盘
- [`ASTRYX_MANIFEST.json`](ASTRYX_MANIFEST.json) — 机器可读契约

## 授权

AGPL-3.0，见 [`LICENSE`](LICENSE)。
