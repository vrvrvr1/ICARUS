import express from "express";
import { login, register } from "../controllers/loginControllers.js";

const router = express.Router();

// Render login page
router.get("/login", (req, res) => {
  res.render("customer/login"); // views/customer/login.ejs
});

// Render signup page
router.get("/signup", (req, res) => {
  res.render("customer/signup"); // views/customer/signup.ejs
});

// Handle login POST
router.post("/login", login);

// Handle signup POST
router.post("/signup", register);

export default router;
