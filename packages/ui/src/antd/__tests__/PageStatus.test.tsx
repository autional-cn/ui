import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageError, PageLoading } from '../PageStatus';

// 这两个组件原先在 admin 与 platform **各有一份**（逐字相同，只差 i18n），
// admin 侧还配了一份 6 个用例的组件测试。合并之后实现与测试一起搬到这里，
// 站点侧那份测试已删 —— 覆盖不许因为「文件搬了」而变少，所以下面这几条是照着原用例逐条搬过来的：
// 自定义 message / 有 retry 时的按钮 / 无 retry 时没有按钮 / 点击回调 / **默认文案** / 自定义 className。
describe('PageLoading / PageError（控制台整页占位）', () => {
	it('PageLoading 渲染 antd Spin，并可覆盖 tip', () => {
		const { container } = render(<PageLoading tip="正在拉取" />);
		expect(container.querySelector('.ant-spin')).toBeTruthy();
		expect(screen.getByText('正在拉取')).toBeTruthy();
	});

	it('PageLoading 未给 tip 时回落内置文案（不是空字符串）', () => {
		const { container } = render(<PageLoading />);
		// 只断言「有兜底文案」，不写死措辞 —— 措辞是文案，改措辞不该让测试变红。
		expect((container.textContent ?? '').trim()).not.toBe('');
	});

	it('PageError 显示传入的 message', () => {
		render(<PageError message="数据加载失败" />);
		expect(screen.getByText('数据加载失败')).toBeTruthy();
	});

	it('PageError 未给 message 时也有默认文案', () => {
		const { container } = render(<PageError />);
		expect((container.textContent ?? '').trim()).not.toBe('');
	});

	it('有 retry 时渲染重试按钮，点击触发回调', async () => {
		const onRetry = { count: 0 };
		const user = userEvent.setup();
		render(<PageError message="加载失败" retry={() => { onRetry.count++; }} />);
		const btn = screen.getByRole('button');
		await user.click(btn);
		expect(onRetry.count).toBe(1);
	});

	it('没有 retry 时不渲染按钮', () => {
		const { container } = render(<PageError message="加载失败" />);
		expect(container.querySelector('button')).toBeNull();
	});

	it('className 透传到最外层容器', () => {
		const { container } = render(<PageError className="custom-error" />);
		expect(container.firstElementChild?.className).toContain('custom-error');
	});
});
