import * as React from 'react';
import type { FieldValues } from 'react-hook-form';
import { FormField } from '../molecules/FormField';
import { fieldControlClass } from '../internal/field-styles';
import { ControlSlot, useBoundField, type FormControlBaseProps } from './shared';

export interface FormTextareaProps<T extends FieldValues>
	extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'name' | 'defaultValue' | 'className'>,
		FormControlBaseProps<T> {}

/** 多行文本（绑定 react-hook-form）。与单行控件的差别只有高度：不锁 h-10。 */
export function FormTextarea<T extends FieldValues>({
	name,
	control,
	rules,
	error: errorOverride,
	label,
	hint,
	required,
	className = '',
	rows = 3,
	...rest
}: FormTextareaProps<T>) {
	const { field, error } = useBoundField(name, control, rules, errorOverride);
	return (
		<FormField label={label} hint={hint} error={error} required={required}>
			<ControlSlot
				render={(a11y) => (
					<textarea
						{...rest}
						{...field}
						rows={rows}
						id={a11y.id}
						aria-invalid={a11y.invalid || undefined}
						aria-describedby={a11y.describedBy}
						className={fieldControlClass(a11y.invalid, className)}
					/>
				)}
			/>
		</FormField>
	);
}
