import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { FormInput } from '../FormInput';
import { FormSelect } from '../FormSelect';
import { FormTextarea } from '../FormTextarea';

// 绑定控件存在的理由就是**接线**：标签连到控件、错误连到 aria。所以测试盯接线，不盯外观。
type Values = { email: string; plan: string; note: string };

function Harness() {
	const { control } = useForm<Values>({ defaultValues: { email: 'a@b.c', plan: 'pro', note: '' } });
	return (
		<form>
			<FormInput<Values> name="email" control={control} label="邮箱" hint="我们会发确认信" />
			<FormSelect<Values> name="plan" control={control} label="套餐">
				<option value="pro">专业版</option>
			</FormSelect>
			<FormTextarea<Values> name="note" control={control} label="备注" />
		</form>
	);
}

// 校验报错的路径要真的走一遍提交，否则「错误文本接没接上 aria」这条根本没被验到。
function InvalidHarness() {
	const { control, handleSubmit } = useForm<Values>({
		defaultValues: { email: '', plan: 'pro', note: '' },
	});
	return (
		<form onSubmit={handleSubmit(() => {})}>
			<FormInput<Values>
				name="email"
				control={control}
				label="邮箱"
				required
				rules={{ required: '邮箱必填' }}
			/>
			<button type="submit">提交</button>
		</form>
	);
}

describe('@autional-cn/ui/rhf 绑定控件', () => {
	it('标签通过 htmlFor 连到真实控件上（不是只画了一个 label）', () => {
		render(<Harness />);
		const input = screen.getByLabelText('邮箱');
		expect(input.tagName).toBe('INPUT');
	});

	it('select 与 textarea 同样接上标签', () => {
		render(<Harness />);
		expect(screen.getByLabelText('套餐').tagName).toBe('SELECT');
		expect(screen.getByLabelText('备注').tagName).toBe('TEXTAREA');
	});

	it('帮助文本通过 aria-describedby 接上（读屏器能念到）', () => {
		render(<Harness />);
		const input = screen.getByLabelText('邮箱');
		const id = input.getAttribute('aria-describedby');
		expect(id).toBeTruthy();
		expect(document.getElementById(id as string)?.textContent).toBe('我们会发确认信');
	});

	it('无错误时不打扰读屏器（没有 aria-invalid）', () => {
		render(<Harness />);
		expect(screen.getByLabelText('邮箱').getAttribute('aria-invalid')).toBeNull();
	});

	it('装饰（leading/trailing）渲染在控件内部，并自动让出内边距', () => {
		function Adorned() {
			const { control } = useForm<Values>({ defaultValues: { email: '1', plan: 'pro', note: '' } });
			return (
				<FormInput<Values>
					name="email"
					control={control}
					label="金额"
					leading="¥"
					trailing={<button type="button">显示</button>}
				/>
			);
		}
		const { container } = render(<Adorned />);
		const input = screen.getByLabelText('金额');
		// 装饰必须在**输入框所在的定位块**里（不是整个字段块），否则 top-1/2 会算到标签上。
		expect(container.querySelector('.relative > input')).toBeTruthy();
		expect(input.className).toContain('pl-8');
		expect(input.className).toContain('pr-10');
		expect(screen.getByText('¥')).toBeTruthy();
		expect(screen.getByRole('button', { name: '显示' })).toBeTruthy();
	});

	it('error 覆盖优先于表单库给的消息（页面自己控制报错文案）', async () => {
		// 本项目的 zod message 是 i18n 键，页面按字段给自己的键；没有这个口子就会悄悄换掉用户看到的文案。
		function Overridden() {
			const { control } = useForm<Values>({ defaultValues: { email: '', plan: 'pro', note: '' } });
			return (
				<FormInput<Values>
					name="email"
					control={control}
					label="邮箱"
					rules={{ required: 'mustMatch' }}
					error="请填写邮箱"
				/>
			);
		}
		const user = userEvent.setup();
		render(
			<form>
				<Overridden />
				<button type="submit">提交</button>
			</form>,
		);
		await user.click(screen.getByRole('button', { name: '提交' }));
		expect(await screen.findByText('请填写邮箱')).toBeTruthy();
		expect(screen.queryByText('mustMatch')).toBeNull();
	});

	it('校验失败：错误文本渲染出来，且 aria-invalid/describedby 指向它', async () => {
		const user = userEvent.setup();
		render(<InvalidHarness />);
		await user.click(screen.getByRole('button', { name: '提交' }));
		const msg = await screen.findByText('邮箱必填');
		// 用正则而不是精确串：必填标记（`*`）在 label 里带 aria-hidden，读屏器不会念它，
		// 但 Testing Library 是按 textContent 匹配的，会把那个星号算进标签文本。
		const input = screen.getByLabelText(/邮箱/);
		expect(input.getAttribute('aria-invalid')).toBe('true');
		// describedBy 此时指向**错误**而不是帮助文本：同一时刻只念一条，不矛盾。
		expect(input.getAttribute('aria-describedby')).toBe(msg.id);
	});
});
