# 站群接入设计系统：9 条已知问题的修复记录（2026-09）

> 本文是 `verification/known-issues.json` 从 9 条清空到 0 条的完整记录。
> 每条都给出根因、修法与可复核的证据；**有意改变渲染的部分单列一章，需要人工复核**。

## 0. 结果

| 项目 | 之前 | 之后 |
|---|---|---|
| 已知问题登记 | 9 条 | **0 条** |
| `pnpm verify` | 7 项 | 7 项全 PASS |
| 消费者副本一致性 | 9 个副本，9 个漂移 | **42 个副本，0 漂移** |
| 字体实际交付（A4） | 2/14 站点 | **14/14** |
| 浏览器字体断言（A4b） | 三目标均「未生效」 | **三目标「生效」** |
| 站点受品牌预设管辖（TY4b） | 5 个 Astro 站点不受管辖 | **14/14** |
| 共享组件层消费方（TY5） | 0/14 | **6/14**（= 全部使用 `.brand-*` 的站点） |

改动落在两个层面：`ui/` 仓库（生成器、校验层、令牌）与 **14 个站点仓库各自一个提交**。

## 1. 根因：一个，不是九个

表面上是九条独立问题，实测下来是同一件事的三种形态——**舰队名义上消费设计系统，实际没有**。

三种形态：

1. **伪造的命名空间**（9 个 SPA 站点）：站点里写着
   `@import '@autional-cn/tailwind-preset/tokens.css'`，读起来像在消费设计系统。
   但每个站点在自己仓库内有一个同名包，锁文件解析为
   `'@autional-cn/tailwind-preset': { specifier: workspace:*, version: link:../../packages/tailwind-preset }`。
   那个 namespace 是被内置分支伪造的。
2. **配置层内联**（5 个 Astro 站点：docs / developer / web / reference / wiki）：
   连 `packages/` 目录都没有，不 import 任何令牌，而是在 `tailwind.config.cjs` 里
   内联 primary/sky/amber 整套色阶，并用 `@apply` 自己重写 `.brand-*` 与 `.docs-prose`。
3. **编译期字面量**：排版令牌在产物里是写死的字面量而非变量（实测同一份产物里
   `var(--color-*)` 204 处、`var(--font-size-*)` **0** 处），于是改令牌不会传导到已编译的产物，
   而 `gen:check` 与 `lock:check` 都看不见下游的过期字面量。

## 2. 逐条修复

### 2.1 令牌层（KI-001 – KI-005）—— 改的是生成器与契约，不是值

| 编号 | 问题 | 修法 | 证据 |
|---|---|---|---|
| KI-005 | `authenticator` 变体不可独立成立 | 实现 `$extends`，生成期展开 `dark` 的完整令牌集 | 有效键 10 → 26；浏览器实测单独应用 `[data-theme=authenticator]`：`--color-neutral-900` `#1e293b`→`#e2edf5`、`--color-on-brand` `#ffffff`→`#0a0f1a`、`--color-brand-soft` `#bde6f5`→`#429bc5` |
| KI-001 | profile 的 `:root` 压掉深色变体 | 生成器按「变量名是否与深色变体冲突」拆块，冲突项放入 `:root:not(.dark):not([data-theme=…])`；排除列表由 `$colorScheme` 自动推导 | 浏览器实测 docs 深色 `--color-border-subtle` `#d1e5f2`（近白，即 bug）→ `#1a4a65`；浅色仍 `#d1e5f2` |
| KI-002 | 深色弱化文本 3.61:1 | `dark.color.text-muted` `#64748d` → `#8896a6` | 3.61 → **5.68:1** |
| KI-003 | 语义色 `danger` 被当正文（契约配错令牌） | 新增 `danger-text`；契约从 `color.danger` 改指它，另立一条把 `danger` 作非文本用 | 浅 3.15 → **5.43:1**；深 **5.24:1** |
| KI-004 | 边框色远低于 3:1 | 浅 `#9ec2db`→`#2d7ca3`；深 `#2d6a85`→`#429bc5`；authenticator `#3a3a3a`→`#666666` | 1.81→**4.48**、2.87→**5.49**、1.74→**3.45** |

KI-004 顺带确认了登记里悬而未决的问题：`--color-border: var(--color-border-strong)`，
即 border-strong **就是**默认边框色、组件唯一边界指示，适用 WCAG 1.4.11 的 3:1，不是装饰性。

### 2.2 交付层（KI-006 / KI-007）

**KI-006** 新增 `pnpm sync:consumers`（默认预演，`--write` 才写盘），把权威产物写入 9 个 SPA 站点的
内置副本。9 个站点 27 个文件全部逐字节一致。门禁 `check-consumers` 从 9 个副本扩到 **27 个**——
给 `index.js` / `index.d.ts` 加了 sha256 比对（非 CSS 产物没有 `:root` 可比，逐字节一致才是正确判据）。
另给每个站点补了 `.gitattributes`（`* text=auto eol=lf`）：这些是生成物、按字节比对，
而 `core.autocrlf=true` 会在检出时把 LF 转成 CRLF，让「逐字节一致」在下次检出后失效。

**KI-007** 让字体随 `tokens.css` 一起分发，而不是要求各站点自装 npm 包：

```
packages/tokens/fonts/inter-latin-wght-normal.woff2   48KB 可变字体，wght 100–900
packages/tokens/fonts/LICENSE-Inter-OFL.txt           SIL OFL 1.1，随附许可
```

用可变字体而非 5 个静态字重：一份 48KB vs 约 115KB。生成器把 `@font-face` 写进 `tokens.css`
（相对路径 `url('./fonts/…')`），`sync:consumers` 连字体一起下发，消费方打包器再复制进产物。

证据：9 个站点 woff2 进入产物、请求 **HTTP 200**、`document.fonts.load('16px Inter')` → **`loaded`**、
canvas 宽度探针与 `sans-serif` 相差 **4.52px**（确认不是回退）。

### 2.3 采用层（KI-009 / KI-010）

5 个 Astro 站点逐站接入，每站：`sync:consumers --write` → 改 `global.css` / `tailwind.config` →
构建 → 视觉回归 → 单独提交。原先的 `@apply` 重写全部删除，改由 `primitives.css` 提供；
站点专有的类保留（如 reference 的 Scalar 容器约束、wiki 的 `.wiki-detail-content` 337 行、
brand 的 `.brand-card-accent`）。

## 3. ⚠️ 有意的渲染变更 —— 需要人工复核

**这些是生产站点，改动幅度不小。以下是全部有意变更，逐站实测所得。**

| 站点 | 构建 | 像素差异 | SSIM | 页面高变化 | 备注 |
|---|---|---|---|---|---|
| developer | OK（4 页） | **24.921%** | 0.7154 | 3498 → 3604 | 最大 |
| web | OK（66 页） | **18.963%** | 0.7765 | 4093 → 4153 | **含调色板收敛** |
| docs | OK（10 页） | **16.397%** | 0.7844 | 1243 → 1352 | |
| brand | OK | 7.563% | 0.9707 | — | 只改组件层 |
| wiki | OK（1497 页） | 6.546% | 0.8387 | — | |
| reference | OK（23 页） | 1.479% | 0.9742 | — | |
| 9 个 SPA 站点 | OK | 0.000 – 3.457% | ≥ 0.9468 | — | 迁移内置副本 |

### 3.1 `web` 的配色变更（最需要确认的一条）

`web` 的 `primary-500` 从 `#2c8ec0` 收敛到权威 `#235f84`，sky/amber 两套同样收敛。
依据是 `DESIGN.md` 已记录的决策——"canonical scale beats per-site improvisation"，
网站那套被判定为 "an isolated point, not a ramp"。**但这是配色变更，请亲眼确认。**

### 3.2 `.docs-prose` 间距的收敛

`primitives.css` 的 `.docs-prose` 注释写着 "Ported from the docs-site global sheet"，
但当初的移植并不忠实——标题的行距/字距与外边距都被改过，两边各留一份。现在以设计系统那份为准：

```
h1 字距 -0.05em → -0.02em，margin-bottom 0 → 24px，margin-top 8px → 0
h2 margin-top 40px → 48px，margin-bottom 0 → 16px，字距 -0.03em → -0.01em
h3 margin-top 32px → 36px，margin-bottom 0 → 12px
p  line-height 32px → 28px，margin-top 16px → 20px
ul/ol 字号 14px → 16px
```

**若你认为某站原有的间距更合适，正确做法是改 `primitives.css`（共享层），
而不是在站点里再写一份——否则 KI-010 会复发。**

### 3.3 视觉基线已重建

门禁正确拦下了上述改动（web-home 16.461%、developer-home 13.534%），
记录差异后才重建基线：

```
web-home          34d458f083b5
admin-console     211748f45f69   （0.000%，未变）
developer-home    e8b992918ac3
```

## 4. 修复过程中做的判断（需要你确认）

### 4.1 新增 `font-size.4xl`(36px)

理由不是「消费方都这么用」（那是把漂移合法化），而是阶梯自身的洞：
`3xl`(30) → `display-lg`(40) 是 **×1.333**，全阶梯最大跳跃（其余相邻比均 ≤ ×1.25）。
36 = 30 × 1.2，是阶梯自己的比例作用于 30 的结果，插入后拆成 ×1.2 与 ×1.111，都回到家族内。
它同时是迁移的前置条件：舰队并用 30(`text-3xl` 63 处) / 36(`text-4xl` 68 处) / 48(`text-5xl` 40 处)，
而阶梯原本只有 30 与 48。`lineHeight` 取 40px（= Tailwind 默认，不重算）以保证切换零渲染变化。

### 4.2 改了三条判据 —— 因为判据本身是错的

这一点影响你如何看待「全绿」，单独说明：

- **A4** 原先写成「只要 KI-007 登记存在就记一笔」，于是 14/14 全交付时仍报 `[KNOWN]`，
  把已修好的事说成没修。改为只在真的没交付齐时才报。
- **A4b** 探针在字体尚未加载时就用 canvas 测量，会用回退字体得出相同宽度，
  已交付且能正常加载的字体被误判为「未生效」（admin-console 即如此）。
  改为先 `document.fonts.load` 强制加载再测量。
- **TY4** 原判据是「源码里 `text-<语义名>` 出现几次」，据此报「品牌档占比 0%」。
  **这个判据是错的**：preset 的 `fontSize` 里 `xs…4xl` 本身就是定义在 `core.font-size` 的**品牌令牌**，
  语义名（`body-md` / `heading-lg` / …）只是额外的角色别名，且两者取值大量重合。
  站点写 `text-base` 不等于不受品牌管辖。改为在编译产物里找品牌预设指纹
  （`.text-3xl` 带 `font-weight:700` —— Tailwind 默认不带；`.rounded-lg` = 24px —— Tailwind 默认 8px），
  即规则 **TY4b**；原判据降为 TY4a 信息级，不再判失败。

  实测指纹：13/14 站点的编译产物命中（reference 不使用 `.text-3xl`）。

  **如果不同意这个重新界定，KI-009 的结论需要重开。**

## 5. 回滚

每个站点是独立提交，可逐站回滚；`ui/` 与站点仓库都没有 push 之前，全部改动只在本地。

```powershell
# 回滚某个站点到接入前
cd D:\ws\autional-cn\sites\<站点>
git log --oneline -3        # 找到接入前的提交
git revert <接入提交>        # 或 git reset --hard <接入前的提交>
```

注意：站点改动包含 `packages/tailwind-preset/` 下的生成物，回滚时需一并回滚，
否则 `check-consumers` 会报漂移（这是预期的——门禁会提醒你不一致）。

## 6. 复现

```powershell
cd D:\ws\autional-cn\ui
pnpm verify                  # 7 项门禁
pnpm sync:consumers          # 预演：站点副本会改什么（不写盘）
pnpm sync:consumers --site <站点> --write   # 单站写入
pnpm typography              # 排版落地检查（TY1–TY5）
pnpm assets:fonts            # 字体台账 + 浏览器级加载断言
pnpm visual                  # 站点视觉回归
```

## 7. 未做的事

- **没有 push**。全部改动只在本地各仓库（本文档提交后按你的指示统一推送）。
- **没有合并到任何发布分支**，14 个站点均在各自 `main` 上。
- `docs / developer / web / reference / wiki` 的 `pnpm-lock.yaml` 未改动——
  它们走的是相对路径 `@import '../../packages/tailwind-preset/…'` 与
  `presets: [require('./packages/tailwind-preset/index.js')]`，不引入 npm 依赖。
- 9 个 SPA 站点的内置包 `package.json` 是站点本地的手写文件，**未**纳入 `sync:consumers` 同步范围
  （只同步 `tokens.css` / `index.js` / `index.d.ts` / `primitives.css` / `fonts/`）。

## 8. 可能已过时的文档

`docs/case-studies/` 下原有三份复盘（`website-brand-refresh` / `docs-site-brand-refresh` /
`developer-site-brand-refresh`）描述的是**接入之前**的状态。`website-brand-refresh` 尤其可能
仍把 `#2c8ec0` 那套色阶写成网站的既定做法——本次已按 `DESIGN.md` 的决策收敛到权威色阶。
这些文档**本次未修订**，阅读时请以本次记录与各站点的实际配置为准。
