/**
 * JWT payload 段解码（base64url → JSON）——共享层唯一的 JWT 载荷解码入口。
 *
 * JWT 段是 base64url 编码（RFC 7515 §2：`-`/`_` 替代 `+`/`/`、去填充），而 atob 只认
 * 标准 base64：载荷含 `-`/`_` 时裸 atob 抛 InvalidCharacterError。实测事故（PL-70）：
 * store 的 isTokenExpired 经裸 atob 解码失败 → 误判「已过期」→ 请求拦截器预判式刷新 →
 * 无 RT 的模拟会话被清会话弹登录。凡解码 JWT 载荷一律走本函数，勿再裸 atob。
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
	try {
		const segment = token.split('.')[1];
		if (!segment) return null;
		const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
		const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
		const binary = atob(padded);
		const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
		return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
	} catch {
		return null;
	}
}
