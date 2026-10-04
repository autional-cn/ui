// @vitest-environment jsdom
// U350 回归锁：logout(redirectTo) 接通导航语义 —— 先清会话（await AuthService.logout()），
// 再整页前往（traceRedirect assign）；无参调用保持「仅清会话、导航交调用方」。
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logoutSpy, traceRedirectSpy } = vi.hoisted(() => ({
	logoutSpy: vi.fn(async () => {}),
	traceRedirectSpy: vi.fn(),
}));

vi.mock('../service', () => ({
	AuthService: { logout: logoutSpy },
}));
vi.mock('../auth-trace', () => ({
	traceRedirect: traceRedirectSpy,
}));

import { logout } from '../store';

describe('U350: shared logout(redirectTo) 导航语义', () => {
	beforeEach(() => {
		logoutSpy.mockClear();
		traceRedirectSpy.mockClear();
	});

	it('带 redirectTo：先清会话，再整页前往（reason=logout, assign）', async () => {
		await logout('/auth/acme-corp/login?account_deleted=true');
		expect(logoutSpy).toHaveBeenCalledTimes(1);
		expect(traceRedirectSpy).toHaveBeenCalledWith(
			'/auth/acme-corp/login?account_deleted=true',
			{ reason: 'logout', assign: true },
		);
		// 顺序锁：导航必须发生在会话清理之后（先终结会话再离开）
		expect(logoutSpy.mock.invocationCallOrder[0]).toBeLessThan(
			traceRedirectSpy.mock.invocationCallOrder[0],
		);
	});

	it('无参：仅清会话、不导航（程序性调用方不受影响）', async () => {
		await logout();
		expect(logoutSpy).toHaveBeenCalledTimes(1);
		expect(traceRedirectSpy).not.toHaveBeenCalled();
	});
});
