import {
	createContext,
	useContext,
	useState,
	useCallback,
	useRef,
	useEffect,
	type ReactNode,
} from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { SOFT_BORDER, SOFT_TEXT } from '../internal/semantic-styles';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
	id: string;
	message: string;
	type: ToastType;
}

interface ToastContextValue {
	addToast: (message: string, type?: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
	const ctx = useContext(ToastContext);
	if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
	return ctx;
}

let globalShow: ((message: string, type?: ToastType, duration?: number) => void) | null = null;

export function showToast(message: string, type: ToastType = 'info', duration?: number) {
	globalShow?.(message, type, duration);
}

const ICONS: Record<ToastType, typeof CheckCircle> = {
	success: CheckCircle,
	error: AlertCircle,
	warning: AlertTriangle,
	info: Info,
};

// 第 63 轮补·四：改用与 Alert / StatusBadge **同一份**语义配对（internal/semantic-styles.ts 的 SOFT_TEXT）。
// 此前是「实底 + 白字」，实测对白字的对比度 ≈ success 2.6 / error 3.4 / warning 2.2 : 1 —— 三档都不达 AA 4.5:1，
// 而 Toast 不在任何对比度目标页里，所以这条判据从未扫到它（「不是判据错了，是判据没扫到」）。
// 换成 -soft / -text 配对后，对比度是设计系统建这一份配对时就验过的：
// success 5.51 / warning 4.85 / danger 4.65 / info 6.70 —— 与 Alert 同一个来源，不再有第二套。
// 底 + 字 + 边框三件都取自那一份配对（Alert / StatusBadge 同源）：软底若不带边框，
// 贴在白卡上分不出边界 —— Alert 早就是这么做的，Toast 直接跟它对齐。
const STYLES: Record<ToastType, string> = {
	success: SOFT_TEXT.success + ' ' + SOFT_BORDER.success,
	error: SOFT_TEXT.danger + ' ' + SOFT_BORDER.danger,
	warning: SOFT_TEXT.warning + ' ' + SOFT_BORDER.warning,
	info: SOFT_TEXT.info + ' ' + SOFT_BORDER.info,
};

export function ToastProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<ToastItem[]>([]);
	const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

	const removeToast = useCallback((id: string) => {
		setToasts((prev) => prev.filter((t) => t.id !== id));
		if (timers.current[id]) {
			clearTimeout(timers.current[id]);
			delete timers.current[id];
		}
	}, []);

	const addToast = useCallback(
		(message: string, type: ToastType = 'info', duration = 3000) => {
			const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
			setToasts((prev) => [...prev, { id, message, type }]);
			timers.current[id] = setTimeout(() => removeToast(id), duration);
		},
		[removeToast],
	);

	globalShow = addToast;

	useEffect(() => {
		return () => {
			Object.values(timers.current).forEach(clearTimeout);
		};
	}, []);

	return (
		<ToastContext.Provider value={{ addToast }}>
			{children}
			<div className="pointer-events-none fixed right-4 top-4 z-[100] flex flex-col gap-2">
				{toasts.map((toast) => {
					const Icon = ICONS[toast.type];
					return (
						<div
							key={toast.id}
							className={`pointer-events-auto flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium shadow-card ${STYLES[toast.type]}`}
						>
							<Icon className="h-4 w-4 shrink-0" />
							<span className="flex-1">{toast.message}</span>
							<button
								onClick={() => removeToast(toast.id)}
								className="ml-1 shrink-0 rounded-xs p-0.5 opacity-70 hover:opacity-100"
							>
								<X className="h-3.5 w-3.5" />
							</button>
						</div>
					);
				})}
			</div>
		</ToastContext.Provider>
	);
}
