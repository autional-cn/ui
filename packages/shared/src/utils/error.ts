/**
 * Shared error handling utilities
 * Framework-agnostic: works with any UI notification system
 */

export interface ExtractedApiError {
	code: number | string;
	message: string;
}

export function extractApiErrorMessage(err: unknown, defaultMsg: string): string {
	return extractApiError(err, defaultMsg).message;
}

export function extractApiError(err: unknown, defaultMsg: string): ExtractedApiError {
	// UP-17-B：后端 Problem 契约（service-core/base/dto/problem.go）字段为 title（必填）/ detail / code / i18n_key，
	// **没有 message** —— 只认 message 会把整类后端错误退化成 defaultMsg。键链：message → title → detail → err.message。
	// 继续用 `||`（而非 `??`）：空串语义按「缺省」处理，与既有实现一致。
	return {
		code: (err as any)?.response?.data?.code || 'UNKNOWN',
		message:
			(err as any)?.response?.data?.message ||
			(err as any)?.response?.data?.title ||
			(err as any)?.response?.data?.detail ||
			(err as any)?.message ||
			defaultMsg,
	};
}

export function createHandleApiError(notify: (msg: string) => void) {
	return (err: unknown, defaultMsg: string): void => {
		notify(extractApiErrorMessage(err, defaultMsg));
	};
}
