import * as React from 'react';
import { fieldControlClass, fieldControlHeight } from '../internal/field-styles';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
	error?: string;
}

// 外观来自 ../internal/field-styles —— 与 @autional-cn/ui/rhf 的绑定控件同一份，不各自维护。
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
	({ className = '', error, ...props }, ref) => {
		return (
			<div className="w-full">
				<input ref={ref} className={fieldControlClass(!!error, fieldControlHeight + ' ' + className)} {...props} />
				{error && <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
			</div>
		);
	},
);
Input.displayName = 'Input';
