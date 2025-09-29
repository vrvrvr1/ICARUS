import db from "../database/db.js";

export const cartCountMiddleware = async (req, res, next) => {
  if (req.session.user) {
    try {
      const result = await db.query(
        "SELECT SUM(quantity) AS total FROM cart WHERE customer_id = $1",
        [req.session.user.id]
      );
      res.locals.cartItemCount = result.rows[0].total || 0;
    } catch (err) {
      console.error(err);
      res.locals.cartItemCount = 0;
    }
  } else {
    res.locals.cartItemCount = 0;
  }
  next();
};
