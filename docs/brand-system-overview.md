# 品牌系统总览

这份文档用于快速总结当前 Autional 已落地品牌系统的核心要点，方便在开始新项目或新页面前先统一认识。

## 1. 品牌基调

当前品牌表达保持以下方向：

- 企业级
- 安全可信
- SaaS 产品化
- 数据可视化倾向
- 现代但克制

避免：

- 过度营销化
- 模板站气质过重
- 配色和阴影体系随意漂移

## 2. 核心颜色

当前三套站点共享的核心品牌角色：

- `primary`：深蓝，主品牌色
- `sky`：天蓝，辅助强调
- `amber`：琥珀黄，点缀和提醒

使用原则：

- 主体依赖 `primary`
- 局部高光和轻强调用 `sky`
- 点缀和关键强调才使用 `amber`

## 3. 字体策略

- 拉丁与界面主字体：`Inter`（自托管 `@fontsource`）
- 中文：系统栈 `PingFang SC` / `Microsoft YaHei` / `Noto Sans CJK SC`
- 辅助字体：`Source Han Serif SC`
- 等宽：`JetBrains Mono` / `Fira Code` / `Consolas`

使用原则：

- 默认界面和正文使用无衬线
- 通过字重、字距和层级建立风格
- 尽量不在单页中混用太多字体气质
- 中文字体不走 webfont：CJK 子集普遍超过 2MB，首屏 LCP 不可接受

## 4. 共享视觉组件

当前已沉淀的基础品牌类：

- `brand-shell`
- `brand-card`
- `brand-button-primary`
- `brand-button-secondary`
- `brand-kicker`
- `brand-grid`

站点差异化扩展：

- 开发者站：`developer-panel`、`developer-code`、`developer-chip`
- 文档站：`docs-nav-link`、`docs-prose`

## 5. Logo 使用策略

当前线上已经验证过的策略：

- Header：图形标 + 文字品牌名
- Footer：尽量克制，必要时仅保留文字品牌名
- favicon：使用图形标的小尺寸版本

注意事项：

- 不直接把设计源 SVG 原样塞进站点
- 接入前检查是否带白底、留白是否过大、`viewBox` 是否合理、是否会被拉伸

## 6. 代码块与可读性

品牌化不等于只看“好不好看”，还必须看：

- 大标题多行时行高是否够用
- 深色代码块中的文字是否足够清晰
- 弱化文字与背景之间是否仍然能读清
- JSX / HTML 风格代码是否被错误解析

在文档站的经验中，代码块问题有时根因不是颜色，而是渲染方式错误。

## 7. 适合直接复用的资料

如果你准备做新站点，优先看：

1. `README.md`
2. `docs/guidelines/website-ui-brand-guidelines.md`
3. `packages/tokens/primitives.css`（共享品牌类）
4. `packages/tailwind-preset/index.js`（Tailwind 主题）
5. 再根据场景看开发者站或文档站的专用资料

## 8. 当前结论

本仓（`autional/ui`）是 Autional 设计系统的单一真源：

- 看值：`tokens/tokens.json`（SSOT；改完跑 `pnpm gen`）
- 看规范：`DESIGN.md` + `docs/guidelines/`
- 看案例：`docs/case-studies/`
- 拿资源：`assets/logo/`、`assets/favicon/`
- 用类名：`packages/tokens/primitives.css`
- 用令牌：`@autional/tokens` / `@autional/tailwind-preset`
- 查契约：`node astryx-manifest-cli.mjs …`

`legacy/` 只作迁移参考，新站点不要消费。
