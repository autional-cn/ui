import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Table } from 'antd';
import antdTheme from '@autional-cn/tokens/antd-theme';
import { ThemeProvider } from '../../context/ThemeProvider';
import { AntdThemeProvider, useAntdApp } from '../AntdThemeProvider';

// 这两个用例是「桥确实把令牌送到了 antd」的**可执行证据**，不是形式检查。
// 为什么非要有它：令牌桥此前是四份同构代码（三个控制台各一份 + 设计系统一份），
// 且三份都只传 token、不传 components —— Table 的表头底色因此从来没有跟随过令牌。
// 光看代码「传了 components」不算数：antd 的组件级令牌走 CSS-in-JS，
// 真正落地与否要看它生成出来的样式。所以这里直接读 jsdom 里 antd 注入的 <style>。

const columns = [{ title: 'N', dataIndex: 'n', key: 'n' }];
const data = [{ key: '1', n: 'a' }];

const headCss = () =>
	Array.from(document.querySelectorAll('style')).map((s) => s.textContent || '').join('\n').toLowerCase();

function Probe() {
	const app = useAntdApp();
	return (
		<span data-testid="probe">
			{typeof app.message.success}/{typeof app.modal.confirm}/{typeof app.notification.open}
		</span>
	);
}

describe('AntdThemeProvider（antd 与设计系统令牌之间的唯一桥）', () => {
	it('正向：components.Table 的令牌真的落到了 antd 生成的样式里', () => {
		// 负向控制先跑：不挂桥时，同一张表**不得**出现设计系统的表头底色。
		// 没有这一步，下面的断言可能因为「antd 出厂值恰好等于令牌值」而假装通过。
		cleanup();
		render(<Table columns={columns} dataSource={data} pagination={false} />);
		const plain = headCss();
		const headerBg = String(antdTheme.light.components.Table.headerBg).toLowerCase();
		expect(plain).not.toContain(headerBg);
		cleanup();

		render(
			<ThemeProvider storageKey="ds-antd-theme-test">
				<AntdThemeProvider locale="zh-CN">
					<Table columns={columns} dataSource={data} pagination={false} />
				</AntdThemeProvider>
			</ThemeProvider>,
		);
		const bridged = headCss();
		expect(bridged).toContain(headerBg);
		expect(bridged).toContain(String(antdTheme.light.components.Table.borderColor).toLowerCase());
	});

	it('useAntdApp 在桥内部给出 message / modal / notification', () => {
		const { getByTestId } = render(
			<ThemeProvider storageKey="ds-antd-theme-test">
				<AntdThemeProvider locale="zh-CN">
					<Probe />
				</AntdThemeProvider>
			</ThemeProvider>,
		);
		expect(getByTestId('probe').textContent).toBe('function/function/function');
	});
});
