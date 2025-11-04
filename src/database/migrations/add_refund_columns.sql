-- Migration: Add refund tracking columns to orders table
-- Description: Add columns for customer refund requests and admin processing

-- Add refund_status column to track the state of refund requests
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_status VARCHAR(20);
COMMENT ON COLUMN orders.refund_status IS 'Status of refund: null (no refund), requested, processed';

-- Add refund_requested_at timestamp to track when customer requested refund
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_requested_at TIMESTAMP WITH TIME ZONE;
COMMENT ON COLUMN orders.refund_requested_at IS 'Timestamp when customer requested refund';

-- Add refund_reason to store customer's reason for refund
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_reason TEXT;
COMMENT ON COLUMN orders.refund_reason IS 'Customer-provided reason for refund request';

-- Add refund_amount to store the amount to be refunded
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_amount DECIMAL(10,2);
COMMENT ON COLUMN orders.refund_amount IS 'Amount to be refunded to customer';

-- Add refund_processed_at timestamp to track when admin processed the refund
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_processed_at TIMESTAMP WITH TIME ZONE;
COMMENT ON COLUMN orders.refund_processed_at IS 'Timestamp when admin processed the refund';

-- Add refund_notes for admin notes about manual refunds (e.g., COD)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_notes TEXT;
COMMENT ON COLUMN orders.refund_notes IS 'Admin notes about refund processing (e.g., bank transfer details for COD)';

-- Create index for faster queries on refund_status
CREATE INDEX IF NOT EXISTS idx_orders_refund_status ON orders(refund_status);

-- Create index for refund_requested_at for sorting/filtering
CREATE INDEX IF NOT EXISTS idx_orders_refund_requested_at ON orders(refund_requested_at);

SELECT 'Refund columns migration completed successfully!' AS result;
