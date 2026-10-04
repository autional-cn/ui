import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { Alert } from '../Alert';

describe('Alert', () => {
	it('渲染标题与正文，并带 role="alert"', () => {
		render(
			<Alert variant="warning" title="即将过期">
				有 3 条记录将于 7 天后过期。
			</Alert>
		);
		const el = screen.getByRole('alert');
		expect(el.textContent).toContain('即将过期');
		expect(el.textContent).toContain('有 3 条记录将于 7 天后过期。');
	});

	it('四档配色都走 -soft / -text 这一对（不许出现 text-danger 这种纯色字）', () => {
		const cases: [string, string][] = [
			['success', 'bg-success-soft'],
			['warning', 'bg-warning-soft'],
			['danger', 'bg-danger-soft'],
			['info', 'bg-info-soft']
		];
		for (const [variant, soft] of cases) {
			const { container, unmount } = render(<Alert variant={variant as never}>x</Alert>);
			const cls = (container.firstElementChild as HTMLElement).className;
			expect(cls).toContain(soft);
			expect(cls).toContain('text-' + variant + '-text');
			expect(cls).not.toMatch(new RegExp('text-' + variant + '(?!-text)'));
			unmount();
		}
	});

	it('默认按档位给图标；传 icon={null} 就不要图标', () => {
		const { container: withIcon } = render(<Alert variant="danger">x</Alert>);
		expect((withIcon.firstElementChild as HTMLElement).querySelector('svg')).toBeTruthy();
		const { container: without } = render(<Alert variant="danger" icon={null}>x</Alert>);
		expect((without.firstElementChild as HTMLElement).querySelector('svg')).toBeNull();
	});

	it('可以自定义图标', () => {
		render(<Alert icon={<span data-testid="my-icon" />}>x</Alert>);
		expect(screen.getByTestId('my-icon')).toBeTruthy();
	});

	it('closable 才渲染关闭按钮，点了会回调，并带无障碍标签', () => {
		const onClose = vi.fn();
		const { container: plain } = render(<Alert>x</Alert>);
		expect(plain.querySelector('button')).toBeNull();
		render(
			<Alert closable onClose={onClose} closeLabel="收起提示">
				x
			</Alert>
		);
		fireEvent.click(screen.getByRole('button', { name: '收起提示' }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('只有正文时不渲染标题行；只有标题时不渲染正文容器', () => {
		const { container: onlyBody } = render(<Alert>只有正文</Alert>);
		expect((onlyBody.firstElementChild as HTMLElement).querySelectorAll('p').length).toBe(0);
		const { container: onlyTitle } = render(<Alert title="只有标题" />);
		expect((onlyTitle.firstElementChild as HTMLElement).textContent).toBe('只有标题');
	});

	it('action 落在右侧（与关闭按钮同排）', () => {
		render(
			<Alert variant="warning" title="试用即将到期" action={<button>升级</button>} closable closeLabel="收起">
				到期后数据会被删除。
			</Alert>
		);
		const el = screen.getByRole('alert');
		expect(screen.getByRole('button', { name: '升级' })).toBeTruthy();
		expect(screen.getByRole('button', { name: '收起' })).toBeTruthy();
		// 顺序：内容 → 动作 → 关闭
		const texts = Array.from(el.children).map((c) => (c.textContent || '').trim());
		expect(texts[texts.length - 1]).toBe('');
		expect(texts[texts.length - 2]).toBe('升级');
	});

	it('className 是追加（配色不能被调用方换掉）', () => {
		const { container } = render(<Alert className="mt-4">x</Alert>);
		const cls = (container.firstElementChild as HTMLElement).className;
		expect(cls).toContain('mt-4');
		expect(cls).toContain('bg-info-soft');
	});
});
