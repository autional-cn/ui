// @vitest-environment jsdom
// PL-70 回归锁：JWT 段是 base64url（`-`/`_` 替代 `+`/`/`、无填充），裸 atob 对含 `-`/`_`
// 的载荷抛 InvalidCharacterError → store.isTokenExpired 误判「已过期」→ 请求拦截器
// 预判式刷新 → 无 RT 的模拟会话被清会话弹登录。旧套件用 btoa 直造「标准 base64」载荷，
// 恰好覆盖不到此形态（preflight-refresh.test.ts 的 expiredJwt 即此盲区）。
import { describe, it, expect } from 'vitest';
import { decodeJwtPayload } from '../jwt-payload';
import { isTokenExpired } from '../store';

// 造 base64url 载荷段。pad 连排 9 个 '?'（0x3F）：任意连续 3 个字节位置中恰有一个
// 全局下标 ≡2 (mod 3)，其 6bit 组 = 低 6 位 111111 → base64 字符 63 → base64url `_`
// ——保证段内定产 `_`，用例真实覆盖 base64url 形态而非碰运气。
function makeToken(payload: Record<string, unknown>): { token: string; segment: string } {
	const json = JSON.stringify({ ...payload, pad: '?????????' });
	let binary = '';
	for (const b of Array.from(Buffer.from(json, 'utf8'))) binary += String.fromCharCode(b);
	const segment = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	return { token: `eyJhbGciOiJIUzI1NiJ9.${segment}.sig`, segment };
}

describe('decodeJwtPayload（base64url 归一化）', () => {
	it('含 -/_ 的 base64url 载荷可解，且非 ASCII 正确还原', () => {
		const { token, segment } = makeToken({ exp: 4102444800, n: 'ÿ中文' });
		expect(segment).toMatch(/[-_]/);
		const payload = decodeJwtPayload(token);
		expect(payload?.n).toBe('ÿ中文');
		expect(payload?.exp).toBe(4102444800);
	});

	it('畸形输入 → null（不抛）', () => {
		expect(decodeJwtPayload('not-a-jwt')).toBeNull();
		expect(decodeJwtPayload('a.b')).toBeNull();
		expect(decodeJwtPayload('a.!!!.c')).toBeNull();
		expect(decodeJwtPayload('a.' + btoa('not json') + '.c')).toBeNull();
	});

	it('isTokenExpired：base64url 载荷 + 未来 exp → false（旧实现误判 true 的事故形态）', () => {
		const exp = Math.floor(Date.now() / 1000) + 3600;
		const { token, segment } = makeToken({ exp, n: 'ÿ' });
		expect(segment).toMatch(/[-_]/);
		expect(isTokenExpired(token)).toBe(false);
	});

	it('isTokenExpired：过期 exp → true；畸形 token → true', () => {
		const { token } = makeToken({ exp: Math.floor(Date.now() / 1000) - 60, n: 'ÿ' });
		expect(isTokenExpired(token)).toBe(true);
		expect(isTokenExpired('not-a-jwt')).toBe(true);
	});
});
