import React from 'react';
import { SOFT_TEXT } from '../internal/semantic-styles';

export type StatusVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface StatusBadgeProps {
	variant?: StatusVariant;
	children: React.ReactNode;
	className?: string;
}

// 配对的唯一来源在 internal/semantic-styles.ts（Alert 与它共用同一份）。
const variantStyles: Record<StatusVariant, string> = SOFT_TEXT;

export const StatusBadge = React.memo(function StatusBadge({
	variant = 'neutral',
	children,
	className = '',
}: StatusBadgeProps) {
	return (
		<span
			className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${variantStyles[variant]} ${className}`}
		>
			{children}
		</span>
	);
});
