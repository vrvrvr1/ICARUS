// Simple in-memory tracking store for order locations.
// This can be replaced by a persistent store (Redis/DB) later.

const store = new Map(); // key: orderId (string|number) -> { lat, lng, status, updatedAt }

export function getLocation(orderId) {
	const key = String(orderId);
	return store.get(key) || null;
}

export function setLocation(orderId, data) {
	const key = String(orderId);
	const payload = {
		lat: typeof data.lat === 'number' ? data.lat : Number(data.lat),
		lng: typeof data.lng === 'number' ? data.lng : Number(data.lng),
		status: data.status || null,
		updatedAt: new Date().toISOString(),
	};
	if (Number.isNaN(payload.lat) || Number.isNaN(payload.lng)) {
		throw new Error('Invalid lat/lng');
	}
	store.set(key, payload);
	return payload;
}

// For demo/testing: seed a fake location if none exists
export function ensureSeed(orderId) {
	const existing = getLocation(orderId);
	if (existing) return existing;
	const base = { lat: 14.5995, lng: 120.9842, status: 'Preparing' }; // Manila default
	return setLocation(orderId, base);
}

export default { getLocation, setLocation, ensureSeed };
