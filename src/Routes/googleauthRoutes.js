// routes/googleauthRoutes.js
import express from "express";
import passport from "passport";

const router = express.Router();

// Login route
router.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

// Callback route
router.get("/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => {
    req.session.user = req.user; 
    res.redirect("/");// redirect to home after login
  }
);

// Logout route
router.get("/logout", (req, res) => {
  req.logout(() => {
    res.redirect("/");
  });
});

export default router;
