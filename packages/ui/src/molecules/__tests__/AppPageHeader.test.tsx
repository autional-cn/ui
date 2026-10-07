import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { AppPageHeader } from '../AppPageHeader';

describe('AppPageHeader', () => {
	it('渲染标题', () => {
		render(<AppPageHeader title="租户管理" />);
		expect(screen.getByRole('heading', { level: 1, name: '租户管理' })).toBeTruthy();
	});

	it('标题是 h1 而不是 div —— 收敛前 106 处内联页头用的也是 h1，语义不能退化', () => {
		render(<AppPageHeader title="审计日志" />);
		expect(screen.getByRole('heading', { level: 1 }).tagName).toBe('H1');
	});

	it('没有 description / actions 时不多渲染空容器', () => {
		const { container } = render(<AppPageHeader title="概览" />);
		const root = container.firstElementChild as HTMLElement;
		expect(root.children.length).toBe(1);
		expect(root.textContent).toBe('概览');
	});

	it('description 落在标题之后', () => {
		const { container } = render(<AppPageHeader title="API 文档" description="供第三方接入使用" />);
		expect(container.textContent).toBe('API 文档供第三方接入使用');
	});

	it('actions 渲染在标题之后（DOM 顺序 = 阅读顺序：窄屏纵向堆叠时操作区在下方）', () => {
		const { container } = render(
			<AppPageHeader title="用户" actions={<button type="button">新建</button>} />,
		);
		const root = container.firstElementChild as HTMLElement;
		expect(root.children.length).toBe(2);
		expect(screen.getByRole('button', { name: '新建' })).toBeTruthy();
	});

	it('固定覆盖 mb-6：收敛掉 mb-4/mb-6 两种间距', () => {
		const { container } = render(<AppPageHeader title="计费" />);
		expect((container.firstElementChild as HTMLElement).className).toContain('mb-6');
	});

	it('className 是追加而不是覆盖', () => {
		const { container } = render(<AppPageHeader title="计费" className="print:hidden" />);
		const cls = (container.firstElementChild as HTMLElement).className;
		expect(cls).toContain('print:hidden');
		expect(cls).toContain('mb-6');
	});

	it('标题可以是节点（含图标的标题不该被逼成字符串）', () => {
		render(
			<AppPageHeader
				title={
					<span>
						<em>SoD</em> 职责分离
					</span>
				}
			/>,
		);
		expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('SoD 职责分离');
	});
});
