/**
 * 查询状态分类单点（RC-B4-01 / ADR-B4-01）。
 *
 * 背景：各门户页面此前各自兜底 error/403/空/就绪四况，「error 时 ?? 0」「error 被空态
 * 掩盖」「403 必败重试」三族失真由此而来。本模块是**错误/空/无权判定的唯一语义源**：
 * 页面消费 `classifyQueryState`（或按需组合 isForbiddenError / isRetryableError /
 * isEmptyData），渲染层沿用各门户既有视觉（admin 用 PageError/Empty，不新增模式）。
 *
 * 判定优先级（硬序）: forbidden > error > loading > empty > ready。
 * 关键不变式:
 *   - error 存在时绝不回落 empty/ready（修「假 0」「伪空态」的唯一入口）；
 *   - loading 但已有旧数据（stale-while-revalidate）→ ready（显示旧数据优于闪加载态）。
 *
 * 纯逻辑、无框架依赖（shared 包 antd-free），跨门户可复用。
 */

export type QueryState = 'loading' | 'forbidden' | 'error' | 'empty' | 'ready';

export interface QueryStateInput {
	isLoading?: boolean;
	error?: unknown;
	data?: unknown;
}

/**
 * 提取 HTTP 状态码。兼容形状：
 * - axios AxiosError：`err.response.status`（主形状），新版 axios 亦带 `err.status`；
 * - fetch/自造错误：`err.status` / `err.statusCode`。
 * 无状态码（网络中断/超时/未知错误）→ undefined（调用方按「重试可能改变结果」处理）。
 */
export function getHttpStatus(error: unknown): number | undefined {
	if (error === null || error === undefined || typeof error !== 'object') return undefined;
	const e = error as {
		status?: unknown;
		statusCode?: unknown;
		response?: { status?: unknown };
	};
	const candidates = [e.response?.status, e.status, e.statusCode];
	for (const c of candidates) {
		if (typeof c === 'number') return c;
	}
	return undefined;
}

/** 403 = 权限不足（无权限态；不重试——重试必败）。只认 403：401 属登录态失效链，不在此分流。 */
export function isForbiddenError(error: unknown): boolean {
	return getHttpStatus(error) === 403;
}

/**
 * 重试可能改变结果的错误 → true：
 *   - 无 status（网络/超时/未知）→ true；
 *   - 5xx、408（请求超时）、429（限流）→ true。
 * 4xx 业务错误（400/401/403/404/409/422…）→ false（重试必败，不得给用户必败重试按钮）。
 */
export function isRetryableError(error: unknown): boolean {
	const status = getHttpStatus(error);
	if (status === undefined) return true;
	return status >= 500 || status === 408 || status === 429;
}

/** 空数据判定：null/undefined/空数组 → true；对象（含 {items:[]} 等容器）不在此判空。 */
export function isEmptyData(data: unknown): boolean {
	if (data === null || data === undefined) return true;
	if (Array.isArray(data)) return data.length === 0;
	return false;
}

/**
 * 分类查询状态（硬序：forbidden > error > loading > empty > ready）。
 *
 * - forbidden：error 为 403（error 在、data 在均不改判——权限不足是最高优先级事实）；
 * - error：任意其它 error（**绝不回落 empty/ready**，即使有旧数据）；
 * - loading：isLoading 且无旧数据（有旧数据 → ready，stale 显示优先）；
 * - empty：非 loading 且数据为空（null/undefined/[]）；
 * - ready：其余（数据就绪）。
 */
export function classifyQueryState(input: QueryStateInput): QueryState {
	const { isLoading, error, data } = input ?? {};
	if (isForbiddenError(error)) return 'forbidden';
	if (error !== null && error !== undefined) return 'error';
	if (isLoading && isEmptyData(data)) return 'loading';
	if (isEmptyData(data)) return 'empty';
	return 'ready';
}
