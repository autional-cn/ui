// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// authTrace 三层回归锁（#48）
//  ① interstitial：被动跳转 → 提示条（可停留），延迟后 replace
//  ② debug=auth → 确认页（不自动跳，手动继续/留）
//  ③ 结构化日志：环形缓冲 / 凭据剥离 / ?rt= 跨站面包屑 / dump()
// ============================================================

const replaceSpy = vi.fn();
let assignCalls: string[] = [];
let currentHref = '';
const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');

// 只替换 window.location（不动 window 本体 —— stubGlobal 会连 localStorage/sessionStorage
// 一起遮蔽）。字段给纯值 + href getter/setter，绕开 jsdom Location brand check。
function mockWindowLocation(pathname: string, search = ''): void {
	currentHref = `https://user.autional.local${pathname}${search}`;
	Object.defineProperty(window, 'location', {
		configurable: true,
		value: {
			pathname,
			search,
			origin: 'https://user.autional.local',
			hostname: 'user.autional.local',
			protocol: 'https:',
			replace: replaceSpy,
			get href() {
				return currentHref;
			},
			set href(v: string) {
				assignCalls.push(v);
			},
		},
	});
}

/** 每例取全新模块实例：清 initialized / pending / buffer 模块态。 */
async function freshTrace() {
	vi.resetModules();
	return await import('../auth-trace');
}

function notice(): HTMLElement | null {
	return document.getElementById('auth-trace-notice');
}
function confirm(): HTMLElement | null {
	return document.getElementById('auth-trace-confirm');
}

beforeEach(() => {
	vi.clearAllMocks();
	assignCalls = [];
	sessionStorage.clear();
	document.body.innerHTML = '';
	document.documentElement.lang = 'zh-CN';
});

afterEach(() => {
	if (originalLocationDescriptor) {
		Object.defineProperty(window, 'location', originalLocationDescriptor);
	}
	document.body.innerHTML = '';
	vi.useRealTimers();
});

describe('层 ③ 结构化日志与缓冲', () => {
	it('traceEvent 写入环形缓冲，50 条封顶（丢最旧）', async () => {
		mockWindowLocation('/demo/');
		const { traceEvent, traceDump } = await freshTrace();
		for (let i = 0; i < 55; i++) traceEvent('evt', { reason: `r${i}` });
		const entries = (window as any).__authTrace.entries() as any[];
		expect(entries).toHaveLength(50);
		expect(entries[0].reason).toBe('r5');
		expect(entries[49].reason).toBe('r54');
		expect(traceDump()).toContain('r54');
	});

	it('缓冲中的 URL 剥除凭据类 query（token/code/state 不入 trace）', async () => {
		mockWindowLocation('/demo/dashboard');
		const { traceRedirect } = await freshTrace();
		traceRedirect(
			'https://auth.autional.local/demo/login?redirect=x&access_token=SECRET&code=ABC123&state=st&ok=1',
			{ reason: 'unauthenticated', kind: 'funnel' },
		);
		const entries = (window as any).__authTrace.entries() as any[];
		const to = entries[entries.length - 1].to as string;
		expect(to).not.toContain('SECRET');
		expect(to).not.toContain('ABC123');
		expect(to).not.toContain('state=');
		expect(to).toContain('ok=1');
	});

	it('dump() 含环境摘要与条目', async () => {
		mockWindowLocation('/demo/dashboard');
		const { traceEvent, traceDump } = await freshTrace();
		traceEvent('error-exit', { reason: 'session_expired' });
		const dump = traceDump();
		expect(dump).toContain('authTrace v1 @user');
		expect(dump).toContain('error-exit');
	});

	it('?rt= 跨站面包屑：读取接续为 handoff 条目', async () => {
		mockWindowLocation('/demo/login', '?rt=auth.unauthenticated.abc123&redirect=x');
		const { traceDump } = await freshTrace();
		const dump = traceDump();
		expect(dump).toContain('handoff');
		expect(dump).toContain('auth@');
	});
});

describe('层 ① interstitial 提示与停留', () => {
	it('被动跳转：先出提示条，延迟后 replace（URL 带 rt= 面包屑）', async () => {
		mockWindowLocation('/demo/dashboard');
		const { traceRedirect } = await freshTrace();
		vi.useFakeTimers();

		traceRedirect('https://auth.autional.local/demo/login?redirect=x', {
			reason: 'session-expired',
			kind: 'interstitial',
		});

		expect(replaceSpy).not.toHaveBeenCalled();
		expect(notice()).not.toBeNull();
		expect(notice()!.textContent).toContain('会话已过期');

		vi.advanceTimersByTime(1600);
		expect(notice()).toBeNull();
		expect(replaceSpy).toHaveBeenCalledTimes(1);
		expect(String(replaceSpy.mock.calls[0][0])).toContain('rt=user.session-expired.');
	});

	it('点「停留」：取消跳转 + pending 复位（后续 funnel 照常执行）', async () => {
		mockWindowLocation('/demo/dashboard');
		const { traceRedirect } = await freshTrace();
		vi.useFakeTimers();

		traceRedirect('https://auth.autional.local/demo/login?redirect=x', {
			reason: 'session-expired',
			kind: 'interstitial',
		});
		const stayBtn = Array.from(notice()!.querySelectorAll('button')).find((b) =>
			b.textContent!.includes('停留'),
		)!;
		stayBtn.click();

		expect(notice()).toBeNull();
		vi.advanceTimersByTime(5000);
		expect(replaceSpy).not.toHaveBeenCalled();

		// pending 已复位：funnel 直跳不受阻
		traceRedirect('https://brand.autional.local/?redirect=x', { reason: 'funnel-slug', kind: 'funnel' });
		expect(replaceSpy).toHaveBeenCalledTimes(1);
	});

	it('pending 抑制：提示条未决时再来一次 interstitial 被记为 suppressed', async () => {
		mockWindowLocation('/demo/dashboard');
		const { traceRedirect } = await freshTrace();
		vi.useFakeTimers();

		traceRedirect('https://auth.autional.local/demo/login', { reason: 'unauthenticated', kind: 'interstitial' });
		traceRedirect('https://auth.autional.local/other/login', { reason: 'unauthenticated', kind: 'interstitial' });

		const entries = (window as any).__authTrace.entries() as any[];
		expect(entries.filter((e) => e.ev === 'suppressed')).toHaveLength(1);
		vi.advanceTimersByTime(1600);
		expect(replaceSpy).toHaveBeenCalledTimes(1);
		expect(String(replaceSpy.mock.calls[0][0])).toContain('/demo/login');
	});

	it('funnel（缺省 kind）：静默直跳，不出现提示条', async () => {
		mockWindowLocation('/');
		const { traceRedirect } = await freshTrace();
		traceRedirect('https://brand.autional.local/?redirect=x', { reason: 'funnel-brand' });
		expect(notice()).toBeNull();
		expect(replaceSpy).toHaveBeenCalledTimes(1);
	});
});

describe('层 ② debug 确认页', () => {
	it('?debug=auth：不自动跳，确认页出现；点「继续前往」才 replace', async () => {
		mockWindowLocation('/demo/dashboard', '?debug=auth');
		const { traceRedirect } = await freshTrace();
		traceRedirect('https://auth.autional.local/demo/login?redirect=x', {
			reason: 'session-expired',
			kind: 'interstitial',
		});

		expect(replaceSpy).not.toHaveBeenCalled();
		expect(confirm()).not.toBeNull();
		expect(confirm()!.textContent).toContain('整页跳转确认');

		const goBtn = Array.from(confirm()!.querySelectorAll('button')).find((b) =>
			b.textContent!.includes('继续前往'),
		)!;
		goBtn.click();
		expect(replaceSpy).toHaveBeenCalledTimes(1);
		expect(String(replaceSpy.mock.calls[0][0])).toContain('debug=auth');
	});

	it('确认页点「留在本页」：不跳 + pending 复位', async () => {
		mockWindowLocation('/demo/dashboard', '?debug=auth');
		const { traceRedirect } = await freshTrace();
		traceRedirect('https://auth.autional.local/demo/login', { reason: 'unauthenticated', kind: 'funnel' });

		const stayBtn = Array.from(confirm()!.querySelectorAll('button')).find((b) =>
			b.textContent!.includes('留在本页'),
		)!;
		stayBtn.click();
		expect(confirm()).toBeNull();
		expect(replaceSpy).not.toHaveBeenCalled();
	});

	it('debug 标志经 sessionStorage 保持并随跳转透传（无需每次带 ?debug=auth）', async () => {
		mockWindowLocation('/demo/');
		const { traceRedirect } = await freshTrace();
		(window as any).__authTrace.on();

		traceRedirect('https://auth.autional.local/demo/login', { reason: 'unauthenticated' });
		expect(confirm()).not.toBeNull();
		const goBtn = Array.from(confirm()!.querySelectorAll('button')).find((b) =>
			b.textContent!.includes('继续前往'),
		)!;
		goBtn.click();
		expect(String(replaceSpy.mock.calls[0][0])).toContain('debug=auth');
	});

	it('assign 语义：opts.assign=true 走 location.href（登录/登出链保持新增历史）', async () => {
		mockWindowLocation('/demo/');
		const { traceRedirect } = await freshTrace();
		traceRedirect('https://auth.autional.local/?logout=1', { reason: 'logout', assign: true });
		expect(replaceSpy).not.toHaveBeenCalled();
		expect(assignCalls).toHaveLength(1);
		expect(assignCalls[0]).toContain('logout=1');
	});
});
