import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

// 这条锁的是**跨门户共用的那套文案机制**：字典按 document.documentElement.lang 选语言。
// 四个门户现在都在 i18n 初始化里同步这个属性（2026-10-03 补齐），错误页因此能跟随语言。
// 没有这条用例，将来谁把同步删了/改了，只会在某个门户的英文界面里静默地看到中文 —— 没人会发现。
function Boom(): React.ReactNode {
	throw new Error('boom');
}

describe('ErrorBoundary 文案语言', () => {
	afterEach(() => {
		cleanup();
		document.documentElement.lang = 'zh-CN';
		vi.restoreAllMocks();
	});

	it('zh-CN：显示内置中文文案', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		document.documentElement.lang = 'zh-CN';
		render(
			<ErrorBoundary>
				<Boom />
			</ErrorBoundary>,
		);
		expect(screen.getByText('页面出错了')).toBeTruthy();
	});

	it('en-US：同一份错误显示内置英文文案', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		document.documentElement.lang = 'en-US';
		render(
			<ErrorBoundary>
				<Boom />
			</ErrorBoundary>,
		);
		expect(screen.getByText('Something went wrong')).toBeTruthy();
	});

	it('props 优先于内置字典（门户仍可覆盖）', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		document.documentElement.lang = 'en-US';
		render(
			<ErrorBoundary title="自定义标题">
				<Boom />
			</ErrorBoundary>,
		);
		expect(screen.getByText('自定义标题')).toBeTruthy();
	});
});
