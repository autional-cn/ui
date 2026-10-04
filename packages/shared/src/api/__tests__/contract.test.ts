// TASK-AB1-28（fix-admin-b1-guard-contract / AC-AB1-51）：apiClient 拦截器契约 T1 回归锁。
//
// 断言口径 —— **全部 7 组均走真实拦截器**（只替换 axios adapter：请求拦截器之后最末环；
// 零 interceptor mock、零 spy 替换 setupInterceptors —— 供审查方逐组核对）。
// 锁定 client.ts 实际行为：
//   请求侧 :51-58（config.data / config.params → snakeCaseKeys）；响应侧 :81-105（信封装配 + camelCaseKeys）。
// 组清单：
//   G1 params：pageSize/currentPage → page_size/current_page（:56-58）
//   G2 请求体：camel 嵌套对象/数组 → snake 深转换（:51-53）
//   G3 透传：limit/keyword 未声明参数不被误信改写（snake 转换仅大写字母加 _，无语义改写）
//   G4 响应深 camel：snake → camel 递归（:105）
//   G5 信封：{code,message,data} → data 直给（:85-87；信封键不残留）
//   G6 items 分支：{code,items,total,pagination} → {items,total,pagination}（:89-95）
//   G7 简单分支：{code,message}（无 data/items）→ 整体返回（:97-99）+ raw_key → rawKey 代表样本

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { apiClient } from '../client';

interface CapturedCall {
	method: string;
	url: string;
	params?: Record<string, unknown>;
	body?: Record<string, unknown>;
}

let captured: CapturedCall[];
let originalAdapter: unknown;
let respond: (config: unknown) => unknown;

function installCaptureAdapter() {
	originalAdapter = apiClient.defaults.adapter;
	apiClient.defaults.adapter = (async (config: any) => {
		let body: Record<string, unknown> | undefined;
		if (typeof config.data === 'string' && config.data.length > 0) {
			body = JSON.parse(config.data);
		} else if (config.data && typeof config.data === 'object') {
			body = config.data as Record<string, unknown>;
		}
		captured.push({
			method: String(config.method || 'get').toLowerCase(),
			url: String(config.url || ''),
			params: config.params,
			body,
		});
		return { data: respond(config), status: 200, statusText: 'OK', headers: {}, config };
	}) as any;
}

describe('apiClient 拦截器契约（AC-AB1-51 · T1 护栏）', () => {
	beforeEach(() => {
		captured = [];
		respond = () => ({ code: 0, message: 'success', timestamp: '2026-10-04T00:00:00Z' });
		installCaptureAdapter();
	});

	afterEach(() => {
		apiClient.defaults.adapter = originalAdapter as any;
	});

	it('G1 请求 params：camel → snake（pageSize → page_size），走真实拦截器', async () => {
		await apiClient.get('/contract/probe', { params: { pageSize: 20, currentPage: 2 } });
		expect(captured).toHaveLength(1);
		expect(captured[0].params).toEqual({ page_size: 20, current_page: 2 });
	});

	it('G2 请求体：camel 嵌套对象/数组 → snake 深转换，走真实拦截器', async () => {
		await apiClient.post('/contract/probe', {
			userProfile: { displayName: '张三', nestedArray: [{ itemId: 1, subLevel: { deepKey: true } }] },
			totalCount: 3,
		});
		expect(captured).toHaveLength(1);
		expect(captured[0].body).toEqual({
			user_profile: {
				display_name: '张三',
				nested_array: [{ item_id: 1, sub_level: { deep_key: true } }],
			},
			total_count: 3,
		});
	});

	it('G3 透传：limit/keyword 未声明参数不被误信改写（无语义转换），走真实拦截器', async () => {
		await apiClient.get('/contract/probe', { params: { limit: 3, keyword: 'ali', pageSize: 10 } });
		expect(captured[0].params).toEqual({ limit: 3, keyword: 'ali', page_size: 10 });
	});

	it('G4 响应：snake → camel 深递归（嵌套对象/数组），走真实拦截器', async () => {
		respond = () => ({
			code: 0,
			message: 'success',
			data: {
				user_profile: {
					display_name: '张三',
					company_name: 'ACME',
					nested_list: [{ item_id: 1, created_at: '2026-10-04T00:00:00Z' }],
				},
			},
			timestamp: '2026-10-04T00:00:00Z',
		});
		const res = await apiClient.get('/contract/probe');
		expect(res.data).toEqual({
			userProfile: {
				displayName: '张三',
				companyName: 'ACME',
				nestedList: [{ itemId: 1, createdAt: '2026-10-04T00:00:00Z' }],
			},
		});
	});

	it('G5 响应：{code,message,data} 信封解包（data 直给，信封键不残留），走真实拦截器', async () => {
		respond = () => ({
			code: 0,
			message: 'success',
			data: { raw_key: 'v' },
			timestamp: '2026-10-04T00:00:00Z',
		});
		const res = await apiClient.get('/contract/probe');
		expect(res.data).toEqual({ rawKey: 'v' });
		expect((res.data as Record<string, unknown>).code).toBeUndefined();
		expect((res.data as Record<string, unknown>).message).toBeUndefined();
		expect((res.data as Record<string, unknown>).timestamp).toBeUndefined();
	});

	it('G6 响应：items 分支 {code,items,total,pagination} → 归一三键（条目深 camel），走真实拦截器', async () => {
		respond = () => ({
			code: 0,
			message: 'success',
			items: [{ raw_key: 'a', user_name: 'n' }],
			total: 1,
			pagination: { page: 1, page_size: 10, total_pages: 1 },
			timestamp: '2026-10-04T00:00:00Z',
		});
		const res = await apiClient.get('/contract/probe');
		expect(res.data).toEqual({
			items: [{ rawKey: 'a', userName: 'n' }],
			total: 1,
			pagination: { page: 1, pageSize: 10, totalPages: 1 },
		});
	});

	it('G7 响应：简单分支（无 data/items）整体返回 + raw_key → rawKey 代表样本，走真实拦截器', async () => {
		respond = () => ({
			code: 0,
			message: 'success',
			raw_key: 'v',
			timestamp: '2026-10-04T00:00:00Z',
		});
		const res = await apiClient.get('/contract/probe');
		expect(res.data).toEqual({
			code: 0,
			message: 'success',
			rawKey: 'v',
			timestamp: '2026-10-04T00:00:00Z',
		});
		expect((res.data as Record<string, unknown>).raw_key).toBeUndefined();
	});
});
