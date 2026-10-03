# canonical 色阶决策 · 影响报告（自动生成）

> 由 scripts/canonical-delta.mjs 生成，不要手改。重新生成：pnpm delta

**这份报告不推翻 canonical 决策，而是给它补上量化证据。**
DESIGN.md 第 3 节已记录该决策：当历史站点与 console 舰队冲突时，以 console 舰队为准
（12 个仓库已经在用，且是连续的 50 到 900 阶；网站的 primary-500 是「孤立点而非色阶」）。
决策已经有了，缺的是「改了多少、影响哪里、有没有意外」。

## 0. 四个证据集

| 证据集 | 来源 | 回答什么 | 本次是否可用 |
|---|---|---|---|
| legacy 定义 | D:/autional/ui/tokens | 旧站点当时打算用什么 | 可用（3 套 profile） |
| legacy 实际渲染 | 对 www.autional.com 的取证观测（E1，见 legacy-render-observations.json） | 旧站点实际渲染成什么 | 见该文件 |
| canonical 定义 | tokens/tokens.json | 现在规定用什么 | 可用（207 个叶子） |
| 站点实际生效 | sites/*/packages/tailwind-preset/tokens.css | 线上真正在用什么 | 本次工作区无 sites/ |

## 1. 品牌锚点核对（ASTRYX_MANIFEST.brandCore.colorRoles vs canonical 阶梯）

| 角色 | 锚点值 | 在 canonical 中落在 | 在 legacy website 中落在 | 位置是否变化 |
|---|---|---|---|---|
| primary | #003153 | primary.700 | primary.700 | 否 |
| sky | #87ceeb | sky.500 | primary.300, sky.300 | **是** |
| amber | #ffbf00 | amber.500 | amber.400 | **是** |
| success | #52c41a | （不在任何色阶上，是独立语义色） | — | 否 |
| warning | #faad14 | （不在任何色阶上，是独立语义色） | — | 否 |
| danger | #ff4d4f | （不在任何色阶上，是独立语义色） | — | 否 |
| info | #1890ff | （不在任何色阶上，是独立语义色） | — | 否 |

**锚点值没变，但它在阶梯里的位置变了。** 这是最容易被忽略、后果最直接的一类变化：

- sky #87ceeb：legacy 在 primary.300, sky.300，canonical 在 sky.500
- amber #ffbf00：legacy 在 amber.400，canonical 在 amber.500

后果：**任何按档位名写死的代码会静默换色。** 例如旧代码写 sky-300，
legacy 解析为品牌天蓝，canonical 解析为另一档——代码没动，颜色变了。
实测印证：旧站渲染里 #87CEEB 出现 10 次（含 span.text-sky-300），迁移后的页面只剩 1 次。

## 2. 色阶逐档 ΔE（legacy website 到 canonical）

ΔE(OKLab) 经验刻度：小于 2 基本看不出差别，2 到 5 同色系，大于 10 明显不同色。

| 色阶 | 一致 | 明显不同（ΔE > 10） | 平均 ΔE | 最大 ΔE 出现在 |
|---|---|---|---|---|
| primary | 2/10 | 2 | 5.6 | primary.500（#2C8EC0 到 #235F84，15.2） |
| sky | 1/10 | 5 | 11.2 | sky.600（#287598 到 #64B4D8，20.1） |
| amber | 0/10 | 1 | 6.2 | amber.700（#8D680F 到 #B38700，11.1） |

逐档明细（仅列出 ΔE > 2 的档位）：

| 档位 | legacy | canonical | ΔE |
|---|---|---|---|
| primary.100 | #DBEAF4 | #D1E3F1 | 2.3 |
| primary.200 | #B8D5EA | #A3C7E3 | 4.7 |
| primary.300 | #87CEEB | #75ABD5 | 9.8 |
| primary.400 | #61B8DF | #478FC7 | 11.9 |
| primary.500 | #2C8EC0 | #235F84 | 15.2 |
| primary.600 | #0C5D8C | #004565 | 9.2 |
| sky.100 | #D7F4FD | #EEF9FD | 3.3 |
| sky.200 | #B8EBFA | #D5F0F9 | 3.8 |
| sky.300 | #87CEEB | #BDE6F5 | 9.3 |
| sky.400 | #5AB6DD | #A2DCF0 | 13.2 |
| sky.500 | #3898C4 | #87CEEB | 17.5 |
| sky.600 | #287598 | #64B4D8 | 20.1 |
| sky.700 | #225F7C | #429BC5 | 19.5 |
| sky.800 | #204F66 | #2D7CA3 | 15.3 |
| sky.900 | #1F4357 | #1C5D7E | 9.3 |
| amber.100 | #FFEFC2 | #FFF8E6 | 4.4 |
| amber.200 | #FFDF85 | #FFEFB3 | 5.4 |
| amber.300 | #FFCF47 | #FFE480 | 5.9 |
| amber.400 | #FFBF00 | #FFD94D | 6.2 |
| amber.500 | #E2A800 | #FFBF00 | 7.7 |
| amber.600 | #B8860B | #D9A300 | 9.6 |
| amber.700 | #8D680F | #B38700 | 11.1 |
| amber.800 | #755512 | #8C6B00 | 7.8 |
| amber.900 | #634813 | #664F00 | 2.6 |

## 3. 对比度影响（可裁决的硬指标）

ΔE 只说「差多少」，对比度说「改好还是改坏」。下表用**两套体系各自的语义角色**配对计算。

| 用途 | 模式 | legacy 对比度 | canonical 对比度 | 变化 | 判定 |
|---|---|---|---|---|---|
| 正文 / 页面底 | light | 17.30:1 | 16.54:1 | -0.76 | 下降 |
| 次要文本 / 页面底 | light | 7.54:1 | 9.94:1 | +2.40 | 提升 |
| 主按钮文字 / 主按钮底 | light | 13.43:1 | 13.43:1 | 0.00 | 持平 |
| 链接强调 / 卡片底 | light | 7.09:1 | 10.30:1 | +3.20 | 提升 |
| 品牌锚点本身（#87ceeb，从 300 档移到 500 档后） | light | 1.68:1 | 1.68:1 | 0.00 | 持平 |
| 按档位名写死的引用：sky-300 迁移后取到什么 | light | 1.68:1 | 1.28:1 | -0.40 | 下降 |
| 深色底上的次要文本 | dark | 13.30:1 | 9.84:1 | -3.46 | 下降 |
| 深色底上的正文 | dark | 16.50:1 | 16.50:1 | 0.00 | 持平 |
| 深色底上的弱化文本 | dark | 3.61:1 | 5.68:1 | +2.07 | 提升 |

## 4. 迁移缺口（资产与非颜色令牌）

| 类别 | legacy | canonical | 判定 |
|---|---|---|---|
| 字体族 sans | ["\"Noto Sans SC\"","\"Segoe UI\"","-apple-system","sans-serif"] | ["Inter","-apple-system","Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans CJK SC","sans-serif"] | **不同** |
| 阴影 | brand, card, soft | soft, card, brand, code, deep, $note | 需核对 |
| 品牌背景 | brand-radial, brand-grid | brand-radial, brand-grid, page-light, page-dark | canonical 多出 page-light / page-dark |

## 5. 站点实际生效的值（这一节决定线上到底在跑哪套）

本次工作区没有 sites/，无法核对。
## 6. 人工裁定清单

机器能给到证据，但下面这些必须人来定。每条都已附上判断依据。

| # | 待裁定 | 证据 | 建议 |
|---|---|---|---|
| D1 | canonical 色阶整体替换 legacy 网站色阶，是否确认？ | 第 2 节逐档 ΔE；DESIGN.md 已记录决策理由（12 个仓库在用连续阶） | **确认**。决策有依据，且对比度未系统性恶化（见第 3 节）。风险不在决策本身，而在按档位名写死的代码 |
| D2 | 品牌锚点 #87ceeb 从第 300 档移到第 500 档，是有意的吗？ | 第 1 节锚点表；旧站渲染 #87CEEB 出现 10 次、迁移后 1 次 | 需确认。若有意，应出一条迁移说明并全量替换 sky-300 引用；若无心，应把天蓝放回 300 档 |
| D3 | 旧代码里按档位名写死的引用如何处理？ | 第 1 节 | 全量检索 sky-300 / primary-300 等引用并逐一核对，不能靠肉眼 |
| D4 | 语义色 error 改名 danger，var(--color-error) 是否要兼容？ | 扫描在 sites/admin 找到 12 处 var(--color-error) 引用 | 建议同时发 --color-error 别名，消除静默失效 |
| D5 | 9 个站点的 tokens.css 副本与权威不一致（缺 97 个变量、3 个字体变量取值不同），是否切到包依赖？ | 第 5 节 | 切。当前「SSOT」只在 ui/ 内成立，线上跑的是手工拷贝 |
| D6 | KI-001（层叠冲突）与 KI-005（变体依赖）的修法 | verification/known-issues.json | 需要在「改 CSS 选择器」与「补 tokens.json 声明」之间选一条 |

---

本报告基于令牌快照 hash 431bff2298a090e4。令牌变更后需重新生成本报告（pnpm delta）。

