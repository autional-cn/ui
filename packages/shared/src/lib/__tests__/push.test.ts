import { describe, it, expect, vi } from 'vitest';

vi.mock('../../generated/api', () => ({
	pushVapidPublicKey: vi.fn(),
}));

import { getVapidPublicKey } from '../push';
import { pushVapidPublicKey } from '../../generated/api';

const mockPushVapidPublicKey = vi.mocked(pushVapidPublicKey);

describe('getVapidPublicKey', () => {
	// 回归锁（2026-10-05）：响应拦截器（api/client.ts）把 data.public_key 深转为
	// camelCase，此前此处死读 public_key ⇒ 线上「启用 Push 通知」100% 抛
	// "Failed to get VAPID public key"（authenticator W4/AU-33 验证腿实证）。
	it('reads camelCase publicKey（拦截器转换后的形状）', async () => {
		mockPushVapidPublicKey.mockResolvedValue({ publicKey: 'BPwrXxzEBIzhhbZcFnDb-85' });
		await expect(getVapidPublicKey()).resolves.toBe('BPwrXxzEBIzhhbZcFnDb-85');
	});

	it('tolerates snake_case public_key（双键兜底）', async () => {
		mockPushVapidPublicKey.mockResolvedValue({ public_key: 'snake-key' });
		await expect(getVapidPublicKey()).resolves.toBe('snake-key');
	});

	it('throws when payload carries neither key', async () => {
		mockPushVapidPublicKey.mockResolvedValue({});
		await expect(getVapidPublicKey()).rejects.toThrow('Failed to get VAPID public key');
	});
});
