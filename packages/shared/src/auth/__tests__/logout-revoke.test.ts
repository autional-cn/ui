// @vitest-environment jsdom
// ============================================================
// AUTH-15：登出吊销分链（identity vs OAuth PKCE）——
//  ① OAuth 链（不透明 rt + client_id）→ oauth revoke ×2（at/rt）带 client_id
//  ② identity 链（JWT rt / 无 client_id）→ identity /auth/logout 携 Bearer AT
//  ③ JWT rt + 持久 client_id 仍走 identity（镜像 refreshToken 分链判据）
//  ④ AUTH-08 登出卫生：localStorage 四键 + OAuth 预置物 + trace 缓冲
//  ⑤ 吊销失败 → trace 留痕 failed（HTTP status / network-error）且 logout 仍 resolve
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCtx, mockClearAuth, mockTraceEvent, mockTraceClear, mockDiscard, mockBffLogout, mockPost } =
	vi.hoisted(() => ({
		mockCtx: {
			accessToken: null as string | null,
			refreshToken: null as string | null,
			clientId: '',
		},
		mockClearAuth: vi.fn(),
		mockTraceEvent: vi.fn(),
		mockTraceClear: vi.fn(),
		mockDiscard: vi.fn(),
		mockBffLogout: vi.fn(),
		mockPost: vi.fn(),
	}));

vi.mock('../store', () => ({
	useAuthStore: {
		getState: () => ({
			clearAuth: mockClearAuth,
			user: null,
			isAuthenticated: false,
			currentTenantId: null,
			tenants: [],
			permissions: [],
			setTokens: vi.fn(),
			setTenants: vi.fn(),
			setPermissions: vi.fn(),
			setCurrentTenant: vi.fn(),
		}),
	},
	getAccessToken: () => mockCtx.accessToken,
	getRefreshToken: () => mockCtx.refreshToken,
	getCurrentRole: () => null,
	isTokenExpired: () => false,
	loginWithTokens: vi.fn(),
}));

vi.mock('../roles', () => ({
	buildLoginUrl: vi.fn(() => 'https://auth.example.com/login'),
	isAuthLoginSurface: vi.fn(() => false),
}));

vi.mock('../auth-trace', () => ({
	traceClear: mockTraceClear,
	traceEvent: mockTraceEvent,
	traceRedirect: vi.fn(),
}));

vi.mock('../oauth-client-id-store', () => ({
	resolveClientIdForSession: () => mockCtx.clientId,
}));

vi.mock('../oauth-login', () => ({
	discardPendingOAuthLogin: mockDiscard,
}));

vi.mock('../api/bff-client', () => ({
	bffLogout: mockBffLogout,
}));

vi.mock('../../config', () => ({
	getApiBaseUrl: () => '/bff',
}));

vi.mock('axios', () => ({
	default: { post: mockPost },
}));

import { AuthService } from '../service';

const JWT_RT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1MSJ9.sig';

beforeEach(() => {
	vi.clearAllMocks();
	mockCtx.accessToken = null;
	mockCtx.refreshToken = null;
	mockCtx.clientId = '';
	mockPost.mockResolvedValue({ data: {} });
	localStorage.clear();
});

describe('AuthService.logout 分链吊销（AUTH-15）', () => {
	it('OAuth 链（不透明 rt + client_id）→ oauth revoke ×2 带 client_id，不打 identity logout', async () => {
		mockCtx.accessToken = 'at-opaque';
		mockCtx.refreshToken = 'rt-opaque';
		mockCtx.clientId = 'cid-1';

		await AuthService.logout();

		expect(mockPost).toHaveBeenCalledTimes(2);
		const [url0, body0, cfg0] = mockPost.mock.calls[0];
		expect(url0).toBe('/bff/oauth/api/v1/oauth/revoke');
		const p0 = new URLSearchParams(body0 as string);
		expect(p0.get('token')).toBe('at-opaque');
		expect(p0.get('token_type_hint')).toBe('access_token');
		expect(p0.get('client_id')).toBe('cid-1');
		expect((cfg0 as any).headers['Content-Type']).toBe('application/x-www-form-urlencoded');

		const [url1, body1] = mockPost.mock.calls[1];
		expect(url1).toBe('/bff/oauth/api/v1/oauth/revoke');
		const p1 = new URLSearchParams(body1 as string);
		expect(p1.get('token')).toBe('rt-opaque');
		expect(p1.get('token_type_hint')).toBe('refresh_token');
		expect(p1.get('client_id')).toBe('cid-1');

		expect(mockPost.mock.calls.some(([u]) => String(u).includes('identity'))).toBe(false);
		expect(mockTraceEvent).toHaveBeenCalledWith('logout-revoke', {
			reason: 'oauth-access_token',
			to: 'ok',
		});
		expect(mockTraceEvent).toHaveBeenCalledWith('logout-revoke', {
			reason: 'oauth-refresh_token',
			to: 'ok',
		});
	});

	it('OAuth 链无 AT（仅 rt）→ 只 revoke refresh_token', async () => {
		mockCtx.refreshToken = 'rt-opaque';
		mockCtx.clientId = 'cid-1';

		await AuthService.logout();

		expect(mockPost).toHaveBeenCalledTimes(1);
		const p = new URLSearchParams(mockPost.mock.calls[0][1] as string);
		expect(p.get('token')).toBe('rt-opaque');
		expect(p.get('token_type_hint')).toBe('refresh_token');
	});

	it('identity 链（JWT rt，无 client_id）→ identity /auth/logout 携 Bearer AT，不打 oauth revoke', async () => {
		mockCtx.accessToken = 'at-jwt';
		mockCtx.refreshToken = JWT_RT;

		await AuthService.logout();

		expect(mockPost).toHaveBeenCalledTimes(1);
		const [url, body, cfg] = mockPost.mock.calls[0];
		expect(url).toBe('/bff/identity/api/v1/auth/logout');
		expect(body).toBeNull();
		expect((cfg as any).headers.Authorization).toBe('Bearer at-jwt');
		expect(mockTraceEvent).toHaveBeenCalledWith('logout-revoke', { reason: 'identity', to: 'ok' });
	});

	it('JWT rt + 持久 client_id 仍走 identity（镜像 refreshToken 分链判据）', async () => {
		mockCtx.accessToken = 'at-jwt';
		mockCtx.refreshToken = JWT_RT;
		mockCtx.clientId = 'cid-1';

		await AuthService.logout();

		expect(mockPost).toHaveBeenCalledTimes(1);
		expect(mockPost.mock.calls[0][0]).toBe('/bff/identity/api/v1/auth/logout');
	});

	it('仅剩无凭据 rt（identity JWT rt 且无 AT）→ 明示跳过并留痕', async () => {
		mockCtx.refreshToken = JWT_RT;

		await AuthService.logout();

		expect(mockPost).not.toHaveBeenCalled();
		expect(mockTraceEvent).toHaveBeenCalledWith('logout-revoke-skipped', {
			reason: 'no-credential',
			to: 'ok',
		});
	});

	it('AUTH-08 登出卫生：清 localStorage 四键 + OAuth 预置物 + trace 缓冲 + 内存态', async () => {
		mockCtx.accessToken = 'at-jwt';
		mockCtx.refreshToken = JWT_RT;
		localStorage.setItem('autional-auth-v1', 'x');
		localStorage.setItem('access_token', 'x');
		localStorage.setItem('refresh_token', 'x');
		localStorage.setItem('__oauth_bridge_token', 'x');

		await AuthService.logout();

		expect(localStorage.getItem('autional-auth-v1')).toBeNull();
		expect(localStorage.getItem('access_token')).toBeNull();
		expect(localStorage.getItem('refresh_token')).toBeNull();
		expect(localStorage.getItem('__oauth_bridge_token')).toBeNull();
		expect(mockClearAuth).toHaveBeenCalledTimes(1);
		expect(mockDiscard).toHaveBeenCalledTimes(1);
		expect(mockTraceClear).toHaveBeenCalledTimes(1);
	});

	it('吊销失败（4xx）：trace 留痕 failed（带 HTTP status）且 logout 仍 resolve', async () => {
		mockCtx.accessToken = 'at-jwt';
		mockCtx.refreshToken = JWT_RT;
		mockPost.mockRejectedValueOnce({ response: { status: 401 } });

		await expect(AuthService.logout()).resolves.toBeUndefined();
		expect(mockTraceEvent).toHaveBeenCalledWith('logout-revoke-failed', {
			reason: 'identity',
			to: '401',
		});
	});

	it('吊销失败（网络异常，无 response）：to=network-error 且 logout 仍 resolve', async () => {
		mockCtx.accessToken = 'at-jwt';
		mockCtx.refreshToken = JWT_RT;
		mockPost.mockRejectedValueOnce(new Error('ECONNREFUSED'));

		await expect(AuthService.logout()).resolves.toBeUndefined();
		expect(mockTraceEvent).toHaveBeenCalledWith('logout-revoke-failed', {
			reason: 'identity',
			to: 'network-error',
		});
	});
});
