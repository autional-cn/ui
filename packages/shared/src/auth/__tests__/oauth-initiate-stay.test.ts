// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// AUTH-03/08：initiateOAuthLogin 的「停留」语义与防重入窗口
//  - onStay 转发给调用方（RequireAuth 据此渲染恢复态）并清零本次预置物
//  - 「停留」取消待重试定时器：窗口过期后不再自动把用户弹走
//  - force=true 跳过 10s 防重入窗口（恢复态「前往登录」按钮用）
// ============================================================

const { mockTrace, mockPersistCid, mockGeneratePKCE } = vi.hoisted(() => ({
	mockTrace: vi.fn(),
	mockPersistCid: vi.fn(),
	mockGeneratePKCE: vi.fn(() => Promise.resolve({ verifier: 'v-1', challenge: 'c-1' })),
}));

vi.mock('../../api/client', () => ({ apiClient: { post: vi.fn(), get: vi.fn() } }));
vi.mock('../store', () => ({ loginWithTokens: vi.fn() }));
vi.mock('../service', () => ({ AuthService: { updateCurrentTenant: vi.fn() } }));
vi.mock('../oauth-client-id-store', () => ({ persistOAuthClientId: mockPersistCid }));
vi.mock('../auth-trace', () => ({ traceRedirect: mockTrace }));
vi.mock('../pkce', () => ({ generatePKCE: () => mockGeneratePKCE() }));
vi.mock('../../config', () => ({ getPortalUrl: () => 'https://auth.example.com' }));

import { initiateOAuthLogin, discardPendingOAuthLogin } from '../oauth-login';

beforeEach(() => {
	vi.clearAllMocks();
	sessionStorage.clear();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('initiateOAuthLogin「停留」与防重入（AUTH-03/08）', () => {
	it('「停留」→ onStay 转发 + 本次预置物全清（state/verifier/cid/init_ts）', async () => {
		const onStay = vi.fn();
		await initiateOAuthLogin('cid-1', 'https://user.example.com/x', { onStay });

		expect(mockTrace).toHaveBeenCalledTimes(1);
		const opts = mockTrace.mock.calls[0][1];
		expect(opts.kind).toBe('interstitial');
		expect(typeof opts.onStay).toBe('function');
		// 发起时预置物就位
		expect(sessionStorage.getItem('oauth_state')).toBeTruthy();
		expect(sessionStorage.getItem('oauth_pkce_verifier')).toBe('v-1');
		expect(sessionStorage.getItem('oauth_client_id')).toBe('cid-1');
		expect(sessionStorage.getItem('oauth_init_ts')).toBeTruthy();

		opts.onStay();

		expect(onStay).toHaveBeenCalledTimes(1);
		expect(sessionStorage.getItem('oauth_state')).toBeNull();
		expect(sessionStorage.getItem('oauth_pkce_verifier')).toBeNull();
		expect(sessionStorage.getItem('oauth_client_id')).toBeNull();
		expect(sessionStorage.getItem('oauth_init_ts')).toBeNull();
	});

	it('10s 防重入窗口内默认被抑制（无跳转）；force=true 直通', async () => {
		sessionStorage.setItem('oauth_init_ts', String(Date.now()));

		await initiateOAuthLogin('cid-1');
		expect(mockTrace).not.toHaveBeenCalled();

		await initiateOAuthLogin('cid-1', undefined, { force: true });
		expect(mockTrace).toHaveBeenCalledTimes(1);
	});

	it('「停留」取消待重试定时器：窗口过期后不再自动发起', async () => {
		vi.useFakeTimers();
		sessionStorage.setItem('oauth_init_ts', String(Date.now()));

		// 窗口内首次调用被抑制，安排窗口过期后的自动重试
		await initiateOAuthLogin('cid-1');
		expect(mockTrace).not.toHaveBeenCalled();

		// 窗口过期 → 自动重试真正发起，拿到本轮的 onStay
		await vi.advanceTimersByTimeAsync(10200);
		expect(mockTrace).toHaveBeenCalledTimes(1);
		const opts = mockTrace.mock.calls[0][1];
		opts.onStay();

		// 预置物清零 + 定时器已取消：再次调用立即发起（不被窗口吞、无遗留重试）
		mockTrace.mockClear();
		await initiateOAuthLogin('cid-1');
		expect(mockTrace).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(15000);
		expect(mockTrace).toHaveBeenCalledTimes(1);
	});
});

describe('discardPendingOAuthLogin（AUTH-08 会话卫生，登出/停留共用）', () => {
	it('清 sessionStorage 四键 + 取消待重试定时器', async () => {
		vi.useFakeTimers();
		sessionStorage.setItem('oauth_init_ts', String(Date.now()));

		// 窗口内首次调用被抑制 → 安排窗口过期后的自动重试
		await initiateOAuthLogin('cid-1');
		expect(mockTrace).not.toHaveBeenCalled();

		// 模拟发起中途残留的预置物
		sessionStorage.setItem('oauth_state', 's-1');
		sessionStorage.setItem('oauth_pkce_verifier', 'v-1');
		sessionStorage.setItem('oauth_client_id', 'cid-1');

		discardPendingOAuthLogin();

		expect(sessionStorage.getItem('oauth_state')).toBeNull();
		expect(sessionStorage.getItem('oauth_pkce_verifier')).toBeNull();
		expect(sessionStorage.getItem('oauth_client_id')).toBeNull();
		expect(sessionStorage.getItem('oauth_init_ts')).toBeNull();

		// 重试定时器已取消：窗口过期后不再自动发起
		await vi.advanceTimersByTimeAsync(15000);
		expect(mockTrace).not.toHaveBeenCalled();
	});
});
