import { describe, it, expect } from 'vitest';
import { needsNamespaceHeader } from '../namespace';

describe('needsNamespaceHeader', () => {
	it('密钥 admin 组端点（列表/子路径/查询）需注 X-Namespace', () => {
		expect(needsNamespaceHeader('/secret/api/v1/admin/secrets')).toBe(true);
		expect(needsNamespaceHeader('/secret/api/v1/admin/secrets/detail?key=a/b')).toBe(true);
		expect(needsNamespaceHeader('/secret/api/v1/admin/secrets/batch-delete')).toBe(true);
		expect(needsNamespaceHeader('/secret/api/v1/admin/secrets/policy')).toBe(true);
	});

	it('非密钥 admin 端点不注头', () => {
		expect(needsNamespaceHeader('/notification/api/v1/admin/announcements')).toBe(false);
		expect(needsNamespaceHeader('/tenant/api/v1/admin/tenants')).toBe(false);
	});

	it('secret 公开面/internal 面不注头（前端不消费）', () => {
		expect(needsNamespaceHeader('/secret/public/jwt/public-key')).toBe(false);
		expect(needsNamespaceHeader('/secret/api/v1/secret/public/transmission/public-key')).toBe(false);
		expect(needsNamespaceHeader('/api/v1/internal/secret/jwt/keys')).toBe(false);
	});

	it('相对路径缺省（undefined/空）不注头', () => {
		expect(needsNamespaceHeader(undefined)).toBe(false);
		expect(needsNamespaceHeader('')).toBe(false);
	});
});
