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

## 校验（pnpm verify）

七条互补的检查，只跑其中任何一个都会留下盲区：

| 命令 | 问的问题 | 抓什么 |
|---|---|---|
| `pnpm gen:check` | 产物跟得上 SSOT 吗 | 改了 tokens.json 却没重新生成 |
| `pnpm lint:tokens` | SSOT 的值本身站得住吗 | 类型错误、悬空引用、**层叠冲突**、对比度不达标、已知问题过期 |
| `pnpm lock:check` | SSOT 被改动过吗 | 改了什么必须登记（reason + owner + expires） |
| `pnpm verify` | 以上七条一起跑 | 任一失败即退出码 1 |
| `pnpm delta` | canonical 色阶决策改了多少 | 生成 `verification/canonical-decision/report.md`（令牌变更后需重生成，T11 会检查是否过期） |
| `pnpm assets:fonts` | 字体是真的交付了吗 | 台账 A1–A5 + **浏览器级加载断言**（canonical 的 sans 首项在页面上是否真的生效） |
| `pnpm visual` | 站点改完看起来对不对 | 对已构建的站点产物做像素 + SSIM 回归（3 个目标：web / admin-console / developer） |
| `pnpm visual:baseline` | 重建视觉基线 | 只在环境变化时跑（基线绑定浏览器版本与平台） |
| `pnpm typography` | 排版令牌真的落地了吗 | 发布 CSS 里的阶梯外字号（TY1）、消费方编译产物里**用旧阶梯编译的过期产物**（TY3）、**品牌字号采用率**（TY4）、**共享组件层有没有消费方**（TY5） |

**为什么需要后两条**：改了 `tokens.json` 再跑一次 `pnpm gen`，`gen:check` 就完全无感——产物是最新的。
实测：把 `color.primary.500` 从 `#235f84` 改成 `#236085` 并重新生成后，`gen:check` 报 OK，
只有快照锁拦住了它。

**为什么需要排版这一条**：颜色令牌在产物里是 `var(--color-*)`，会随令牌走；排版令牌在编译期就被写成了字面量
（实测同一份产物里 `var(--color-*)` 204 处、`var(--font-size-*)` **0** 处）。所以改 `tokens.json` 的排版，
已经编译好的产物不会跟——而 `gen:check` 只比「产物 vs SSOT」（两边都是新的，一致），`lock:check` 只比「SSOT 有没有被改」（没改），
两道门都看不见下游的过期字面量。TY3 就是补这个盲区：它拿同名工具类的取值与当前阶梯对表，
实测一份停在旧阶梯的产物（`.text-heading-lg` 32px，当前 30px）会被判失败。

改动被拦下时有两个出口，都不是「关掉检查」：

- **有意的改动** → 在 `verification/token-change-approvals.json` 登记，或运行 `pnpm lock` 重建快照；
- **已知的债** → 在 `verification/known-issues.json` 登记（必须给 owner 与到期日，到期即失败）。

`verification/` 目录下的文件：

| 文件 | 作用 |
|---|---|
| `contrast-pairs.json` | 对比度契约：每条 (前景, 背景, 最小值) 都会在所有 profile × 主题下计算 WCAG 比值 |
| `known-issues.json` | 已知问题登记：把 DESIGN.md 里「fix when touched, do not propagate」的债变成有期限的机器约束 |
| `token-change-approvals.json` | 令牌变更登记 |
| `tokens.lock.json` | 令牌快照（生成物，勿手改） |

CI：`.github/workflows/verify.yml`，push 与 PR 都会跑这三条。

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
- [`docs/case-studies/2026-09-fleet-token-migration.md`](docs/case-studies/2026-09-fleet-token-migration.md) — **站群接入设计系统：9 条已知问题的修复记录**（根因 / 逐条证据 / 有意改变渲染的部分 / 需人工确认的判断 / 回滚方式）
- [`ASTRYX_MANIFEST.json`](ASTRYX_MANIFEST.json) — 机器可读契约

## 授权

AGPL-3.0，见 [`LICENSE`](LICENSE)。
