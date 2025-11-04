-- Add color and size columns to wishlist table
-- This allows users to save specific product variants to their wishlist

-- Add columns if they don't exist
ALTER TABLE wishlist 
ADD COLUMN IF NOT EXISTS color VARCHAR(50),
ADD COLUMN IF NOT EXISTS size VARCHAR(10);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_wishlist_user_product_variant 
ON wishlist(user_id, product_id, color, size);
