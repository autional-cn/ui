/**
 * 分页/形状单点 helper（H008 收敛口径 · ADR-AB1-04）。
 *
 * 契约（与 `api/client.ts` 拦截器配对）：
 * - 请求侧：页面传 camel 入参，`toPageParams` 输出 **snake**（`page` / `page_size`）；
 *   拦截器再做一次深转换兜底，本函数保证键名口径单点。
 * - 响应侧：拦截器已把 snake→camel 且解包信封；`fromPageResult` 是列表+分页的
 *   唯一归一入口（内部复用 `extractList` / `extractPagination`），页面不得再写
 *   `res?.data?.items ?? ...` 式手搓兼容。
 */
import { extractList, extractPagination } from './response';

export interface PageParams {
	page?: number;
	page_size?: number;
}

export interface PageResult<T = Record<string, any>> {
	items: T[];
	total: number;
	page: number;
	page_size: number;
}

/** camel 分页入参 → 后端 snake 参数（pageSize 缺省不输出键；输出键集恰为 page/page_size）。 */
export function toPageParams(input: { page?: number; pageSize?: number } = {}): PageParams {
	const out: PageParams = {};
	if (typeof input.page === 'number') out.page = input.page;
	if (typeof input.pageSize === 'number') out.page_size = input.pageSize;
	return out;
}

/**
 * 响应归一：兼容三种输入——
 * ① 扁平 `{ items, total, ... }`；② 信封 `{ data: { items, total } }`（拦截器未替换引用时的直读）；③ 裸数组。
 * 裸数组的 total 取数组长度（唯一可知值）。
 */
export function fromPageResult<T = Record<string, any>>(resp: unknown): PageResult<T> {
	const items = extractList<T>(resp);
	const pagination = extractPagination(resp ?? {});
	const r = (resp ?? {}) as Record<string, any>;
	const dataObj = r.data as Record<string, any> | undefined;
	const pickNum = (...vals: unknown[]): number | undefined => {
		for (const v of vals) if (typeof v === 'number') return v;
		return undefined;
	};

	return {
		items,
		total:
			pickNum(r.total, dataObj?.total) ?? (Array.isArray(resp) ? items.length : pagination.total),
		page: pickNum(r.page, dataObj?.page) ?? pagination.page,
		page_size:
			pickNum(r.page_size, r.pageSize, dataObj?.page_size, dataObj?.pageSize) ??
			pagination.pageSize,
	};
}
