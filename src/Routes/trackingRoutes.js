import express from "express";
import db from "../database/db.js";
import { getLocation, setLocation, ensureSeed } from "../utils/trackingStore.js";

const router = express.Router();

function isAuthenticated(req, res, next) {
	if (!req.session || !req.session.user) return res.status(401).json({ error: "Unauthorized" });
	next();
}

// Verify the order belongs to the logged-in customer, returns order row
async function loadOrderIfOwner(orderId, customerId) {
	const orderRes = await db.query(
		`SELECT id, customer_id FROM orders WHERE id=$1 AND customer_id=$2`,
		[orderId, customerId]
	);
	return orderRes.rows[0] || null;
}

// GET /tracking/:orderId -> current location JSON
router.get("/tracking/:orderId", isAuthenticated, async (req, res) => {
	try {
		const { orderId } = req.params;
		const customerId = req.session.user.id;
		const order = await loadOrderIfOwner(orderId, customerId);
		if (!order) return res.status(404).json({ error: "Order not found" });

		// Get or seed location
		const loc = ensureSeed(orderId);
		return res.json(loc);
	} catch (err) {
		console.error("Tracking GET error:", err);
		return res.status(500).json({ error: "Server error" });
	}
});

// PATCH /tracking/:orderId -> update location (admin/courier or owner for demo)
router.patch("/tracking/:orderId", isAuthenticated, async (req, res) => {
	try {
		const { orderId } = req.params;
		const customerId = req.session.user.id;

		// In production, validate courier/admin role.
		// For now, allow if order belongs to user.
		const order = await loadOrderIfOwner(orderId, customerId);
		if (!order) return res.status(403).json({ error: "Forbidden" });

		const { lat, lng, status } = req.body || {};
		const updated = setLocation(orderId, { lat, lng, status });
		return res.json(updated);
	} catch (err) {
		console.error("Tracking PATCH error:", err);
		return res.status(400).json({ error: err.message || "Invalid request" });
	}
});

export default router;
