// 表单控件的外观只有一份 —— Input atom 与 @autional-cn/ui/rhf 的绑定控件都用它。
// 各自复制一份类名串的后果不是「看起来一样」，而是「改了一处、另一处没变」：
// 那正是这一层要消灭的东西（与 antd 组件级令牌同理，只是这里是一段 Tailwind 类）。

const BASE =
	'flex w-full rounded-md border bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

/** 单行控件的高度。textarea 不给（它要能长高）。 */
export const fieldControlHeight = 'h-10';

export function fieldControlClass(invalid?: boolean, extra = ''): string {
	const border = invalid ? 'border-[var(--color-danger)]' : 'border-[var(--color-border-subtle)]';
	return `${BASE} ${border} ${extra}`.trim();
}
