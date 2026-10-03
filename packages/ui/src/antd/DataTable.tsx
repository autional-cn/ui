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

/**
 * 列定义类型。单独导出是为了让站点**不必**为了写 columns 去 import antd 的类型 ——
 * 站点侧一旦 import 了 antd，C5 台账（入口棘轮）就会记上一笔，
 * 而「一个概念只应有一个入口」正是这一层要守住的东西。
 */
export type DataTableColumns<T extends object = Record<string, unknown>> = NonNullable<TableProps<T>['columns']>;

/**
 * 分页配置类型。站点此前用 antd 的 `TablePaginationConfig`；这个别名是它的替代品 ——
 * 目标（D10 的 Table 批次）是让控制台**不再从 antd 取任何与表格相关的类型或组件**，
 * 少一个类型别名，那批就少一处 import antd 的理由。
 */
export type DataTablePagination<T extends object = Record<string, unknown>> = Exclude<NonNullable<TableProps<T>['pagination']>, false>;

function DataTableInner<T extends object = Record<string, unknown>>({
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

/**
 * 复合成员必须一并透传 —— 这是「薄透传」契约的一部分，不是可选的糖。
 *
 * 为什么：antd 的 Table 是**复合组件**（Table.Summary / Column / ColumnGroup / 选择与展开的哨兵）。
 * 只导出一个函数组件，等于把这些能力从 DS 入口里**删掉** —— 消费方要用汇总行时只剩两条路：
 *   ① 直接 import antd（C5 台账多一笔，两个入口）；
 *   ② 自己拼裸 <tr>/<td> 绕过 DS 的表格样式（那就等于没用 DS）。
 * 两条路都破坏「一个概念一个入口」。
 * 实测就是这么撞上的：user 的发票明细表需要一行合计（原来的手写表用 <tfoot>）。
 */
type DataTableStatics = Pick<
	typeof Table,
	| 'Summary'
	| 'Column'
	| 'ColumnGroup'
	| 'SELECTION_COLUMN'
	| 'SELECTION_ALL'
	| 'SELECTION_INVERT'
	| 'SELECTION_NONE'
	| 'EXPAND_COLUMN'
>;

export const DataTable = Object.assign(DataTableInner, {
	Summary: Table.Summary,
	Column: Table.Column,
	ColumnGroup: Table.ColumnGroup,
	SELECTION_COLUMN: Table.SELECTION_COLUMN,
	SELECTION_ALL: Table.SELECTION_ALL,
	SELECTION_INVERT: Table.SELECTION_INVERT,
	SELECTION_NONE: Table.SELECTION_NONE,
	EXPAND_COLUMN: Table.EXPAND_COLUMN,
}) as typeof DataTableInner & DataTableStatics;
