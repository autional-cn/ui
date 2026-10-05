/**
 * authTrace —— auth 整页跳转的统一出口与三层可观测（#48）。
 *
 * 三层：
 *  ① interstitial 提示：**被动**整页跳转（会话终结 / 未认证深链）执行前显示提示条
 *     （原因 + 目标 host + 停留 / 立即前往），短延迟后自动前往。「停留」取消本次跳转；
 *     页面数据面虽已失效，但用户知情（消除「静默弹走」）。
 *  ② confirm 确认页：`?debug=auth`（或 __authTrace.on()）时所有整页跳转不自动执行，
 *     停在遮罩确认页（跳转详情 + 最近 trace 列表 + 继续 / 留）。debug 标志随跳转
 *     跨站透传，排障可全程跟随。
 *  ③ 结构化日志：`[auth-trace]` console 行 + sessionStorage 环形缓冲（跨 SPA 路由、
 *     同 tab 存活）+ `?rt=` 跨站面包屑（目标 URL 追加，下游站读取接续）+
 *     `__authTrace.dump()` 一键导出（排障取证）。
 *
 * kind 语义（提示层的适用面）：
 *  - 'interstitial'：被动跳转（会话终结 / buildLoginUrl 弹登录）→ 提示 + 延迟（可停留）。
 *  - 'funnel'（缺省）：预期漏斗（裸根 → brand / 登出 / OAuth 发起与回跳）→ 静默直跳，
 *    仅记 trace（用户主动或流程本身的必经步骤，加延迟只拖慢）。
 *  - debug 模式不分 kind，一律确认页。
 *
 * 隐私红线：缓冲与面包屑中的 URL 一律剥除凭据类 query（token/code/state 等），
 * 不落任何 PII。模块零依赖（不 import React / 各站设施），显式调用即用。
 */

const BUFFER_KEY = 'auth-trace-v1';
const DEBUG_KEY = 'auth-trace-debug';
const RT_PARAM = 'rt';
const DEBUG_PARAM = 'debug';
const DEBUG_VALUE = 'auth';
const BUFFER_LIMIT = 50;
const INTERSTITIAL_DELAY_MS = 1500;
const Z_INDEX = '2147483000';

/** URL query 中不得进入 trace 缓冲的凭据类键（前缀匹配）。 */
const SENSITIVE_KEYS = ['token', 'access_token', 'refresh_token', 'id_token', 'code', 'state', 'secret', 'password'];

export interface AuthTraceEntry {
	/** epoch ms */
	t: number;
	/** 事件类型：redirect / handoff / stay / suppressed / error-exit / … */
	ev: string;
	reason?: string;
	from?: string;
	to?: string;
}

export interface AuthTraceRedirectOptions {
	reason: string;
	kind?: 'interstitial' | 'funnel';
	/** true 用 location.href（新增历史），缺省 false 用 location.replace */
	assign?: boolean;
	/** 覆盖缺省延迟（ms），仅 interstitial 生效 */
	delayMs?: number;
	/**
	 * 「停留」被选择（提示条「停留」/ 确认页「留在本页」）时回调（AUTH-03）。
	 * 被动跳转（interstitial）取消后原页可能已无内容可渲染（如 RequireAuth 的
	 * 未认证空白态），调用方借此恢复可交互 UI。
	 */
	onStay?: () => void;
}

function isBrowser(): boolean {
	return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function station(): string {
	if (!isBrowser()) return 'ssr';
	return window.location.hostname.split('.')[0] || 'unknown';
}

function isZh(): boolean {
	if (!isBrowser()) return false;
	return (document.documentElement.lang || '').toLowerCase().startsWith('zh');
}

/** 剥除 URL 中的凭据类 query 参数（前缀命中 SENSITIVE_KEYS 即剥），保留其余。 */
function sanitizeUrl(raw: string): string {
	try {
		const u = new URL(raw, isBrowser() ? window.location.origin : 'https://x.invalid');
		for (const key of Array.from(u.searchParams.keys())) {
			if (SENSITIVE_KEYS.some((s) => key.toLowerCase() === s || key.toLowerCase().startsWith(`${s}_`))) {
				u.searchParams.delete(key);
			}
		}
		return u.toString();
	} catch {
		return raw.split(/[?#]/)[0];
	}
}

// ---------------------------------------------------------------- 缓冲（环形）

let bufferLoaded = false;
let buffer: AuthTraceEntry[] = [];

function readBuffer(): AuthTraceEntry[] {
	if (!isBrowser()) return [];
	if (!bufferLoaded) {
		bufferLoaded = true;
		try {
			const raw = sessionStorage.getItem(BUFFER_KEY);
			const parsed = raw ? JSON.parse(raw) : [];
			buffer = Array.isArray(parsed) ? parsed.slice(-BUFFER_LIMIT) : [];
		} catch {
			buffer = [];
		}
	}
	return buffer;
}

function writeBuffer(): void {
	if (!isBrowser()) return;
	try {
		sessionStorage.setItem(BUFFER_KEY, JSON.stringify(buffer.slice(-BUFFER_LIMIT)));
	} catch {
		// 存储受限（隐私模式 / 配额）时静默降级为仅 console
	}
}

function push(ev: string, extra?: Partial<AuthTraceEntry>): AuthTraceEntry {
	const entry: AuthTraceEntry = { t: Date.now(), ev, ...extra };
	readBuffer().push(entry);
	if (buffer.length > BUFFER_LIMIT) buffer = buffer.slice(-BUFFER_LIMIT);
	writeBuffer();
	if (isBrowser()) {
		// eslint-disable-next-line no-console
		console.info('[auth-trace]', entry.ev, entry.reason ?? '', entry.to ?? '');
	}
	return entry;
}

// ---------------------------------------------------------------- debug 与水印

function readRTP(): string | null {
	if (!isBrowser()) return null;
	try {
		return new URLSearchParams(window.location.search).get(RT_PARAM);
	} catch {
		return null;
	}
}

function inDebug(): boolean {
	if (!isBrowser()) return false;
	try {
		if (new URLSearchParams(window.location.search).get(DEBUG_PARAM) === DEBUG_VALUE) return true;
		return sessionStorage.getItem(DEBUG_KEY) === '1';
	} catch {
		return false;
	}
}

let initialized = false;

/** 懒初始化：吸收跨站面包屑（?rt=）与 debug 标志；同 URL 重复调用无副作用。 */
function ensureInit(): void {
	if (!isBrowser() || initialized) return;
	initialized = true;

	let urlDebug = false;
	try {
		urlDebug = new URLSearchParams(window.location.search).get(DEBUG_PARAM) === DEBUG_VALUE;
		if (urlDebug) sessionStorage.setItem(DEBUG_KEY, '1');
	} catch {
		/* noop */
	}

	const rt = readRTP();
	if (rt) {
		const [prevStation, prevReason, prevTs] = rt.split('.');
		if (prevStation && prevReason) {
			push('handoff', {
				from: `${prevStation}@${prevTs ? parseInt(prevTs, 36) : ''}`,
				reason: prevReason,
			});
		}
	}

	(window as any).__authTrace = {
		version: 1,
		dump: traceDump,
		entries: () => readBuffer().slice(),
		on: () => {
			try {
				sessionStorage.setItem(DEBUG_KEY, '1');
			} catch {
				/* noop */
			}
			return 'auth-trace debug ON（整页跳转将停在确认页；随跳转跨站透传）';
		},
		off: () => {
			try {
				sessionStorage.removeItem(DEBUG_KEY);
			} catch {
				/* noop */
			}
			return 'auth-trace debug OFF';
		},
	};

	if (urlDebug || rt) {
		// eslint-disable-next-line no-console
		console.info('[auth-trace] station', station(), urlDebug ? '(debug=on)' : '', rt ? `(handoff from ${rt.split('.')[0]})` : '');
	}
}

// ---------------------------------------------------------------- 目标 URL 装饰

/** 目标 URL 追加 rt=（本站 + 原因 + 时间）与 debug 透传（debug 开启时）。 */
function decorateTarget(target: string, reason: string): string {
	if (!isBrowser()) return target;
	try {
		const u = new URL(target, window.location.origin);
		if (!u.searchParams.has(RT_PARAM)) {
			u.searchParams.set(RT_PARAM, `${station()}.${reason}.${Date.now().toString(36)}`);
		}
		if (inDebug() && !u.searchParams.has(DEBUG_PARAM)) {
			u.searchParams.set(DEBUG_PARAM, DEBUG_VALUE);
		}
		return u.toString();
	} catch {
		return target;
	}
}

// ---------------------------------------------------------------- 跳转执行

let pending = false;

function go(target: string, assign: boolean): void {
	pending = true;
	try {
		if (assign) window.location.href = target;
		else window.location.replace(target);
	} catch (e) {
		// 非法目标不得冒泡炸掉调用方页面（effect 内抛出会被 ErrorBoundary 捕成整页错误）。
		// 记 trace 并保持当前页——例如 IP 主机下派生的 `brand.127.0.0.1`（非法 IPv4）。
		pending = false;
		push('error-exit', { reason: 'invalid-target', to: sanitizeUrl(target) });
		if (typeof console !== 'undefined') console.warn('[auth-trace] redirect rejected:', String(e));
	}
}

function removeNode(id: string): void {
	if (!isBrowser()) return;
	const el = document.getElementById(id);
	if (el && el.parentNode) el.parentNode.removeChild(el);
}

// ---------------------------------------------------------------- 层 ① 提示条

const NOTICE_ID = 'auth-trace-notice';

function reasonText(reason: string): { zh: string; en: string } {
	const map: Record<string, { zh: string; en: string }> = {
		'session-expired': { zh: '会话已过期', en: 'Session expired' },
		unauthenticated: { zh: '需要登录', en: 'Sign-in required' },
	};
	return map[reason] ?? { zh: '即将离开本页', en: 'Leaving this page' };
}

function showInterstitial(target: string, opts: AuthTraceRedirectOptions, onStay: () => void): void {
	const zh = isZh();
	const text = reasonText(opts.reason);
	const delay = opts.delayMs ?? INTERSTITIAL_DELAY_MS;

	removeNode(NOTICE_ID);
	const box = document.createElement('div');
	box.id = NOTICE_ID;
	box.setAttribute('role', 'status');
	box.style.cssText = [
		'position:fixed',
		'left:50%',
		'bottom:24px',
		'transform:translateX(-50%)',
		`z-index:${Z_INDEX}`,
		'display:flex',
		'align-items:center',
		'gap:12px',
		'max-width:calc(100vw - 32px)',
		'padding:10px 14px',
		'border-radius:8px',
		'background:rgba(17,24,39,.94)',
		'color:#f9fafb',
		'font-size:13px',
		'line-height:1.4',
		'font-family:system-ui,-apple-system,sans-serif',
		'box-shadow:0 8px 24px rgba(0,0,0,.28)',
	].join(';');

	const label = document.createElement('span');
	label.textContent = zh
		? `${text.zh}，即将前往登录（${delay / 1000} 秒后自动跳转）`
		: `${text.en} — redirecting to sign-in in ${delay / 1000}s`;
	box.appendChild(label);

	const mkButton = (txt: string, primary: boolean, onClick: () => void) => {
		const b = document.createElement('button');
		b.type = 'button';
		b.textContent = txt;
		b.style.cssText = [
			'border:0',
			'border-radius:6px',
			'padding:5px 10px',
			'font-size:13px',
			'cursor:pointer',
			primary ? 'background:#2563eb;color:#fff' : 'background:rgba(255,255,255,.14);color:#f9fafb',
		].join(';');
		b.addEventListener('click', onClick);
		return b;
	};

	const timer = setTimeout(() => {
		removeNode(NOTICE_ID);
		go(target, !!opts.assign);
	}, delay);

	box.appendChild(mkButton(zh ? '停留' : 'Stay', false, () => {
		clearTimeout(timer);
		removeNode(NOTICE_ID);
		onStay();
	}));
	box.appendChild(mkButton(zh ? '立即前往' : 'Go now', true, () => {
		clearTimeout(timer);
		removeNode(NOTICE_ID);
		go(target, !!opts.assign);
	}));

	document.body.appendChild(box);
}

// ---------------------------------------------------------------- 层 ② 确认页

const CONFIRM_ID = 'auth-trace-confirm';

function showConfirm(target: string, opts: AuthTraceRedirectOptions, onStay: () => void): void {
	const zh = isZh();
	removeNode(CONFIRM_ID);

	const overlay = document.createElement('div');
	overlay.id = CONFIRM_ID;
	overlay.style.cssText = [
		'position:fixed',
		'inset:0',
		`z-index:${Z_INDEX}`,
		'display:flex',
		'align-items:center',
		'justify-content:center',
		'background:rgba(15,23,42,.55)',
		'font-family:system-ui,-apple-system,sans-serif',
	].join(';');

	const card = document.createElement('div');
	card.style.cssText = [
		'width:min(560px,calc(100vw - 40px))',
		'max-height:80vh',
		'overflow:auto',
		'background:#fff',
		'color:#111827',
		'border-radius:10px',
		'padding:18px 20px',
		'box-shadow:0 20px 48px rgba(0,0,0,.32)',
		'font-size:13px',
	].join(';');

	const title = document.createElement('h2');
	title.textContent = zh ? '整页跳转确认（authTrace debug）' : 'Full-page redirect (authTrace debug)';
	title.style.cssText = 'margin:0 0 10px;font-size:15px;font-weight:600';
	card.appendChild(title);

	const detail = document.createElement('pre');
	detail.textContent = [
		`reason: ${opts.reason}`,
		`kind:   ${opts.kind ?? 'funnel'}`,
		`from:   ${sanitizeUrl(window.location.href)}`,
		`to:     ${target}`,
		'',
		...(readBuffer().slice(-10).map((e) => `${new Date(e.t).toISOString()}  ${e.ev}  ${e.reason ?? ''}  ${e.to ?? e.from ?? ''}`)),
	].join('\n');
	detail.style.cssText = [
		'margin:0 0 14px',
		'padding:10px',
		'border-radius:6px',
		'background:#f3f4f6',
		'white-space:pre-wrap',
		'word-break:break-all',
		'font-size:12px',
		'line-height:1.5',
		'max-height:46vh',
		'overflow:auto',
	].join(';');
	card.appendChild(detail);

	const mkButton = (txt: string, primary: boolean, onClick: () => void) => {
		const b = document.createElement('button');
		b.type = 'button';
		b.textContent = txt;
		b.style.cssText = [
			primary ? 'background:#2563eb;color:#fff' : 'background:#e5e7eb;color:#111827',
			'border:0',
			'border-radius:6px',
			'padding:7px 14px',
			'font-size:13px',
			'cursor:pointer',
			'margin-right:8px',
		].join(';');
		b.addEventListener('click', onClick);
		return b;
	};

	card.appendChild(mkButton(zh ? '继续前往' : 'Continue', true, () => {
		removeNode(CONFIRM_ID);
		go(target, !!opts.assign);
	}));
	card.appendChild(mkButton(zh ? '留在本页' : 'Stay', false, () => {
		removeNode(CONFIRM_ID);
		onStay();
	}));

	overlay.appendChild(card);
	document.body.appendChild(overlay);
}

// ---------------------------------------------------------------- 公开 API

/**
 * 统一整页跳转出口：记 trace →（debug 时）确认页 →（interstitial 时）提示条 →
 * 执行 location.replace/href。
 *
 * 重入语义：pending 期间新的 interstitial 请求被抑制（记 suppressed，防双提示/双跳）；
 * funnel 请求不被抑制（用户主动 / 流程必经，优先且覆盖 pending）。
 */
export function traceRedirect(target: string, opts: AuthTraceRedirectOptions): void {
	if (!isBrowser()) return;
	ensureInit();
	const kind = opts.kind ?? 'funnel';
	const decorated = decorateTarget(target, opts.reason);
	const from = sanitizeUrl(window.location.href);

	if (pending && kind === 'interstitial') {
		push('suppressed', { reason: opts.reason, from, to: sanitizeUrl(decorated) });
		return;
	}

	push('redirect', { reason: opts.reason, from, to: sanitizeUrl(decorated) });

	const onStay = () => {
		pending = false;
		push('stay', { reason: opts.reason, from, to: sanitizeUrl(decorated) });
		if (opts.onStay) {
			try {
				opts.onStay();
			} catch (e) {
				// 回调异常不得冒泡打断停留处理（trace 已记、pending 已复位）
				if (typeof console !== 'undefined') console.warn('[auth-trace] onStay rejected:', String(e));
			}
		}
	};

	if (inDebug()) {
		pending = true;
		showConfirm(decorated, opts, onStay);
		return;
	}

	if (kind === 'interstitial') {
		pending = true;
		showInterstitial(decorated, opts, onStay);
		return;
	}

	go(decorated, !!opts.assign);
}

/**
 * 清空 trace 缓冲与持久副本（AUTH-08 登出卫生）。
 * sessionStorage 跨整页导航天然保留——不清则上一会话的 trace 会驻留到下一
 * 会话（同一 tab 换人登录的场景）。
 */
export function traceClear(): void {
	if (!isBrowser()) return;
	buffer = [];
	bufferLoaded = true;
	try {
		sessionStorage.removeItem(BUFFER_KEY);
	} catch {
		/* noop */
	}
}

/** 记一条非跳转 trace 事件（如 error 页出口、OAuth 链路里程碑）。 */
export function traceEvent(ev: string, extra?: { reason?: string; from?: string; to?: string }): void {
	if (!isBrowser()) return;
	ensureInit();
	push(ev, extra);
}

/** 导出全部缓冲 + 环境摘要（`copy(__authTrace.dump())` 取证用）。 */
export function traceDump(): string {
	if (!isBrowser()) return '';
	ensureInit();
	const header = [
		`authTrace v1 @${station()}`,
		`url: ${sanitizeUrl(window.location.href)}`,
		`debug: ${inDebug() ? 'on' : 'off'}`,
		`ua: ${navigator.userAgent}`,
		`entries: ${readBuffer().length}`,
	];
	const lines = readBuffer().map((e) => `${new Date(e.t).toISOString()}  ${e.ev}  ${e.reason ?? ''}  ${e.to ?? e.from ?? ''}`);
	return [...header, '', ...lines].join('\n');
}
