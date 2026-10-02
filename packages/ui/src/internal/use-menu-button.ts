import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type React from 'react';

/**
 * W3C APG「menu button」最小实现：UserMenu / PortalSwitcher 共用。
 * trigger 携带 aria-haspopup/aria-expanded/aria-controls；菜单内 Arrow/Home/End
 * roving focus（条目 tabIndex=-1，由组件自行标注 role="menuitem"）、Esc 关闭并还焦、
 * Tab 关闭放行走位、document mousedown 外部点击关闭。
 */
export interface UseMenuButtonResult {
	open: boolean;
	setOpen: (next: boolean) => void;
	triggerId: string;
	menuId: string;
	triggerRef: React.RefObject<HTMLButtonElement | null>;
	menuRef: React.RefObject<HTMLDivElement | null>;
	triggerProps: React.ButtonHTMLAttributes<HTMLButtonElement>;
	menuProps: React.HTMLAttributes<HTMLDivElement>;
}

export function useMenuButton(): UseMenuButtonResult {
	const [open, setOpen] = useState(false);
	const rawId = useId();
	const triggerId = `${rawId}-trigger`;
	const menuId = `${rawId}-menu`;
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const focusOnOpenRef = useRef<'first' | 'last' | null>(null);

	const getItems = () =>
		Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

	const openWith = (position: 'first' | 'last') => {
		if (open) {
			const items = getItems();
			(position === 'first' ? items[0] : items[items.length - 1])?.focus();
		} else {
			focusOnOpenRef.current = position;
			setOpen(true);
		}
	};

	useEffect(() => {
		if (!open) return;
		const position = focusOnOpenRef.current;
		if (!position) return;
		focusOnOpenRef.current = null;
		const items = getItems();
		(position === 'first' ? items[0] : items[items.length - 1])?.focus();
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onMouseDown = (event: MouseEvent) => {
			const target = event.target as Node;
			if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
			setOpen(false);
		};
		document.addEventListener('mousedown', onMouseDown);
		return () => document.removeEventListener('mousedown', onMouseDown);
	}, [open]);

	const toggle = useCallback(() => setOpen((value) => !value), []);

	const triggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			openWith('first');
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			openWith('last');
		} else if (event.key === 'Escape' && open) {
			event.preventDefault();
			setOpen(false);
		}
	};

	const menuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		const items = getItems();
		if (items.length === 0) return;
		const current = items.indexOf(document.activeElement as HTMLElement);
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				items[(current + 1) % items.length]?.focus();
				break;
			case 'ArrowUp':
				event.preventDefault();
				items[(current - 1 + items.length) % items.length]?.focus();
				break;
			case 'Home':
				event.preventDefault();
				items[0]?.focus();
				break;
			case 'End':
				event.preventDefault();
				items[items.length - 1]?.focus();
				break;
			case 'Escape':
				event.preventDefault();
				setOpen(false);
				triggerRef.current?.focus();
				break;
			case 'Tab':
				// 不拦截：收起菜单，放行浏览器默认走位
				setOpen(false);
				break;
		}
	};

	return {
		open,
		setOpen,
		triggerId,
		menuId,
		triggerRef,
		menuRef,
		triggerProps: {
			id: triggerId,
			type: 'button',
			'aria-haspopup': 'menu',
			'aria-expanded': open,
			'aria-controls': open ? menuId : undefined,
			onClick: toggle,
			onKeyDown: triggerKeyDown,
		},
		menuProps: {
			id: menuId,
			role: 'menu',
			'aria-labelledby': triggerId,
			onKeyDown: menuKeyDown,
		},
	};
}
