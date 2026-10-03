import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Drawer } from '../Drawer';

// antd 的 Drawer 走 portal，渲染在 document.body 上，不在 render 的 container 里 ——
// 所以这里一律从 body 查（第一版按 container 查，6 条全红）。
const WIDTH = { sm: 480, md: 560, lg: 720, xl: 960 };
const panel = () => document.body.querySelector('.ant-drawer-content-wrapper') as HTMLElement | null;
const drawer = () => document.body.querySelector('.ant-drawer') as HTMLElement | null;

describe('Drawer（薄透传契约）', () => {
	it('渲染标题与内容', () => {
		render(<Drawer title="详情" open onClose={() => {}}>正文</Drawer>);
		expect(screen.getByText('详情')).toBeTruthy();
		expect(screen.getByText('正文')).toBeTruthy();
	});

	it('默认尺寸是 md(560)：不写 size 也不会落到 antd 的默认窄抽屉', () => {
		render(<Drawer title="x" open onClose={() => {}}>c</Drawer>);
		expect(panel()?.style.width).toBe(WIDTH.md + 'px');
	});

	it.each(['sm', 'md', 'lg', 'xl'] as const)('size=%s 映射到对应像素', (size) => {
		render(<Drawer title="x" size={size} open onClose={() => {}}>c</Drawer>);
		expect(panel()?.style.width).toBe(WIDTH[size] + 'px');
	});

	it('placement 恒为 right（方向也收进契约，站点不再各写一遍）', () => {
		render(<Drawer title="x" open onClose={() => {}}>c</Drawer>);
		expect(drawer()?.className).toContain('ant-drawer-right');
	});

	it('透传 extra / footer', () => {
		render(
			<Drawer
				title="x"
				open
				onClose={() => {}}
				extra={<button type="button">额外</button>}
				footer={<button type="button">底部</button>}
			>
				c
			</Drawer>,
		);
		expect(screen.getByText('额外')).toBeTruthy();
		expect(screen.getByText('底部')).toBeTruthy();
	});

	it('open=false 时不渲染抽屉内容', () => {
		render(<Drawer title="x" open={false} onClose={() => {}}>c</Drawer>);
		expect(document.body.querySelector('.ant-drawer-content')).toBeNull();
	});

	it('onClose 由 antd 的关闭链路触发（透传，不是自己重造）', () => {
		const onClose = vi.fn();
		render(<Drawer title="x" open onClose={onClose} closable>c</Drawer>);
		const btn = document.body.querySelector('.ant-drawer-close') as HTMLElement;
		expect(btn).toBeTruthy();
		btn.click();
		expect(onClose).toHaveBeenCalled();
	});
});
