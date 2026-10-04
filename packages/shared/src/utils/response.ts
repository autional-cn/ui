/**
 * Standardized API response unwrapping utilities.
 * Replaces ad-hoc `res?.data?.items ?? res?.data ?? []` patterns across all apps.
 *
 * 【契约声明 · 唯一形状适配点】本文件是前端读取响应的**唯一形状适配点**：
 *   - 信封解包（{code,message,data} 的 data/items 分支）与 items/扁平双分支兼容在此收口；
 *   - snake→camel 深转换由 `api/client.ts` 响应拦截器（:100）承担，本文件不做键名转换。
 * 新页面禁止再写 `res?.data?.items ?? res?.data ?? []` 式手搓解包——列表用
 * `extractList` / `extractListResult`，单条用 `extractItem`，分页参数与归一用
 * `utils/page.ts` 的 `toPageParams` / `fromPageResult`（见 index.ts 导出）。
 */

export interface PaginationInfo {
	page: number;
	pageSize: number;
	total: number;
}

export interface ListResult<T> {
	items: T[];
	pagination: PaginationInfo;
}

/** 列表形状适配唯一入口（信封解包 + items/扁平双分支兼容；键名已为 camel）。 */
export function extractList<T = Record<string, any>>(res: unknown): T[] {
	if (!res) return [];
	if (Array.isArray(res)) return res as T[];
	const r = res as Record<string, unknown>;
	const dataObj = r.data as Record<string, unknown> | undefined;
	const items = r.items ?? dataObj?.items ?? r.data ?? [];
	return Array.isArray(items) ? (items as T[]) : [];
}

/** 单条形状适配唯一入口（信封解包；键名已为 camel）。新页面一律经此读取。 */
export function extractItem<T = Record<string, any>>(res: unknown): T | null {
	if (!res) return null;
	const r = res as Record<string, unknown>;
	return (r.data ?? r ?? null) as T | null;
}

export function extractPagination(res: unknown): PaginationInfo {
	const r = res as Record<string, unknown>;
	const pagination = r.pagination as Record<string, unknown> | undefined;
	return {
		page: (pagination?.page ?? r.page ?? 1) as number,
		pageSize: (pagination?.pageSize ?? r.pageSize ?? 10) as number,
		total: (r.total ?? 0) as number,
	};
}

export function extractListResult<T>(res: unknown): ListResult<T> {
	return {
		items: extractList<T>(res),
		pagination: extractPagination(res),
	};
}

export async function fetchList<T = any>(apiCall: Promise<unknown>): Promise<T[]> {
	const res = await apiCall;
	return extractList<T>(res);
}

export async function fetchItem<T = any>(apiCall: Promise<unknown>): Promise<T | null> {
	const res = await apiCall;
	return extractItem<T>(res);
}

export async function fetchListResult<T = any>(apiCall: Promise<unknown>): Promise<ListResult<T>> {
	const res = await apiCall;
	return extractListResult<T>(res);
}
