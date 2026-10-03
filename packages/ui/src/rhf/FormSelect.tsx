import * as React from 'react';
import type { FieldValues } from 'react-hook-form';
import { FormField } from '../molecules/FormField';
import { fieldControlClass, fieldControlHeight } from '../internal/field-styles';
import { ControlSlot, useBoundField, type FormControlBaseProps } from './shared';

export interface FormSelectProps<T extends FieldValues>
	extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'name' | 'defaultValue' | 'className'>,
		FormControlBaseProps<T> {}

/** 下拉选择（绑定 react-hook-form，原生 select + 设计系统的控件外观）。 */
export function FormSelect<T extends FieldValues>({
	name,
	control,
	rules,
	error: errorOverride,
	label,
	hint,
	required,
	className = '',
	children,
	...rest
}: FormSelectProps<T>) {
	const { field, error } = useBoundField(name, control, rules, errorOverride);
	return (
		<FormField label={label} hint={hint} error={error} required={required}>
			<ControlSlot
				render={(a11y) => (
					<select
						{...rest}
						{...field}
						id={a11y.id}
						aria-invalid={a11y.invalid || undefined}
						aria-describedby={a11y.describedBy}
						className={fieldControlClass(a11y.invalid, fieldControlHeight + ' ' + className)}
					>
						{children}
					</select>
				)}
			/>
		</FormField>
	);
}
