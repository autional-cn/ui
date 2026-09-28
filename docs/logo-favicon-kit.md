# Logo / Favicon 资源套件（基于现有 SVG 图形标生成）

这套资源从现有 `logo-mark.svg` 派生，用于覆盖品牌规范中提到的：

- 标准彩色
- 深色背景适配
- 单色黑
- 单色白

同时提供 favicon 常用 PNG 输出（含 512 尺寸）。

## 1. Logo（图形标）

目录：`assets/logo/`

- 标准彩色（透明底）：`logo-mark.color.svg`
- 深色背景适配（将深蓝部分提亮为白色，透明底）：`logo-mark.dark.svg`
- 单色黑（透明底）：`logo-mark.mono-black.svg`
- 单色白（透明底）：`logo-mark.mono-white.svg`

## 2. Favicon（方形图标）

目录：`assets/favicon/`

SVG 源文件（512 画板，圆角方形背景）：

- 深色底：`favicon-dark.svg`
- 浅色底：`favicon-light.svg`
- 单色黑：`favicon-mono-black.svg`
- 单色白：`favicon-mono-white.svg`

PNG 输出（目录：`assets/favicon/png/`）：

- `favicon-16x16.png`
- `favicon-32x32.png`
- `favicon-48x48.png`
- `apple-touch-icon.png`（180）
- `android-chrome-192x192.png`
- `android-chrome-512x512.png`
- 512 预览/交付：
  - `favicon-dark-512.png`
  - `favicon-light-512.png`
  - `favicon-mono-black-512.png`
  - `favicon-mono-white-512.png`

## 3. 生成方式（可复现）

PNG 是用 `resvg-cli` 从 SVG 渲染得到的：

```bash
npx --yes resvg-cli --fit-width 512 --fit-height 512 ./assets/favicon/favicon-dark.svg ./assets/favicon/png/android-chrome-512x512.png
```

同理可按需要替换输入 SVG 和输出尺寸。
