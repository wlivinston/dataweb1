-- Migration: Add signup profile fields to customers
-- Target: PostgreSQL / Supabase
-- Date: 2026-02-16

BEGIN;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS age INTEGER,
  ADD COLUMN IF NOT EXISTS registration_country VARCHAR(120);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_age_range_check'
      AND conrelid = 'public.customers'::regclass
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_age_range_check
      CHECK (age IS NULL OR age BETWEEN 13 AND 120);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customers_registration_country
  ON public.customers(registration_country);

-- Backfill from Supabase auth metadata where missing.
WITH auth_profiles AS (
  SELECT
    u.id AS auth_user_id,
    lower(u.email) AS email_lower,
    CASE
      WHEN NULLIF(regexp_replace(COALESCE(u.raw_user_meta_data ->> 'age', ''), '[^0-9]', '', 'g'), '') IS NULL THEN NULL
      ELSE NULLIF(regexp_replace(COALESCE(u.raw_user_meta_data ->> 'age', ''), '[^0-9]', '', 'g'), '')::INTEGER
    END AS parsed_age,
    NULLIF(btrim(COALESCE(u.raw_user_meta_data ->> 'registration_country', '')), '') AS registration_country
  FROM auth.users u
)
UPDATE public.customers c
SET
  age = CASE
    WHEN c.age IS NOT NULL THEN c.age
    WHEN ap.parsed_age BETWEEN 13 AND 120 THEN ap.parsed_age
    ELSE NULL
  END,
  registration_country = COALESCE(NULLIF(btrim(c.registration_country), ''), ap.registration_country)
FROM auth_profiles ap
WHERE
  (c.auth_user_id = ap.auth_user_id OR (c.email IS NOT NULL AND lower(c.email) = ap.email_lower))
  AND (
    c.age IS NULL
    OR c.registration_country IS NULL
    OR btrim(c.registration_country) = ''
  );

COMMIT;
