import { describe, it, expect } from 'vitest';
import {
	classifyQueryState,
	getHttpStatus,
	isEmptyData,
	isForbiddenError,
	isRetryableError,
} from '../query-state';

// RC-B4-01（AC-B4-W0-01-2）：优先级矩阵硬序 forbidden > error > loading > empty > ready。
// 关键不变式：error 存在时绝不回落 empty/ready；loading 且有旧数据 → ready。
describe('classifyQueryState 优先级矩阵（AC-B4-W0-01-2）', () => {
	const forbidden = () => ({ response: { status: 403 } });
	const serverError = () => ({ response: { status: 500 } });
	const networkError = () => new Error('Network Error');

	it('forbidden 最高优先：403 时即使有 data/loading 仍判 forbidden', () => {
		expect(classifyQueryState({ error: forbidden(), data: [1], isLoading: false })).toBe('forbidden');
		expect(classifyQueryState({ error: forbidden(), isLoading: true })).toBe('forbidden');
	});

	it('error 存在时绝不回落 empty/ready（假 0 / 伪空态根因锁）', () => {
		// error + 旧数据 → error（不因 data 有值回落 ready）
		expect(classifyQueryState({ error: serverError(), data: [1] })).toBe('error');
		// error + 空数组 → error（不回落 empty 伪装「暂无数据」）
		expect(classifyQueryState({ error: networkError(), data: [] })).toBe('error');
		// error + data undefined → error
		expect(classifyQueryState({ error: networkError(), isLoading: false })).toBe('error');
	});

	it('error 优先于 loading', () => {
		expect(classifyQueryState({ error: serverError(), isLoading: true })).toBe('error');
	});

	it('loading 且无旧数据 → loading', () => {
		expect(classifyQueryState({ isLoading: true })).toBe('loading');
		expect(classifyQueryState({ isLoading: true, data: [] })).toBe('loading');
	});

	it('loading 且有旧数据 → ready（stale 显示优先，不闪加载态）', () => {
		expect(classifyQueryState({ isLoading: true, data: [1, 2] })).toBe('ready');
	});

	it('非 loading：空数据 → empty（null/undefined/[]）', () => {
		expect(classifyQueryState({ data: [] })).toBe('empty');
		expect(classifyQueryState({ data: null })).toBe('empty');
		expect(classifyQueryState({})).toBe('empty');
		expect(classifyQueryState({ isLoading: false })).toBe('empty');
	});

	it('有数据 → ready', () => {
		expect(classifyQueryState({ data: [1] })).toBe('ready');
		expect(classifyQueryState({ data: { total: 0 } })).toBe('ready');
	});

	it('无 error（null/undefined）不触发 error 分支', () => {
		expect(classifyQueryState({ error: null, data: [1] })).toBe('ready');
		expect(classifyQueryState({ error: undefined, data: [] })).toBe('empty');
	});
});

// AC-B4-W0-01-3：isRetryable 矩阵（无 status/5xx/408/429 → true；4xx 业务错误 → false）。
describe('isRetryableError 矩阵（AC-B4-W0-01-3）', () => {
	it('无 status（网络/超时/未知）→ true', () => {
		expect(isRetryableError(new Error('Network Error'))).toBe(true);
		expect(isRetryableError({})).toBe(true);
		expect(isRetryableError(undefined)).toBe(true);
	});

	it('5xx / 408 / 429 → true', () => {
		expect(isRetryableError({ response: { status: 500 } })).toBe(true);
		expect(isRetryableError({ response: { status: 502 } })).toBe(true);
		expect(isRetryableError({ response: { status: 503 } })).toBe(true);
		expect(isRetryableError({ response: { status: 408 } })).toBe(true);
		expect(isRetryableError({ response: { status: 429 } })).toBe(true);
	});

	it('4xx 业务错误 → false（重试必败，不得给必败重试按钮）', () => {
		for (const status of [400, 401, 403, 404, 409, 422]) {
			expect(isRetryableError({ response: { status } })).toBe(false);
		}
	});
});

// getHttpStatus 形状兼容（axios 主形状 + fetch/自造形状）。
describe('getHttpStatus 形状兼容', () => {
	it('axios：response.status 优先', () => {
		expect(getHttpStatus({ response: { status: 403 }, status: 500 })).toBe(403);
	});

	it('直挂 status / statusCode（fetch 及自造错误形状）', () => {
		expect(getHttpStatus({ status: 404 })).toBe(404);
		expect(getHttpStatus({ statusCode: 500 })).toBe(500);
	});

	it('非对象 / 无数字状态 → undefined', () => {
		expect(getHttpStatus(undefined)).toBeUndefined();
		expect(getHttpStatus(null)).toBeUndefined();
		expect(getHttpStatus('boom')).toBeUndefined();
		expect(getHttpStatus({ response: { status: '403' } })).toBeUndefined();
	});
});

describe('isForbiddenError / isEmptyData 边界', () => {
	it('isForbiddenError 只认 403（401 不在本分流）', () => {
		expect(isForbiddenError({ response: { status: 403 } })).toBe(true);
		expect(isForbiddenError({ response: { status: 401 } })).toBe(false);
		expect(isForbiddenError({ response: { status: 500 } })).toBe(false);
		expect(isForbiddenError(undefined)).toBe(false);
	});

	it('isEmptyData：null/undefined/[] → true；有元素/对象 → false', () => {
		expect(isEmptyData(null)).toBe(true);
		expect(isEmptyData(undefined)).toBe(true);
		expect(isEmptyData([])).toBe(true);
		expect(isEmptyData([1])).toBe(false);
		expect(isEmptyData({})).toBe(false);
		expect(isEmptyData(0)).toBe(false);
	});
});
