-- Add out_of_stock and item_sold flags to products table
-- These flags allow admins to mark products as out of stock or sold

ALTER TABLE products 
ADD COLUMN IF NOT EXISTS out_of_stock BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS item_sold BOOLEAN DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN products.out_of_stock IS 'Indicates if the product is currently out of stock';
COMMENT ON COLUMN products.item_sold IS 'Indicates if the item has been sold (e.g., for unique/limited items)';
