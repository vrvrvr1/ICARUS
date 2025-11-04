-- Create addresses table for saved shipping addresses
-- This allows users to save multiple shipping addresses for faster checkout

CREATE TABLE IF NOT EXISTS addresses (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label VARCHAR(100),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  phone VARCHAR(50),
  email VARCHAR(255),
  address_line TEXT NOT NULL,
  city VARCHAR(100) NOT NULL,
  province VARCHAR(100) NOT NULL,
  zipcode VARCHAR(20) NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_addresses_customer_id ON addresses(customer_id);
CREATE INDEX IF NOT EXISTS idx_addresses_is_default ON addresses(customer_id, is_default);

-- Add comment for documentation
COMMENT ON TABLE addresses IS 'Stores saved shipping addresses for customers';
