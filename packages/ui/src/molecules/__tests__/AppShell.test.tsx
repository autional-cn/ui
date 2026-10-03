import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { AppShell } from '../AppShell';

const setup = (props: Partial<React.ComponentProps<typeof AppShell>> = {}) =>
	render(
		<AppShell brand={<span>Brand</span>} nav={<a href="/a">A</a>} {...props}>
			<div>content</div>
		</AppShell>,
	);

describe('AppShell', () => {
	it('渲染品牌、导航与内容', () => {
		setup();
		expect(screen.getByText('Brand')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'A' })).toBeTruthy();
		expect(screen.getByText('content')).toBeTruthy();
	});

	it('顶栏高度走 --layout-header-height（写死高度会被第 13 道闸门判红）', () => {
		const { container } = setup();
		const header = container.querySelector('header') as HTMLElement;
		expect(header.className).toContain('h-[var(--layout-header-height)]');
		expect(header.className).toContain('sticky');
		// 写死的 h-16 / h-14 这类不能出现在顶栏上
		expect(/\bh-1[0-9]\b|\bh-[0-9]\b/.test(header.className)).toBe(false);
	});

	it('内容区是独立的滚动容器（min-h-0 + overflow-auto），页面不会再各自写一遍', () => {
		const { container } = setup();
		const main = container.querySelector('main') as HTMLElement;
		expect(main.className).toContain('overflow-auto');
		expect(main.className).toContain('min-h-0');
		expect(main.className).toContain('p-4 lg:p-8');
	});

	it('内容内边距可覆盖（个别页面不需要默认留白时可以换掉）', () => {
		const { container } = setup({ contentClassName: 'p-0' });
		const main = container.querySelector('main') as HTMLElement;
		expect(main.className).toContain('p-0');
		expect(main.className).not.toContain('p-4 lg:p-8');
	});

	it('移动端抽屉：未打开时不渲染遮罩，也不平移', () => {
		const { container } = setup();
		expect(container.querySelector('.fixed.inset-0')).toBeNull();
		const aside = container.querySelector('aside') as HTMLElement;
		expect(aside.className).toContain('-translate-x-full');
	});

	it('移动端抽屉：打开时渲染遮罩并平移到位', () => {
		const { container } = setup({ mobileOpen: true });
		expect(container.querySelector('.fixed.inset-0')).toBeTruthy();
		const aside = container.querySelector('aside') as HTMLElement;
		expect(aside.className).toContain('translate-x-0');
	});

	it('点遮罩会请求关闭', () => {
		const onMobileClose = vi.fn();
		const { container } = setup({ mobileOpen: true, onMobileClose });
		fireEvent.click(container.querySelector('.fixed.inset-0') as HTMLElement);
		expect(onMobileClose).toHaveBeenCalledTimes(1);
	});

	it('关闭按钮带无障碍标签，点它也请求关闭', () => {
		const onMobileClose = vi.fn();
		setup({ mobileOpen: true, onMobileClose, closeLabel: '关闭菜单' });
		const btn = screen.getByRole('button', { name: '关闭菜单' });
		fireEvent.click(btn);
		expect(onMobileClose).toHaveBeenCalledTimes(1);
	});

	it('侧栏收起只改宽度，不改结构', () => {
		const { container: a } = setup();
		const { container: b } = setup({ sidebarCollapsed: true });
		expect((a.querySelector('aside') as HTMLElement).className).not.toContain('lg:w-16');
		expect((b.querySelector('aside') as HTMLElement).className).toContain('lg:w-16');
	});

	it('sidebarExtra 落在品牌区与导航之间', () => {
		const { container } = setup({ sidebarExtra: <div data-testid="extra" /> });
		const aside = container.querySelector('aside') as HTMLElement;
		expect(aside.children[1].getAttribute('data-testid')).toBe('extra');
	});

	it('外壳不依赖 antd：源码里没有 antd 导入（user 门户的 antd 入口是 0）', () => {
		// 这条由依赖策略闸门（P3）在包的层面守着；这里做一个更近的断言：
		// 组件渲染出的 DOM 里没有任何 antd 的类名前缀。
		const { container } = setup();
		expect(container.innerHTML).not.toContain('ant-');
	});
});
