import React, { useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { UI_I18N_NS, uiText } from '../i18n';

interface ModalProps {
	open: boolean;
	onClose: () => void;
	title?: string;
	/** 标题下的一行说明。多个页面原本把它写在自绘表头里（如「授权同意」弹窗），收进 API 才不用各自拼表头。 */
	description?: string;
	children: React.ReactNode;
	footer?: React.ReactNode;
	maxWidth?: 'sm' | 'md' | 'lg';
	className?: string;
}

const maxWidthClasses: Record<string, string> = {
	sm: 'max-w-sm',
	md: 'max-w-md',
	lg: 'max-w-lg',
};

export const Modal = React.memo(function Modal({
	open,
	onClose,
	title,
	description,
	children,
	footer,
	maxWidth = 'md',
	className = '',
}: ModalProps) {
	const { t, i18n } = useTranslation();
	// 关闭按钮的无障碍标签此前是写死的中文 —— 与 PortalSwitcher / PageStatus 走同一条解析链：
	// 站点注册过就用站点的，没注册回落内置表。
	const closeLabel = t('modal.close', {
		ns: UI_I18N_NS,
		defaultValue: uiText(i18n.language, 'modal.close') ?? '关闭',
	});

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		},
		[onClose],
	);

	useEffect(() => {
		if (open) {
			document.addEventListener('keydown', handleKeyDown);
			document.body.style.overflow = 'hidden';
		}
		return () => {
			document.removeEventListener('keydown', handleKeyDown);
			document.body.style.overflow = '';
		};
	}, [open, handleKeyDown]);

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<div className="absolute inset-0" onClick={onClose} />
			<div
				className={`relative w-full ${maxWidthClasses[maxWidth]} rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shadow-lg ${className}`}
			>
				{title && (
					<div className="flex items-start justify-between gap-4 border-b border-[var(--color-border-subtle)] px-6 py-4">
						<div>
							<h3 className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h3>
							{description && (
								<p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{description}</p>
							)}
						</div>
						<button
							onClick={onClose}
							className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
							aria-label={closeLabel}
						>
							<X className="h-4 w-4" />
						</button>
					</div>
				)}
				{!title && (
					<button
						onClick={onClose}
						className="absolute right-4 top-4 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
						aria-label={closeLabel}
					>
						<X className="h-4 w-4" />
					</button>
				)}
				<div className="px-6 py-4">{children}</div>
				{footer && (
					<div className="flex justify-end gap-3 border-t border-[var(--color-border-subtle)] px-6 py-4">
						{footer}
					</div>
				)}
			</div>
		</div>
	);
});
