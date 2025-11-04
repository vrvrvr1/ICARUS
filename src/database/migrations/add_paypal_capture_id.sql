-- Migration: Add paypal_capture_id column to orders table
-- Date: 2025-11-04
-- Purpose: Store PayPal capture ID for refund processing

-- Add paypal_capture_id column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'orders' 
        AND column_name = 'paypal_capture_id'
    ) THEN
        ALTER TABLE orders 
        ADD COLUMN paypal_capture_id VARCHAR(50);
        
        RAISE NOTICE 'Column paypal_capture_id added to orders table';
    ELSE
        RAISE NOTICE 'Column paypal_capture_id already exists';
    END IF;
END $$;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_orders_paypal_capture_id 
ON orders(paypal_capture_id) 
WHERE paypal_capture_id IS NOT NULL;

COMMENT ON COLUMN orders.paypal_capture_id IS 'PayPal capture ID for processing refunds';
