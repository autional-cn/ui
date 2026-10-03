import * as React from 'react';
import type { FieldValues } from 'react-hook-form';
import { FormField } from '../molecules/FormField';
import { fieldControlClass, fieldControlHeight } from '../internal/field-styles';
import { ControlSlot, useBoundField, type FormControlBaseProps } from './shared';

export interface FormInputProps<T extends FieldValues>
	extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'name' | 'defaultValue' | 'className'>,
		FormControlBaseProps<T> {}

/** 文本输入（绑定 react-hook-form）。 */
export function FormInput<T extends FieldValues>({
	name,
	control,
	rules,
	error: errorOverride,
	label,
	hint,
	required,
	className = '',
	...rest
}: FormInputProps<T>) {
	const { field, error } = useBoundField(name, control, rules, errorOverride);
	return (
		<FormField label={label} hint={hint} error={error} required={required}>
			<ControlSlot
				render={(a11y) => (
					<input
						{...rest}
						{...field}
						id={a11y.id}
						aria-invalid={a11y.invalid || undefined}
						aria-describedby={a11y.describedBy}
						className={fieldControlClass(a11y.invalid, fieldControlHeight + ' ' + className)}
					/>
				)}
			/>
		</FormField>
	);
}
