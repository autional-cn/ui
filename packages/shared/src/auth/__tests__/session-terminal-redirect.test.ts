// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// F-W8b 修复②：会话终结（onUnauthorized）与刷新失败处置的整链回归锁
//  - 已在 auth 登录承接面（`/<slug>/login`、`/error`、裸根入口）→ 只清会话，
//    不整页弹走（否则 buildLoginUrl 防嵌套截断会丢掉 URL 中的 redirect 回程目标，
//    且构成一次整页闪烁 —— 存量过期 token 在登录页「静默弹走」）
//  - 非承接面 → 照常清理 + 整页弹登录页（带 slug 与回程 redirect）
//  - refreshToken onFailure：'clear' 只清理不导航；'none' 零副作用；缺省 'redirect'
// ============================================================

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));

vi.mock('axios', () => ({ default: { post: mockPost } }));
vi.mock('../../api/bff-client', () => ({ bffLogout: vi.fn(() => Promise.resolve()) }));

const replaceSpy = vi.fn();
const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');

// 只替换 window.location（不动 window 本体 —— stubGlobal 会连 localStorage 一起遮蔽，
// zustand persist 在 setState 时崩）。字段给纯值，绕开 jsdom Location 的 brand check。
function mockWindowLocation(pathname: string): void {
	Object.defineProperty(window, 'location', {
		configurable: true,
		value: {
			pathname,
			href: `https://auth.autional.local${pathname}`,
			origin: 'https://auth.autional.local',
			hostname: 'auth.autional.local',
			protocol: 'https:',
			replace: replaceSpy,
		},
	});
	(window as any).__APP_CONFIG__ = { VITE_PORTAL_CONFIG: { auth: { host: 'auth', base: '' } } };
}

/** 剥除 authTrace 面包屑（rt=）后比较；rt 装饰本身由 toMatch 锁定。 */
function withoutRt(url: string): string {
	const u = new URL(url);
	u.searchParams.delete('rt');
	return u.toString();
}

/** 每例取全新模块实例：清零 service.ts 的模块级重入锁（redirectingToLogin）。 */
async function freshService() {
	vi.resetModules();
	const svc = await import('../service');
	const store = await import('../store');
	return { AuthService: svc.AuthService, useAuthStore: store.useAuthStore };
}

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
});

afterEach(() => {
	if (originalLocationDescriptor) {
		Object.defineProperty(window, 'location', originalLocationDescriptor);
	}
	delete (window as any).__APP_CONFIG__;
	vi.useRealTimers();
});

describe('onUnauthorized 承接面抑制（F-W8b 修复②）', () => {
	it('已在 /<slug>/login：清理会话但不整页弹走（回程 redirect 不丢）', async () => {
		mockWindowLocation('/demo/login');
		const { AuthService, useAuthStore } = await freshService();
		useAuthStore.setState({ accessToken: 'at-old', refreshToken: 'rt-old', isAuthenticated: true });

		AuthService.onUnauthorized();

		expect(useAuthStore.getState().accessToken).toBeNull();
		expect(useAuthStore.getState().isAuthenticated).toBe(false);
		expect(replaceSpy).not.toHaveBeenCalled();
	});

	it('已在 /error：同样只清理不弹走（错误页有自身倒计时出口）', async () => {
		mockWindowLocation('/error');
		const { AuthService, useAuthStore } = await freshService();
		useAuthStore.setState({ accessToken: 'at-old', refreshToken: 'rt-old', isAuthenticated: true });

		AuthService.onUnauthorized();

		expect(useAuthStore.getState().accessToken).toBeNull();
		expect(replaceSpy).not.toHaveBeenCalled();
	});

	it('非承接面 /demo/dashboard：清理 + 整页弹登录页（带 slug 与回程 redirect）', async () => {
		mockWindowLocation('/demo/dashboard');
		const { AuthService, useAuthStore } = await freshService();
		useAuthStore.setState({ accessToken: 'at-old', refreshToken: 'rt-old', isAuthenticated: true });

		vi.useFakeTimers();
		AuthService.onUnauthorized();
		vi.runAllTimers();

		expect(useAuthStore.getState().accessToken).toBeNull();
		expect(replaceSpy).toHaveBeenCalledTimes(1);
		const url = String(replaceSpy.mock.calls[0][0]);
		expect(url).toMatch(/[?&]rt=auth\.session-expired\.[0-9a-z]+$/);
		expect(withoutRt(url)).toBe(
			'https://auth.autional.local/demo/login?redirect=' +
				encodeURIComponent('https://auth.autional.local/demo/dashboard') +
				'&from_requireauth=1',
		);
	});
});

describe('refreshToken onFailure 处置', () => {
	it("'clear'：刷新失败只清理会话，不做任何导航（导航权交调用方）", async () => {
		mockWindowLocation('/demo/dashboard');
		const { AuthService, useAuthStore } = await freshService();
		useAuthStore.setState({ accessToken: 'at-old', refreshToken: 'rt-opaque-1', isAuthenticated: true });
		mockPost.mockRejectedValue(new Error('refresh rejected'));

		const at = await AuthService.refreshToken({ onFailure: 'clear' });

		expect(at).toBeNull();
		expect(useAuthStore.getState().accessToken).toBeNull();
		expect(replaceSpy).not.toHaveBeenCalled();
	});

	it("'none'：刷新失败零副作用（会话保留、不导航）", async () => {
		mockWindowLocation('/demo/dashboard');
		const { AuthService, useAuthStore } = await freshService();
		useAuthStore.setState({ accessToken: 'at-old', refreshToken: 'rt-opaque-1', isAuthenticated: true });
		mockPost.mockRejectedValue(new Error('refresh rejected'));

		const at = await AuthService.refreshToken({ onFailure: 'none' });

		expect(at).toBeNull();
		expect(useAuthStore.getState().accessToken).toBe('at-old');
		expect(useAuthStore.getState().isAuthenticated).toBe(true);
		expect(replaceSpy).not.toHaveBeenCalled();
	});
});
