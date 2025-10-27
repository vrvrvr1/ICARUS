import express from "express";
import { sendOtp, verifyOtp, resendOtp } from "../controllers/authControllers.js";

const router = express.Router();

router.post("/register", sendOtp);
router.post("/verify", verifyOtp);
router.get("/resend-otp", resendOtp);

// Allow visiting the verify page via GET (useful for direct access or testing).
router.get('/verify', (req, res) => {
	// prefer query param, fall back to session or empty
	const email = (req.query && req.query.email) ? String(req.query.email) : (req.session && req.session.email ? req.session.email : '');
	res.render('customer/verify', { email });
});

export default router;
