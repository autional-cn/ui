// 返回值必须显式写成 Uint8Array<ArrayBuffer>：TS 5.7 起 TypedArray 带上了 buffer 的类型参数，
// 裸写 Uint8Array 等于 Uint8Array<ArrayBufferLike>，而 PushManager.subscribe 要的是 BufferSource
// （= ArrayBufferView<ArrayBuffer>）—— 于是 @autional-cn/react 那边整包类型检查红着，
// 而 shared 自己的项目里看不出来（两边 tsconfig 的解析路径不同）。实测踩到，见计划 L1。
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const rawData = window.atob(base64);
	const bytes = Uint8Array.from(rawData.split('').map((c) => c.charCodeAt(0)));
	// from() 的结果在类型上是 Uint8Array<ArrayBuffer>，这里显式复制到独立 ArrayBuffer
	// 只是为了把「缓冲区归属」写死，避免将来换实现时又退回 ArrayBufferLike。
	const out = new Uint8Array(new ArrayBuffer(bytes.length));
	out.set(bytes);
	return out;
}
