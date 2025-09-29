import express from "express";
import { sendOtp, verifyOtp, resendOtp } from "../controllers/authControllers.js";

const router = express.Router();

router.post("/register", sendOtp);
router.post("/verify", verifyOtp);
router.get("/resend-otp", resendOtp);

export default router;
