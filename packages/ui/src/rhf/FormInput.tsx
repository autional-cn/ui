import * as React from 'react';
import type { FieldValues } from 'react-hook-form';
import { FormField } from '../molecules/FormField';
import { fieldControlClass, fieldControlHeight } from '../internal/field-styles';
import { ControlSlot, useBoundField, type FormControlBaseProps } from './shared';

export interface FormInputProps<T extends FieldValues>
	extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'name' | 'defaultValue' | 'className' | 'prefix'>,
		FormControlBaseProps<T> {
	/**
	 * 控件内部的**前置装饰**（如金额框里的 ¥）。装饰是展示，不进表单值。
	 *
	 * 为什么收进 API 而不是让调用方自己拼：装饰必须贴在**输入框**上。
	 * 调用方若把装饰塞进 FormField 的控件槽，那一块的高度是整个控件块（含标签），
	 * `top-1/2` 会算到标签上，装饰就浮到输入框上沿去了 —— 实测两个页面都踩到，
	 * 于是各自复制了一份「把装饰和控件放进同一个定位块」的胶水代码。
	 */
	leading?: React.ReactNode;
	/** 控件内部的**后置装饰**（如显示/隐藏密码的按钮，可点，不是装饰而是控件）。 */
	trailing?: React.ReactNode;
}

/** 文本输入（绑定 react-hook-form）。 */
export function FormInput<T extends FieldValues>({
	name,
	control,
	rules,
	error: errorOverride,
	label,
	hint,
	required,
	leading,
	trailing,
	className = '',
	...rest
}: FormInputProps<T>) {
	const { field, error } = useBoundField(name, control, rules, errorOverride);
	// 装饰占位：设计系统固定给前置 2rem / 后置 2.5rem。需要别的宽度时用 FormField + ControlSlot
	// （同一个入口里导出的逃生口），而不是在这里加一个宽度 prop —— 那会长成配置表。
	const padding = [leading ? 'pl-8' : '', trailing ? 'pr-10' : ''].filter(Boolean).join(' ');
	return (
		<FormField label={label} hint={hint} error={error} required={required}>
			<ControlSlot
				render={(a11y) => (
					<div className={leading || trailing ? 'relative' : undefined}>
						{leading && (
							<span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-text-secondary)]">
								{leading}
							</span>
						)}
						<input
							{...rest}
							{...field}
							id={a11y.id}
							aria-invalid={a11y.invalid || undefined}
							aria-describedby={a11y.describedBy}
							className={fieldControlClass(a11y.invalid, [fieldControlHeight, padding, className].filter(Boolean).join(' '))}
						/>
						{trailing && (
							<span className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">{trailing}</span>
						)}
					</div>
				)}
			/>
		</FormField>
	);
}
