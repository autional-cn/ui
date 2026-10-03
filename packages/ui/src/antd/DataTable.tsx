'use client';

// DataTable —— 四个门户共用的表格。
//
// 它是什么：**薄透传**。
//   统一（本组件 + 上游主题负责）：密度 · 表头 · 悬浮态 · 边框 · 行高 · 分页外观 · 与 DS 令牌一致的配色
//   透传（本组件不碰）：columns · rowKey · scroll · onRow · rowSelection · expandable
//                     · sticky · tableLayout · 以及 antd Table 的其余全部 props（...rest）
//
// 为什么必须是薄透传：三个控制台现存 156 处 antd Table，用到的 props 面远超「视觉六项」。
//   若这里改成一套自研的窄 API，等于**用自制 API 取代 antd 的成熟 API** —— 与「antd 比我们手写的成熟」
//   这个定调相反，而且 156 处都要改造。薄透传下，一致性收益收窄为「视觉六项」，但它是真的、代价可控。
//
// 视觉那六项**不在这里写死**：它们在 @autional-cn/tokens 的 antd 桥里（components.Table），
// 由 AntdThemeProvider 下发给 ConfigProvider。所以即便某个门户暂时没换用 DataTable，
// 只要挂了 Provider，它的表格外观也已经统一 —— 覆盖面比「只统一换用处」大一个数量级。

import { Table } from 'antd';
import type { TableProps } from 'antd';

export type DataTableProps<T extends object = Record<string, unknown>> = TableProps<T>;

export function DataTable<T extends object = Record<string, unknown>>({
	size = 'middle',
	pagination,
	...rest
}: TableProps<T>) {
	// 分页外观是 DS 的事（每页条数可切换）；调用方传 pagination 时仍以它为准。
	const mergedPagination =
		pagination === false || pagination === undefined
			? pagination
			: { showSizeChanger: true, ...pagination };

	return <Table<T> size={size} pagination={mergedPagination} {...rest} />;
}
