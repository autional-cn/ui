import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { Result } from '../Result';

describe('Result', () => {
	it('渲染图标、标题、说明与动作', () => {
		render(
			<Result variant="success" title="配对成功" description="设备已加入家庭" action={<button>返回设备</button>} />
		);
		expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('配对成功');
		expect(screen.getByText('设备已加入家庭')).toBeTruthy();
		expect(screen.getByRole('button', { name: '返回设备' })).toBeTruthy();
		expect(document.querySelector('svg')).toBeTruthy();
	});

	it('plain 面：白底 + 同色边框；tinted 面：整块同色浅底', () => {
		const { container: plain } = render(<Result variant="danger" title="失败" />);
		const p = (plain.firstElementChild as HTMLElement).className;
		expect(p).toContain('bg-[var(--color-bg-surface)]');
		expect(p).toContain('border-danger-soft');
		expect(p).not.toContain('bg-danger-soft');
		const { container: tinted } = render(<Result variant="danger" surface="tinted" title="失败" />);
		const t = (tinted.firstElementChild as HTMLElement).className;
		expect(t).toContain('bg-danger-soft');
		expect(t).toContain('text-danger-text');
		expect(t).toContain('border-danger-soft');
	});

	it('说明文字永远用 -text 那一档，不许出现裸的语义色', () => {
		for (const v of ['success', 'warning', 'danger', 'info'] as const) {
			const { container, unmount } = render(<Result variant={v} description="说明" />);
			const p = container.querySelector('p') as HTMLElement;
			expect(p.className).toContain('text-' + v + '-text');
			expect(p.className).not.toMatch(new RegExp('text-' + v + '(?!-text)'));
			unmount();
		}
	});

	it('没有 title / description / action 时就少渲染那几块', () => {
		const { container } = render(<Result />);
		expect(container.querySelector('h2')).toBeNull();
		expect(container.querySelector('p')).toBeNull();
	});

	it('icon={null} 时连徽标一起不渲染', () => {
		const { container } = render(<Result icon={null} title="无图标" />);
		expect(container.querySelector('span')).toBeNull();
	});

	it('title 可以是节点（404 那种大字写在标题里）', () => {
		render(<Result title={<span className="text-4xl font-bold">404</span>} description="页面不存在" />);
		const h2 = screen.getByRole('heading', { level: 2 });
		expect(h2.textContent).toBe('404');
	});

	it('className 是追加', () => {
		const { container } = render(<Result className="mt-8" />);
		const cls = (container.firstElementChild as HTMLElement).className;
		expect(cls).toContain('mt-8');
		expect(cls).toContain('rounded-lg');
	});
});
