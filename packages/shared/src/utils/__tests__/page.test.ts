import { describe, it, expect } from 'vitest';
import { toPageParams, fromPageResult } from '../page';

describe('toPageParams（AC-AB1-29 请求侧）', () => {
	it('camel 入参 → 输出键集恰为 page/page_size（无 camel 残留）', () => {
		const out = toPageParams({ page: 2, pageSize: 20 });
		expect(Object.keys(out).sort()).toEqual(['page', 'page_size']);
		expect(out).toEqual({ page: 2, page_size: 20 });
		expect('pageSize' in out).toBe(false);
	});

	it('pageSize 缺省不输出键', () => {
		expect(toPageParams({ page: 1 })).toEqual({ page: 1 });
		expect(Object.keys(toPageParams())).toEqual([]);
		expect(Object.keys(toPageParams({ pageSize: 5 }))).toEqual(['page_size']);
	});
});

describe('fromPageResult（AC-AB1-29 响应侧三形态归一）', () => {
	it('扁平 {items,total} → items/total/page/page_size', () => {
		const out = fromPageResult<{ id: string }>({
			items: [{ id: 'a' }, { id: 'b' }],
			total: 42,
			page: 2,
			page_size: 20,
		});
		expect(out.items).toHaveLength(2);
		expect(out.total).toBe(42);
		expect(out.page).toBe(2);
		expect(out.page_size).toBe(20);
	});

	it('信封 {data:{items,total}} → 归一成功（total 取 data.total）', () => {
		const out = fromPageResult<{ id: string }>({
			data: { items: [{ id: 'x' }], total: 7, page: 3, page_size: 10 },
		});
		expect(out.items).toEqual([{ id: 'x' }]);
		expect(out.total).toBe(7);
		expect(out.page).toBe(3);
		expect(out.page_size).toBe(10);
	});

	it('裸数组 → items 为数组本体，total 取长度', () => {
		const out = fromPageResult<string>(['a', 'b', 'c']);
		expect(out.items).toEqual(['a', 'b', 'c']);
		expect(out.total).toBe(3);
	});

	it('空输入 → 空列表零值，不抛错', () => {
		const out = fromPageResult(null);
		expect(out.items).toEqual([]);
		expect(out.total).toBe(0);
	});
});
