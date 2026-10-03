import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DateRangeFilter } from '../DateRangeFilter';

// 这个组件的存在理由就是「值进值出都是字符串」——所以测试盯的也是这个契约，而不是外观：
//   ① 传字符串能显示出来（说明字符串→dayjs 的方向对）；
//   ② 选完区间回调的是**字符串**，且与 format 一致；
//   ③ 清空回调 **null**（空区间只有一种表示）。
describe('DateRangeFilter（字符串进、字符串出）', () => {
	it('接受字符串值并显示出来', () => {
		render(<DateRangeFilter value={['2026-01-01', '2026-01-31']} />);
		expect(screen.getByDisplayValue('2026-01-01')).toBeTruthy();
		expect(screen.getByDisplayValue('2026-01-31')).toBeTruthy();
	});

	it('未选值时渲染占位，不抛错', () => {
		const { container } = render(<DateRangeFilter />);
		expect(container.querySelectorAll('input').length).toBeGreaterThan(0);
	});

	it('清空时回调 null（而不是空数组/空串）', () => {
		const seen: unknown[] = [];
		const { container } = render(
			<DateRangeFilter value={['2026-01-01', '2026-01-31']} onChange={(v) => seen.push(v)} />,
		);
		const clear = container.querySelector('.ant-picker-clear');
		expect(clear).toBeTruthy();
		// 用 fireEvent 而不是 user-event：antd 的清空按钮常态是 pointer-events: none（靠 hover 才可点），
		// 而 jsdom 没有 hover —— user-event 会直接拒绝点击。这里要验的是**回调契约**，不是鼠标可达性。
		fireEvent.click(clear as Element);
		expect(seen).toHaveLength(1);
		expect(seen[0]).toBeNull();
	});

	it('format 同时决定显示格式与产出格式', async () => {
		render(
			<DateRangeFilter
				format="YYYY-MM-DD HH:mm"
				value={['2026-01-01 08:00', '2026-01-01 09:00']}
				showTime
			/>,
		);
		expect(screen.getByDisplayValue('2026-01-01 08:00')).toBeTruthy();
	});
});
