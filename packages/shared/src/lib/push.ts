import { pushVapidPublicKey } from '../generated/api';
import { extractItem } from '../utils/response';
import { urlBase64ToUint8Array } from '../utils/browser';

export async function getVapidPublicKey(): Promise<string> {
	const res = await pushVapidPublicKey();
	// 拦截器已把 data.public_key 深转为 camelCase（api/client.ts）；
	// snake 兜底与本包既有双键读取惯例一致。
	const data = extractItem(res) as { publicKey?: string; public_key?: string } | null;
	const key = data?.publicKey ?? data?.public_key;
	if (!key) {
		throw new Error('Failed to get VAPID public key');
	}
	return key;
}

export async function subscribeBrowserPush(
	vapidPublicKey: string,
): Promise<PushSubscription | null> {
	if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
	const registration = await navigator.serviceWorker.ready;
	const existing = await registration.pushManager.getSubscription();
	if (existing) return existing;
	try {
		return await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
		});
	} catch (err) {
		console.error('Push subscription failed:', err);
		return null;
	}
}

export async function unsubscribeBrowserPush(): Promise<boolean> {
	if (!('serviceWorker' in navigator)) return false;
	const registration = await navigator.serviceWorker.ready;
	const sub = await registration.pushManager.getSubscription();
	if (sub) {
		await sub.unsubscribe();
		return true;
	}
	return false;
}
