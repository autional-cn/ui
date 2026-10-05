import { useCallback, useEffect, useState } from 'react';
import { AuthService, setBootstrapLock } from '../auth/service';
import { buildLoginUrl } from '../auth/roles';
import { traceRedirect } from '../auth/auth-trace';
import { initiateOAuthLogin } from '../auth/oauth-login';
import {
	useTenantRoute,
	resolveEffectiveClientId,
	isSameDomainOAuth,
} from '../auth/tenant-route-middleware';
import { useAuthMachine } from '../auth/auth-machine';

interface RequireAuthProps {
	children: React.ReactNode;
	allowedRoles?: readonly string[];
	fallback?: React.ReactNode;
	loadingFallback?: React.ReactNode;
	/** 确定性未知 slug（by-slug HTTP 404）时渲染的 404 页；缺省用内置极简 404 兜底 */
	notFound?: React.ReactNode;
}

/**
 * 内置极简 404（零依赖，供未注入 notFound 的站点兜底 —— shared 不能 import 各
 * app 的 not-found/page）。样式用 CSS 变量 var(--color-*)，.dark 下自动反转。
 */
function DefaultTenantNotFound() {
	const zh =
		typeof document !== 'undefined' &&
		(document.documentElement.lang || '').toLowerCase().startsWith('zh');
	return (
		<div
			role="alert"
			style={{
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				minHeight: '40vh',
				gap: '0.5rem',
				width: '100%',
			}}
		>
			<h1 style={{ fontSize: '3rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>404</h1>
			<p style={{ color: 'var(--color-text-secondary)' }}>
				{zh ? '页面不存在或已被移除' : 'Page not found'}
			</p>
		</div>
	);
}

/**
 * AUTH-03：未认证态下用户选择「停留」（取消被动登录跳转）后的可恢复 UI——
 * 原实现停留后仍渲染 null（正文空白无任何出口），现替换为提示 + 「前往登录」出口。
 * 零依赖、CSS 变量主题（同 DefaultTenantNotFound）；按钮用固定 #2563eb（白字
 * 5.17:1 过 AA），不引品牌色（品牌色可能对比度不足，见 AUTH-05）。
 */
function DefaultSignInRequired({ onSignIn }: { onSignIn: () => void }) {
	const zh =
		typeof document !== 'undefined' &&
		(document.documentElement.lang || '').toLowerCase().startsWith('zh');
	return (
		<div
			role="alert"
			style={{
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				minHeight: '40vh',
				gap: '0.75rem',
				width: '100%',
			}}
		>
			<h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
				{zh ? '需要登录' : 'Sign-in required'}
			</h1>
			<p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', margin: 0 }}>
				{zh ? '此页面需登录后访问' : 'This page requires sign-in'}
			</p>
			<button
				type="button"
				onClick={onSignIn}
				style={{
					border: 0,
					borderRadius: 6,
					padding: '8px 18px',
					fontSize: '0.875rem',
					cursor: 'pointer',
					background: '#2563eb',
					color: '#fff',
				}}
			>
				{zh ? '前往登录' : 'Go to sign-in'}
			</button>
		</div>
	);
}

export function RequireAuth({
	children,
	allowedRoles,
	fallback,
	loadingFallback,
	notFound,
}: RequireAuthProps) {
	const machine = useAuthMachine();
	const tenantRoute = useTenantRoute();
	// 「停留」已选（被动登录跳转被用户取消）——渲染恢复态而非空白（AUTH-03）
	const [stayed, setStayed] = useState(false);

	// 登录跳转的单一出口：effect（进入未认证态）与恢复态「前往登录」按钮共用。
	// force=true 跳过 OAuth 10s 防重入窗口（用户显式重试）。
	const triggerLogin = useCallback(
		(force = false) => {
			if (typeof window === 'undefined') return;
			const cfg = (window as any).__APP_CONFIG__;
			const envClientId = cfg?.VITE_OAUTH_CLIENT_ID || '';
			const effectiveClientId = resolveEffectiveClientId(tenantRoute, envClientId);

			if (effectiveClientId && (isSameDomainOAuth(tenantRoute) || envClientId)) {
				void initiateOAuthLogin(effectiveClientId, undefined, {
					onStay: () => setStayed(true),
					force,
				});
				return;
			}

			// Cross-domain or no client: redirect to auth-pages login
			// from_requireauth=1 与 service.ts 的 onUnauthorized 同口径：auth 侧据此先做会话复检
			// （有会话直接回跳，避免「已登录还被要求再登一次」）
			// interstitial：未认证深链被动弹登录 → authTrace 提示（可停留）；重入抑制在其内。
			setTimeout(() => {
				traceRedirect(buildLoginUrl(window.location.href, true), {
					reason: 'unauthenticated',
					kind: 'interstitial',
					onStay: () => setStayed(true),
				});
			}, 0);
		},
		[tenantRoute],
	);

	// F-W6 闸门：URL slug 确定性不存在（by-slug HTTP 404）且本站未配 env 固定
	// client（admin-console 等单租户旁路不适用）→ 本地 404，不发弹跳。
	// 不然：门户 → buildLoginUrl → auth 侧有会话走「回跳 redirect」→ 回到本页
	// → 再弹跳，构成无限整页往返（verification-W5-patch §6）。
	// 网络错误/5xx 不置 unknownSlug（fail-open 仍走登录漏斗）；仅 unauthenticated 终态生效。
	const envClientId =
		typeof window !== 'undefined' ? (window as any).__APP_CONFIG__?.VITE_OAUTH_CLIENT_ID || '' : '';
	const unknownSlugGate =
		machine.status === 'unauthenticated' && tenantRoute.unknownSlug && !envClientId;

	// 挂载时抑制 401 抢跑：若当前域配置了 OAuth client 且本页无有效 token
	// （跨域 admin 场景），任何无 token API 请求的 401 都会触发 onUnauthorized →
	// buildLoginUrl 302 到 auth 登录页，抢跑下方 OAuth PKCE 决策，形成时序竞争。
	// 上锁后未登录跳转的唯一出口是下方 effect 的 OAuth/buildLoginUrl 决策。
	useEffect(() => {
		if (typeof window === 'undefined') return;
		const cfg = (window as any).__APP_CONFIG__;
		const envClientId = cfg?.VITE_OAUTH_CLIENT_ID || '';
		if (!envClientId) return;
		const rawToken = AuthService.getAccessToken();
		const hasToken = !!rawToken && rawToken !== 'undefined' && rawToken !== 'null';
		if (!hasToken) setBootstrapLock(true);
	}, []);

	// Redirect logic: only runs when machine says unauthenticated
	useEffect(() => {
		if (machine.status !== 'unauthenticated') return;
		if (typeof window === 'undefined') return;
		if (tenantRoute.loading) return; // wait for OAuth config

		const cfg = (window as any).__APP_CONFIG__;
		const envClientId = cfg?.VITE_OAUTH_CLIENT_ID || '';

		// F-W6 闸门：确定性未知 slug → 不发起任何弹跳，由渲染分支给本地 404
		if (tenantRoute.unknownSlug && !envClientId) return;

		triggerLogin(false);
	}, [machine.status, tenantRoute, triggerLogin]);

	if (machine.status === 'checking' || machine.status === 'bootstrap') {
		return loadingFallback ? <>{loadingFallback}</> : null;
	}

	if (unknownSlugGate) {
		return notFound ? <>{notFound}</> : <DefaultTenantNotFound />;
	}

	if (machine.status === 'unauthenticated' || machine.status === 'redirecting') {
		// AUTH-03：「停留」后原实现恒 null（空白死路）→ 给恢复态与再发起出口
		if (stayed) return <DefaultSignInRequired onSignIn={() => triggerLogin(true)} />;
		return null;
	}

	// status === 'ready' or 'authenticated'
	// 守卫三原则（ADR-AB1-01 / A-445 修复口径）：
	//   ① 精确角色相等：allowedRoles.includes(role) 直通——禁止任何子串/前缀判定
	//      （历史缺陷：权限码对角色白名单做子串包含判定，security_admin 借 14 条
	//      `*:admin` 权限码穿透一切含 'admin' 的白名单路由 = A-445）；
	//   ② '*' 单豁免：持全量通配 '*' 的非白名单角色放行（唯一豁免通道）；
	//   ③ 空权限 fail-closed：非白名单角色且无 '*' ⇒ 拒绝（fallback / null），
	//      空权限数组不再构成放行旁路。
	// role === null 保持穿透为锁定现语义（叠加语义）：更严闸门（AuthGuard /
	// PortalGuard）在更外层裁决未知角色，本组件不把 null 判为拒绝
	// （对抗用例④为防误改回归锁，改前先改裁定）。
	if (allowedRoles && allowedRoles.length > 0) {
		const role = AuthService.getCurrentRole();
		if (role && !allowedRoles.includes(role)) {
			const permissions = AuthService.getPermissions();
			const hasWildcard = !!permissions && permissions.some((p: string) => p === '*');
			if (!hasWildcard) {
				if (fallback) return <>{fallback}</>;
				return null;
			}
		}
	}

	return <>{children}</>;
}
