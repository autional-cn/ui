/** GENERATED FILE — DO NOT EDIT. Source: tokens/tokens.json · Regenerate: pnpm gen · v0.1.0-rc
 *
 * antd v5/v6 ThemeConfig bridge (ESM). Usage:
 *   import antdTheme from '@autional-cn/tailwind-preset/antd-theme.mjs';
 *   <ConfigProvider theme={{ algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
 *                            token: (isDark ? antdTheme.dark : antdTheme.light).token }}>
 *
 * 由 pnpm sync:consumers 下发到各站点的 packages/tailwind-preset/。
 * 控制台不得再手写这些色值——手写会让令牌变更无法传导，各 portal 各自漂移（KI-011）。
 */
const antdTheme = {
  light: { token: {
    colorPrimary: '#003153',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    colorInfo: '#1890ff',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorText: '#041d31',
    colorTextSecondary: '#004565',
    colorTextDescription: '#64748d',
    borderRadius: 8,
    fontFamily: "Inter, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif"
  }, components: {
      Table: {
        headerBg: '#f8fbfe',
        headerColor: '#041d31',
        headerSplitColor: '#a3c7e3',
        rowHoverBg: '#f8fbfe',
        borderColor: '#a3c7e3',
        cellPaddingBlock: 10,
        cellPaddingInline: 12,
        cellPaddingBlockMD: 10,
        cellPaddingInlineMD: 12
      },
      Card: {
        colorBorderSecondary: '#a3c7e3'
      },
      Menu: {
        itemSelectedBg: '#d1e3f1',
        itemSelectedColor: '#003153'
      }
    } },
  dark: { token: {
    colorPrimary: '#003153',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    colorInfo: '#1890ff',
    colorBgContainer: '#0a2940',
    colorBgElevated: '#0f3348',
    colorText: '#f8fbfe',
    colorTextSecondary: '#87ceeb',
    colorTextDescription: '#8896a6',
    borderRadius: 8,
    fontFamily: "Inter, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif"
  }, components: {
      Table: {
        headerBg: '#0a1f30',
        headerColor: '#f8fbfe',
        headerSplitColor: '#1a4a65',
        rowHoverBg: '#0a1f30',
        borderColor: '#1a4a65',
        cellPaddingBlock: 10,
        cellPaddingInline: 12,
        cellPaddingBlockMD: 10,
        cellPaddingInlineMD: 12
      },
      Card: {
        colorBorderSecondary: '#1a4a65'
      },
      Menu: {
        itemSelectedBg: '#0f3348',
        itemSelectedColor: '#a2dcf0'
      }
    } },
};
export default antdTheme;
export const light = antdTheme.light;
export const dark = antdTheme.dark;
