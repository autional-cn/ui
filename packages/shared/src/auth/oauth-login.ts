/**
 * Dev-mode OAuth PKCE login utilities
 *
 * Used by RequireAuth when VITE_OAUTH_CLIENT_ID is configured.
 * Supports 3 profiles:
 *   - dev:   API=localhost, OAuth=off (password login, no OAuth)
 *   - oauth: API=localhost, OAuth=on  (local Docker API, tianv.local OAuth)
 *   - prod:  API=production, OAuth=on (production API, iam.tianv.com OAuth)
 */

import { apiClient } from '../api/client';
import { loginWithTokens } from './store';
import { AuthService } from './service';
import { generatePKCE } from './pkce';
import { getPortalUrl } from '../config';
import { persistOAuthClientId } from './oauth-client-id-store';
import { traceRedirect } from './auth-trace';
import { decodeJwtPayload } from './jwt-payload';
import type { User } from '../types';

function getAppConfig(): Record<string, string> | undefined {
	if (typeof window !== 'undefined') {
		return (window as any).__APP_CONFIG__;
	}
	return undefined;
}

const SK = {
	PKCE: 'oauth_pkce_verifier',
	STATE: 'oauth_state',
	INIT: 'oauth_init',
	INIT_TS: 'oauth_init_ts',
	CID: 'oauth_client_id',
};

/**
 * AUTH-46②：OAuth 回调失败错误——携稳定 code，消费方（OAuthCallbackPage 等）按 code
 * 映射本地化文案；message 保留英文原文供 console/诊断。此前直接 throw 英文裸句
 * （"State mismatch — possible CSRF attack" 等）落用户屏。
 */
export class OAuthCallbackError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = 'OAuthCallbackError';
		this.code = code;
	}
}

// 防重入拦截后的一次性重试 timer（避免 10 秒窗口内快速刷新导致 OAuth 跳转被吞、页面卡住）
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function parseUserFromToken(token?: string, apiUser?: unknown): User {
	if (token) {
		const p = decodeJwtPayload(token);
		if (p) {
			return {
				id: (p.sub || p.user_id) as string,
				username: ((p as any).custom?.username || (p as any).username) as string,
				email: p.email as string,
				status: 'active',
				avatarUrl: p.picture as string,
			} as unknown as User;
		}
	}
	return apiUser as User;
}

function envVar(key: string): string {
	const cfg = getAppConfig();
	if (cfg && cfg[key]) return cfg[key];
	try {
		return (import.meta as any).env?.[key] || '';
	} catch {
		return '';
	}
}

function getConfig() {
	const base = getPortalUrl('auth');
	const callbackPath = (window as any).__APP_CONFIG__?.BASE_PATH || '/';
	const origin = window.location.origin;
	return {
		clientId: envVar('VITE_OAUTH_CLIENT_ID'),
		authorizeUrl: `${base}/oauth/api/v1/oauth/authorize`,
		redirectUri:
			callbackPath === '/' ? `${origin}/oauth/callback` : `${origin}${callbackPath}/oauth/callback`,
		scope: 'openid profile email offline_access',
	};
}

export function isOAuthEnabled(): boolean {
	return !!envVar('VITE_OAUTH_CLIENT_ID');
}

function randomState(): string {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) {
		try {
			return crypto.randomUUID();
		} catch {
			/* fall through to getRandomValues */
		}
	}
	// crypto.getRandomValues is available in non-secure contexts too (unlike
	// randomUUID, which requires HTTPS/localhost). This value is used as the
	// OAuth state CSRF token — never degrade to a state-recoverable, predictable
	// PRNG or a timestamp (both are attackable for CSRF forgery). Fail loud.
	if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
		const bytes = new Uint8Array(16);
		crypto.getRandomValues(bytes);
		return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
	}
	throw new Error('No CSPRNG available — cannot generate secure OAuth state');
}

export async function initiateOAuthLogin(
	clientId?: string,
	redirectTarget?: string,
): Promise<void> {
	const ts = sessionStorage.getItem(SK.INIT_TS);
	if (ts && Date.now() - parseInt(ts, 10) < 10000) {
		// 防重入：10 秒内已有一次 OAuth 初始化（如快速刷新/重复导航）。
		// 直接 return 会吞掉跳转导致 RequireAuth 卡在空白页（无 re-render 不会重试），
		// 因此在窗口过期后安排一次自动重试，保证最终完成跳转。
		const wait = 10000 - (Date.now() - parseInt(ts, 10)) + 100;
		if (!retryTimer) {
			retryTimer = setTimeout(() => {
				retryTimer = null;
				void initiateOAuthLogin(clientId, redirectTarget);
			}, wait);
		}
		return;
	}
	sessionStorage.setItem(SK.INIT_TS, String(Date.now()));
	sessionStorage.setItem(SK.INIT, '1');

	// Determine the URL to redirect to after successful OAuth
	const target = redirectTarget || window.location.href;

	// Derive OAuth config (redirectUri computed from BASE_PATH, consistent with handleOAuthCallback)
	const cfg = getConfig();
	const cid = clientId || cfg.clientId;
	if (!cid) throw new Error('OAuth client_id is not available');

	// Always encode state as JSON with CSRF token + redirect target
	const csrf = randomState();
	const state = JSON.stringify({ csrf, redirect: target });

	sessionStorage.setItem(SK.STATE, csrf);
	sessionStorage.setItem(SK.CID, cid);
	// 交棒时落持久层：刷新/登出在 React 上下文外，拿不到 slug 解析结果（TASK-09 / D8）
	persistOAuthClientId(cid);

	try {
		const pkce = await generatePKCE();
		sessionStorage.setItem(SK.PKCE, pkce.verifier);
		const params = new URLSearchParams({
			response_type: 'code',
			client_id: cid,
			redirect_uri: cfg.redirectUri,
			scope: cfg.scope,
			code_challenge: pkce.challenge,
			code_challenge_method: 'S256',
			state,
		});
		// interstitial：未认证深链被动弹去登录 → authTrace 提示（可停留）；
		// 「停留」取消后 10s 防重入窗口过期即失效，用户刷新/再次交互可重新发起。
		traceRedirect(`${cfg.authorizeUrl}?${params}`, {
			reason: 'oauth-initiate',
			kind: 'interstitial',
			assign: true,
		});
	} catch {
		const params = new URLSearchParams({
			response_type: 'code',
			client_id: cid,
			redirect_uri: cfg.redirectUri,
			scope: cfg.scope,
			state,
		});
		traceRedirect(`${cfg.authorizeUrl}?${params}`, {
			reason: 'oauth-initiate',
			kind: 'interstitial',
			assign: true,
		});
	}
}

export async function handleOAuthCallback(): Promise<void> {
	const q = new URLSearchParams(window.location.search);

	const err = q.get('error');
	if (err) {
		throw new OAuthCallbackError(
			'oauth.provider_error',
			q.get('error_description') || `OAuth error: ${err}`,
		);
	}

	const code = q.get('code');
	if (!code) throw new OAuthCallbackError('oauth.missing_code', 'Missing authorization code');

	const storedState = sessionStorage.getItem(SK.STATE) || '';
	const verifier = sessionStorage.getItem(SK.PKCE) || '';
	const cid = sessionStorage.getItem(SK.CID) || '';

	// State is always JSON: { csrf, redirect }
	let oauthRedirectTarget: string | null = null;
	const rawState = q.get('state');
	if (rawState) {
		try {
			const parsed = JSON.parse(rawState);
			if (parsed.csrf && parsed.csrf === storedState) {
				oauthRedirectTarget = parsed.redirect || null;
			} else if (parsed.csrf) {
				throw new OAuthCallbackError(
					'oauth.state_mismatch',
					'State mismatch — possible CSRF attack',
				);
			}
		} catch (e) {
			if (e instanceof OAuthCallbackError) throw e;
			// Backward compat: plain string state (should not happen after Fix 3)
			if (rawState !== storedState) {
				throw new OAuthCallbackError(
					'oauth.state_mismatch',
					'State mismatch — possible CSRF attack',
				);
			}
		}
	}

	if (!verifier) {
		throw new OAuthCallbackError(
			'oauth.pkce_cleared',
			'Missing PKCE verifier — page reload may have cleared storage',
		);
	}

	// Derive redirectUri from getConfig() for consistency with initiateOAuthLogin
	const cbCfg = getConfig();
	const redirectUri = cbCfg.redirectUri;

	const res = await apiClient.post(
		'/oauth/api/v1/oauth/token', // @generated-api-exempt
		new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			client_id: cid,
			client_secret: '',
			redirect_uri: redirectUri,
			code_verifier: verifier,
		}).toString(),
		{ headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
	);

	const t = res.data as any;
	const accessToken = t.access_token;
	const refreshToken = t.refresh_token || null;

	// Prefer id_token for user info, fallback to /auth/me.
	// IMPORTANT: loginWithTokens (which populates the auth store) runs AFTER this block,
	// so the interceptor would send NO Authorization header here. Attach the freshly
	// exchanged access_token explicitly — otherwise /auth/me 401s and the apiClient
	// interceptor routes it through onUnauthorized (no refresh token yet) → bounce back
	// to the login page with the now-consumed code → infinite redirect loop.
	// oauth 服务的 id_token（oidc_signer.go SignIDToken）只含 sub/aud/iss/exp 等标准 claim，
	// 不含 email/username。若直接采信，/auth/me 兜底被短路 → store 落残缺 user →
	// UserMenu 等消费方显示「未登录」。缺身份字段的解析结果视为信息不足，交棒 /auth/me。
	let user: User | null = parseUserFromToken(t.id_token);
	if (user && !user.username && !user.email) {
		user = null;
	}
	if (!user && accessToken) {
		try {
			const me = await apiClient.get('/identity/api/v1/auth/me', {
				// @generated-api-exempt
				headers: { Authorization: `Bearer ${accessToken}` },
			});
			user = parseUserFromToken(undefined, me.data);
		} catch {
			// /auth/me may fail; loginWithTokens will still succeed with partial user
		}
	}
	if (!user && accessToken) {
		// 最后兜底：/auth/me 也失败时用 access_token JWT 解析 user
		// (identity 签发，payload 实测含 sub/tenant_id/custom.*，可能无 email/username)
		user = parseUserFromToken(accessToken);
	}
	if (!user) {
		user = { id: '', username: '', email: '' } as User;
	}

	// OIDC userinfo（oauth 服务经 BFF：/bff/oauth/api/v1/oauth/userinfo）补充展示身份：
	// id_token 与 /auth/me 都不含展示名（name/nickname/picture）。同样须显式带 access_token
	// （loginWithTokens 尚未执行，拦截器无 token 可用）。失败静默降级——缺 displayName 时
	// 消费方按 displayName → username → email 链回落，不影响登录。
	if (accessToken) {
		try {
			const res = await apiClient.get('/oauth/api/v1/oauth/userinfo', {
				// @generated-api-exempt
				headers: { Authorization: `Bearer ${accessToken}` },
			});
			const info = res.data as { nickname?: string; name?: string; picture?: string };
			const displayName = (info?.nickname || '').trim() || (info?.name || '').trim();
			if (displayName) user.displayName = displayName;
			if (info?.picture) user.avatarUrl = info.picture;
		} catch {
			// userinfo 失败不阻断登录（同上，按缺省链回落）
		}
	}

	// 兑换成功后落持久层（同 TASK-09 / D8；兑换前的持久值可能来自旧租户）
	persistOAuthClientId(cid);

	// Clean up temporary OAuth flow storage
	sessionStorage.removeItem(SK.STATE);
	sessionStorage.removeItem(SK.PKCE);
	sessionStorage.removeItem(SK.CID);

	// Persist to Zustand store (in-memory).
	// Zustand persist subscriber will automatically write to localStorage
	// via partialize — no manual localStorage.setItem needed.
	loginWithTokens(accessToken, refreshToken, user);

	// OAuth access_token 由身份服务签发，payload 含 tenant_id claim。
	// 登录成功后初始化 currentTenantId，供 useTenantId()/useTenantIdOr() 等
	// 页面使用真实租户（否则 fallback 'default-tenant' 导致 data-classification 等 404）。
	const parsedToken = accessToken ? decodeJwtPayload(accessToken) : null;
	const tokenTenantId = parsedToken?.tenant_id || (parsedToken as any)?.tenantId;
	if (tokenTenantId) {
		AuthService.updateCurrentTenant(tokenTenantId as string);
	}

	// Compute navigation target
	let target: string;
	if (oauthRedirectTarget) {
		target = oauthRedirectTarget;
	} else {
		// Fallback to BASE_PATH from app config or root
		const fallbackBase = (window as any).__APP_CONFIG__?.BASE_PATH || '/';
		target = fallbackBase === '/' ? '/' : `${window.location.origin}${fallbackBase}/`;
	}

	// Full page navigation to the target (auth gateway will route to dashboard)
	// funnel：登录成功回跳（预期行为，静默直跳，assign 保持原语义）；仅记 trace。
	traceRedirect(target, { reason: 'oauth-callback', assign: true });
}
