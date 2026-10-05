import { useEffect, useState } from 'react';
import { handleOAuthCallback } from '../auth/oauth-login';

// 这个组件在 9 个站点各存一份，三处用户可见文案此前**三种写法并存**：
//   admin「正在登录…」 / platform「登录中…」 / 其余 7 站是英文「Signing in...」
// 也就是说 7 个中文门户在 OAuth 回调时会显示英文文案。
//
// 采用与权威 shared/ui/ErrorBoundary.tsx 完全相同的约定：用 <html lang> 判定文案语言，
// 默认中文——各 portal 的 I18nProvider 都会在 languageChanged 时同步它。
// （ErrorBoundary 当初就是因为各 portal 的 t() 约定不一致，才改用这个零依赖信号。）
const TEXT = {
	zh: {
		signingIn: '正在登录…',
		failed: '登录失败',
		retry: '重试',
		// AUTH-46②：OAuthCallbackError.code → 本地化文案（英文裸句不再落用户屏）
		'oauth.provider_error': '身份提供商返回错误，请返回重试',
		'oauth.missing_code': '授权响应缺少授权码，请返回重试',
		'oauth.state_mismatch': '登录状态校验失败（可能为安全原因），请重新登录',
		'oauth.pkce_cleared': '登录页面刷新导致登录凭据丢失，请重新登录',
		generic: '登录失败，请返回重试',
	},
	en: {
		signingIn: 'Signing in...',
		failed: 'Login failed',
		retry: 'Try again',
		'oauth.provider_error': 'The identity provider returned an error. Please go back and retry.',
		'oauth.missing_code': 'The authorization response is missing a code. Please retry.',
		'oauth.state_mismatch': 'Login state verification failed (possibly for security reasons). Please sign in again.',
		'oauth.pkce_cleared': 'The page reload cleared the login credentials. Please sign in again.',
		generic: 'Login failed. Please go back and retry.',
	},
};

function text(): typeof TEXT.zh {
	if (typeof document === 'undefined') return TEXT.zh;
	const lang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
	return lang.startsWith('zh') ? TEXT.zh : TEXT.en;
}

/** AUTH-46②：按错误 code 取本地化文案；无 code（未知错误）给通用文案并保留原文到 console。 */
function errorText(t: typeof TEXT.zh, e: unknown): string {
	const code = (e as { code?: string })?.code;
	if (code && (t as Record<string, string>)[code]) return (t as Record<string, string>)[code];
	console.error('[oauth-callback]', e);
	return t.generic;
}

export function OAuthCallbackPage() {
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(true);
	const t = text();

	useEffect(() => {
		handleOAuthCallback().catch((e) => {
			setError(errorText(t, e));
			setLoading(false);
		});
	}, []);

	if (loading) {
		return (
			<div className="flex h-screen items-center justify-center bg-neutral-50">
				<div className="flex flex-col items-center gap-3">
					<div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
					<p className="text-sm text-neutral-500">{t.signingIn}</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-screen items-center justify-center bg-neutral-50">
			<div className="max-w-sm rounded-lg border border-red-200 bg-red-50 p-6 text-center">
				<p className="text-sm font-medium text-red-700">{t.failed}</p>
				<p className="mt-1 text-xs text-red-600">{error}</p>
				<a href="/" className="mt-4 inline-block text-sm text-blue-600 underline">
					{t.retry}
				</a>
			</div>
		</div>
	);
}
