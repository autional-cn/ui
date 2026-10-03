// 数据密集入口 —— 消费方从这里取 antd 能力，不直接 import 'antd'。
//
// 这一句不是形式主义：四站各自 import antd，同一个概念就会长出四种用法（实测控制台侧
// 152 处直接 import，user 侧 0 处、手写 13 个表格）。统一入口之后，一致性才来自 API 而不是巧合。

export { AntdThemeProvider, useAntdApp } from './AntdThemeProvider';
export type { AntdThemeProviderProps } from './AntdThemeProvider';
export { DataTable } from './DataTable';
export type { DataTableProps } from './DataTable';
