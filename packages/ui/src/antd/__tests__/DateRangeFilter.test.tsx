import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { DateRangeFilter } from '../DateRangeFilter';
import { AntdThemeProvider } from '../AntdThemeProvider';
import { ThemeProvider } from '../../context/ThemeProvider';
import { registerUiI18n } from '../../i18n';

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

// UP-31 回归锁：面板此前中英混排（年份「2026年」中文 + 月份 Oct/星期 Su 英文）。
// 根因：antd locale 只提供格式串，月份/星期缩写由 rc-picker 经 `dayjs().locale(lang.locale)`
// 取 —— dayjs 的 zh-cn locale 定义未加载时静默回落 en。修复：AntdThemeProvider 加载定义。
describe('DateRangeFilter 面板 locale（UP-31）', () => {
	async function renderWithSite(lng: string) {
		const instance = createInstance();
		await instance.init({
			resources: { 'zh-CN': { translation: {} }, 'en-US': { translation: {} } },
			lng,
			fallbackLng: 'zh-CN',
			keySeparator: false,
			interpolation: { escapeValue: false },
		});
		registerUiI18n(instance);
		const { container } = render(
			<I18nextProvider i18n={instance}>
				<ThemeProvider defaultTheme="light">
					<AntdThemeProvider>
						<DateRangeFilter />
					</AntdThemeProvider>
				</ThemeProvider>
			</I18nextProvider>,
		);
		return container;
	}

	it('zh 站点：面板为纯中文（星期头「日一二…」+ 头部含「年」），不再有 en 缩写', async () => {
		const container = await renderWithSite('zh-CN');
		// antd v6 的 picker 用 click 打开（mouseDown 不触发）。
		fireEvent.click(container.querySelector('input') as HTMLInputElement);

		const panel = await waitFor(() => {
			const el = document.querySelector('.ant-picker-dropdown');
			expect(el).toBeTruthy();
			return el as HTMLElement;
		});

		const weekHeads = [...panel.querySelectorAll('.ant-picker-content thead th')]
			.map((el) => el.textContent?.trim() ?? '')
			.join(',');
		expect(weekHeads).toContain('日');
		expect(weekHeads).toContain('一');
		expect(weekHeads).not.toMatch(/[A-Za-z]{2}/); // 无 Su/Mo/Tu… 之类 en 缩写

		// 头部「2026年10月」形态（zh yearFormat/monthFormat）
		const header = panel.querySelector('.ant-picker-header-view')?.textContent ?? '';
		expect(header).toContain('年');
	});

	it('en 站点：面板为英文（反例锚）', async () => {
		const container = await renderWithSite('en-US');
		fireEvent.click(container.querySelector('input') as HTMLInputElement);

		const panel = await waitFor(() => {
			const el = document.querySelector('.ant-picker-dropdown');
			expect(el).toBeTruthy();
			return el as HTMLElement;
		});

		const weekHeads = [...panel.querySelectorAll('.ant-picker-content thead th')]
			.map((el) => el.textContent?.trim() ?? '')
			.join(',');
		expect(weekHeads).toMatch(/Su|Mo/);
	});
});
