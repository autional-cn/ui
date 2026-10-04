import { describe, it, expect } from 'vitest';
import { extractApiError, extractApiErrorMessage } from '../error';

// UP-17-B 回归锁（AC-401）：extractApiError message 键链。
// 后端 Problem 契约（service-core/base/dto/problem.go）为 title 必填 / detail / code / i18n_key，无 message；
// 只认 message 会把 Problem 类错误整类退化为 defaultMsg。
describe('extractApiError message 键链（UP-17-B / AC-401）', () => {
	it('title 优先：Problem 契约（title/detail/code）→ 取 title', () => {
		const err = {
			response: { data: { code: 403, title: '平台级访问受限', detail: '需要平台角色' } },
		};
		const out = extractApiError(err, 'fallback');
		expect(out.message).toBe('平台级访问受限');
		expect(out.code).toBe(403);
	});

	it('detail 兜底：无 message/title 时取 detail', () => {
		const err = { response: { data: { detail: '令牌已过期' } } };
		expect(extractApiError(err, 'fallback').message).toBe('令牌已过期');
	});

	it('皆无回落 err.message，再皆无回落 defaultMsg', () => {
		expect(extractApiError(new Error('network boom'), 'fallback').message).toBe('network boom');
		expect(extractApiError({}, 'fallback').message).toBe('fallback');
		expect(extractApiError(undefined, 'fallback')).toEqual({ code: 'UNKNOWN', message: 'fallback' });
	});

	it('业务信封（code+message）不回归：message 仍优先于 title', () => {
		const err = {
			response: { data: { code: 61040010, message: 'TOTP already enabled', title: 'Conflict' } },
		};
		expect(extractApiError(err, 'fallback')).toEqual({
			code: 61040010,
			message: 'TOTP already enabled',
		});
		expect(extractApiErrorMessage(err, 'fallback')).toBe('TOTP already enabled');
	});
});
