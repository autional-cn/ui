// 数据密集入口 —— 消费方从这里取 antd 能力，不直接 import 'antd'。
//
// 这一句不是形式主义：四站各自 import antd，同一个概念就会长出四种用法（实测控制台侧
// 152 处直接 import，user 侧 0 处、手写 13 个表格）。统一入口之后，一致性才来自 API 而不是巧合。

export { AntdThemeProvider, useAntdApp } from './AntdThemeProvider';
export type { AntdThemeProviderProps, AntdAppApi } from './AntdThemeProvider';
export { DateRangeFilter } from './DateRangeFilter';
export type { DateRangeFilterProps, DateRangeValue } from './DateRangeFilter';

// 整页占位：控制台的加载 / 加载失败。与 DataTable 同一个入口，站点一次 import 拿全。
export { PageLoading, PageError } from './PageStatus';
export type { PageLoadingProps, PageErrorProps } from './PageStatus';
export { DataTable } from './DataTable';
export type { DataTableProps, DataTableColumns, DataTablePagination } from './DataTable';

// 类型再导出：站点侧的命令式 API 门面（`export let message` 那类）需要这些类型，
// 若让它们各自 `import type ... from 'antd/es/message/interface'`，
// 「站点不直接依赖 antd 的内部路径」这条就破了——antd 只是本包的可选 peer。
export type { MessageInstance } from 'antd/es/message/interface';
export type { NotificationInstance } from 'antd/es/notification/interface';
