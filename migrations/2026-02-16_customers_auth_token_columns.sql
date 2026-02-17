-- Migration: Ensure legacy auth token columns exist on customers
-- Target: PostgreSQL / Supabase
-- Date: 2026-02-16

BEGIN;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255),
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_token VARCHAR(255),
  ADD COLUMN IF NOT EXISTS verification_expires TIMESTAMP,
  ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255),
  ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_customers_verification_token
  ON public.customers(verification_token);

CREATE INDEX IF NOT EXISTS idx_customers_reset_token
  ON public.customers(reset_token);

COMMIT;
