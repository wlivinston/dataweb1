-- Migration: Accounts, Pricing, Subscriptions, Newsletter, Report Requests
-- Target: PostgreSQL / Supabase
-- Date: 2026-02-12

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 1) Customers: account profile + subscription state
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL DEFAULT '',
  last_name VARCHAR(100) NOT NULL DEFAULT '',
  company VARCHAR(255),
  phone VARCHAR(30),
  subscription_status VARCHAR(50) NOT NULL DEFAULT 'free',
  auth_user_id UUID,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS first_name VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_name VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS company VARCHAR(255),
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS phone VARCHAR(30),
  ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS auth_user_id UUID;

-- Bootstrap customers from auth users.
INSERT INTO public.customers (
  id,
  auth_user_id,
  email,
  first_name,
  last_name,
  subscription_status
)
SELECT
  u.id,
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data ->> 'first_name', ''),
  COALESCE(u.raw_user_meta_data ->> 'last_name', ''),
  'free'
FROM auth.users u
WHERE u.email IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.id = u.id OR lower(c.email) = lower(u.email)
  );

-- If profiles exists, bootstrap any remaining profile IDs.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
  ) THEN
    INSERT INTO public.customers (
      id,
      auth_user_id,
      email,
      subscription_status
    )
    SELECT
      p.id::uuid,
      p.id::uuid,
      COALESCE(u.email, 'unknown+' || p.id::text || '@local.invalid'),
      'free'
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = p.id
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_auth_user_id_key'
      AND conrelid = 'public.customers'::regclass
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_auth_user_id_key UNIQUE (auth_user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customers_auth_user_id
  ON public.customers(auth_user_id);

CREATE INDEX IF NOT EXISTS idx_customers_subscription_status
  ON public.customers(subscription_status);

-- Backfill auth_user_id when email matches Supabase auth user.
UPDATE public.customers c
SET auth_user_id = u.id
FROM auth.users u
WHERE c.auth_user_id IS NULL
  AND c.email IS NOT NULL
  AND lower(c.email) = lower(u.email);

-- Align customers.id with auth user id when it is safe to do so.
UPDATE public.customers c
SET id = c.auth_user_id
WHERE c.auth_user_id IS NOT NULL
  AND c.id <> c.auth_user_id
  AND NOT EXISTS (
    SELECT 1
    FROM public.customers c2
    WHERE c2.id = c.auth_user_id
  );

-- Ensure new customer inserts from authenticated users map to auth user id.
CREATE OR REPLACE FUNCTION public.sync_customer_auth_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.auth_user_id IS NULL AND auth.uid() IS NOT NULL THEN
    NEW.auth_user_id := auth.uid();
  END IF;

  IF NEW.id IS NULL AND NEW.auth_user_id IS NOT NULL THEN
    NEW.id := NEW.auth_user_id;
  END IF;

  IF NEW.subscription_status IS NULL OR btrim(NEW.subscription_status) = '' THEN
    NEW.subscription_status := 'free';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customers_sync_auth_identity ON public.customers;
CREATE TRIGGER trg_customers_sync_auth_identity
BEFORE INSERT ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.sync_customer_auth_identity();

-- ---------------------------------------------------------------------------
-- 2) Blog comments: add field already used by backend/frontend
-- ---------------------------------------------------------------------------
ALTER TABLE public.blog_comments
  ADD COLUMN IF NOT EXISTS author_website TEXT;

-- ---------------------------------------------------------------------------
-- 3) Pricing plans (source of truth for pricing)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  code TEXT,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  cta_label TEXT,
  cta_link TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_highlighted BOOLEAN NOT NULL DEFAULT false,
  is_checkout_enabled BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_public BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT subscription_plans_billing_cycle_check
    CHECK (billing_cycle IN ('one_time', 'monthly', 'quarterly', 'yearly', 'forever', 'custom'))
);

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS cta_label TEXT,
  ADD COLUMN IF NOT EXISTS cta_link TEXT,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS is_highlighted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_checkout_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.subscription_plans
SET code = regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')
WHERE code IS NULL OR btrim(code) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_plans_code
  ON public.subscription_plans(code);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_active_price
  ON public.subscription_plans(is_active, price);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_public_sort
  ON public.subscription_plans(is_public, sort_order);

-- Seed plans from current project pricing UI + paywall.
INSERT INTO public.subscription_plans (
  code,
  name,
  description,
  price,
  currency,
  billing_cycle,
  features,
  cta_label,
  cta_link,
  sort_order,
  is_highlighted,
  is_checkout_enabled,
  is_active,
  is_public
) VALUES
  (
    'free',
    'Free',
    'Get started with data exploration and basic analysis.',
    0.00,
    'USD',
    'forever',
    '[
      "Upload CSV, Excel & JSON files",
      "Basic visualizations (bar, line, pie)",
      "AI insights preview",
      "Data cleaning tools",
      "Statistical summaries",
      "Up to 3 datasets"
    ]'::jsonb,
    'Get Started Free',
    '/analyze',
    10,
    false,
    false,
    true,
    true
  ),
  (
    'professional-report',
    'Professional',
    'Full analysis reports with AI-powered insights and professional formatting.',
    29.00,
    'USD',
    'one_time',
    '[
      "Everything in Free",
      "Full PDF report download",
      "Enhanced AI analysis",
      "DAX calculations & formulas",
      "Correlation matrix",
      "Natural language querying",
      "Unlimited datasets",
      "Priority support"
    ]'::jsonb,
    'Get Started',
    '/analyze',
    20,
    true,
    true,
    true,
    true
  ),
  (
    'monthly-unlimited-reports',
    'Monthly Plan',
    'Unlimited PDF reports per month.',
    49.00,
    'USD',
    'monthly',
    '[
      "Unlimited PDF reports",
      "Executive summary",
      "All charts and visualizations",
      "AI insights and recommendations"
    ]'::jsonb,
    'Subscribe for Unlimited Reports',
    '/analyze',
    30,
    false,
    true,
    true,
    true
  ),
  (
    'enterprise-custom',
    'Enterprise',
    'Professional reports written by analysts, tailored to your business.',
    0.00,
    'USD',
    'custom',
    '[
      "Everything in Professional",
      "Custom report written by experts",
      "Dedicated data analyst",
      "Business recommendations",
      "Presentation-ready deliverables",
      "White-label reports",
      "Phone and video support",
      "NDA and data security"
    ]'::jsonb,
    'Request a Report',
    '/request-report',
    40,
    false,
    false,
    false,
    true
  ),
  (
    'expert-written-report',
    'Expert-Written Report',
    'Our analysts write a custom report for you.',
    0.00,
    'USD',
    'custom',
    '[
      "Custom analysis",
      "Professional report writing",
      "Business recommendations"
    ]'::jsonb,
    'Request Expert Report',
    '/request-report',
    50,
    false,
    false,
    false,
    true
  )
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price = EXCLUDED.price,
  currency = EXCLUDED.currency,
  billing_cycle = EXCLUDED.billing_cycle,
  features = EXCLUDED.features,
  cta_label = EXCLUDED.cta_label,
  cta_link = EXCLUDED.cta_link,
  sort_order = EXCLUDED.sort_order,
  is_highlighted = EXCLUDED.is_highlighted,
  is_checkout_enabled = EXCLUDED.is_checkout_enabled,
  is_active = EXCLUDED.is_active,
  is_public = EXCLUDED.is_public,
  updated_at = NOW();

-- ---------------------------------------------------------------------------
-- 4) Customer subscriptions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL,
  plan_id INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_date TIMESTAMPTZ,
  auto_renew BOOLEAN NOT NULL DEFAULT true,
  payment_method VARCHAR(100),
  provider_customer_id VARCHAR(255),
  provider_subscription_id VARCHAR(255),
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_subscriptions_status_check
    CHECK (status IN ('pending', 'active', 'cancelled', 'expired'))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customer_subscriptions_customer_id_fkey'
      AND conrelid = 'public.customer_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.customer_subscriptions
      ADD CONSTRAINT customer_subscriptions_customer_id_fkey
      FOREIGN KEY (customer_id)
      REFERENCES public.customers(id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customer_subscriptions_plan_id_fkey'
      AND conrelid = 'public.customer_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.customer_subscriptions
      ADD CONSTRAINT customer_subscriptions_plan_id_fkey
      FOREIGN KEY (plan_id)
      REFERENCES public.subscription_plans(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customer_subscriptions_customer_created
  ON public.customer_subscriptions(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_subscriptions_status
  ON public.customer_subscriptions(status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_subscriptions_one_open
  ON public.customer_subscriptions(customer_id)
  WHERE status IN ('pending', 'active');

-- ---------------------------------------------------------------------------
-- 5) Subscription payments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  payment_method VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  provider_payment_id VARCHAR(255),
  provider_invoice_id VARCHAR(255),
  payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT subscription_payments_status_check
    CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'voided'))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'subscription_payments_subscription_id_fkey'
      AND conrelid = 'public.subscription_payments'::regclass
  ) THEN
    ALTER TABLE public.subscription_payments
      ADD CONSTRAINT subscription_payments_subscription_id_fkey
      FOREIGN KEY (subscription_id)
      REFERENCES public.customer_subscriptions(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_subscription_payments_subscription_date
  ON public.subscription_payments(subscription_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_payments_status
  ON public.subscription_payments(status);

-- ---------------------------------------------------------------------------
-- 6) Newsletter tracking improvements
-- ---------------------------------------------------------------------------
ALTER TABLE public.newsletter_subscribers
  ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_ip INET,
  ADD COLUMN IF NOT EXISTS consent_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.newsletter_subscribers
SET consent_at = subscribed_at
WHERE consent_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_subscribers_email_lower
  ON public.newsletter_subscribers(lower(email));

-- ---------------------------------------------------------------------------
-- 7) Report requests (used by /api/reports/request)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.report_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID,
  customer_name VARCHAR(200) NOT NULL,
  customer_email VARCHAR(255) NOT NULL,
  company VARCHAR(255),
  report_type VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  timeline VARCHAR(100),
  budget_range VARCHAR(100),
  source VARCHAR(100) NOT NULL DEFAULT 'website',
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  assigned_to VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_requests_status_check
    CHECK (status IN ('pending', 'in_review', 'quoted', 'approved', 'in_progress', 'delivered', 'cancelled'))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'report_requests_customer_id_fkey'
      AND conrelid = 'public.report_requests'::regclass
  ) THEN
    ALTER TABLE public.report_requests
      ADD CONSTRAINT report_requests_customer_id_fkey
      FOREIGN KEY (customer_id)
      REFERENCES public.customers(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_report_requests_status_created
  ON public.report_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_requests_customer_email
  ON public.report_requests(lower(customer_email));

-- ---------------------------------------------------------------------------
-- 8) updated_at triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customers_set_updated_at ON public.customers;
CREATE TRIGGER trg_customers_set_updated_at
BEFORE UPDATE ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_subscription_plans_set_updated_at ON public.subscription_plans;
CREATE TRIGGER trg_subscription_plans_set_updated_at
BEFORE UPDATE ON public.subscription_plans
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_customer_subscriptions_set_updated_at ON public.customer_subscriptions;
CREATE TRIGGER trg_customer_subscriptions_set_updated_at
BEFORE UPDATE ON public.customer_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_subscription_payments_set_updated_at ON public.subscription_payments;
CREATE TRIGGER trg_subscription_payments_set_updated_at
BEFORE UPDATE ON public.subscription_payments
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_newsletter_subscribers_set_updated_at ON public.newsletter_subscribers;
CREATE TRIGGER trg_newsletter_subscribers_set_updated_at
BEFORE UPDATE ON public.newsletter_subscribers
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_report_requests_set_updated_at ON public.report_requests;
CREATE TRIGGER trg_report_requests_set_updated_at
BEFORE UPDATE ON public.report_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 9) RLS for new tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customers'
      AND policyname = 'Users can read own customer profile'
  ) THEN
    CREATE POLICY "Users can read own customer profile"
      ON public.customers
      FOR SELECT
      USING (
        id = auth.uid()
        OR auth_user_id = auth.uid()
        OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customers'
      AND policyname = 'Users can insert own customer profile'
  ) THEN
    CREATE POLICY "Users can insert own customer profile"
      ON public.customers
      FOR INSERT
      WITH CHECK (
        id = auth.uid()
        OR auth_user_id = auth.uid()
        OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customers'
      AND policyname = 'Users can update own customer profile'
  ) THEN
    CREATE POLICY "Users can update own customer profile"
      ON public.customers
      FOR UPDATE
      USING (
        id = auth.uid()
        OR auth_user_id = auth.uid()
        OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
      )
      WITH CHECK (
        id = auth.uid()
        OR auth_user_id = auth.uid()
        OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'subscription_plans'
      AND policyname = 'Public can read pricing plans'
  ) THEN
    CREATE POLICY "Public can read pricing plans"
      ON public.subscription_plans
      FOR SELECT
      USING (is_public = true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customer_subscriptions'
      AND policyname = 'Users can read own subscriptions'
  ) THEN
    CREATE POLICY "Users can read own subscriptions"
      ON public.customer_subscriptions
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.customers c
          WHERE c.id = customer_subscriptions.customer_id
            AND (c.id = auth.uid() OR c.auth_user_id = auth.uid())
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'subscription_payments'
      AND policyname = 'Users can read own subscription payments'
  ) THEN
    CREATE POLICY "Users can read own subscription payments"
      ON public.subscription_payments
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.customer_subscriptions cs
          JOIN public.customers c ON c.id = cs.customer_id
          WHERE cs.id = subscription_payments.subscription_id
            AND (c.id = auth.uid() OR c.auth_user_id = auth.uid())
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'report_requests'
      AND policyname = 'Public can create report requests'
  ) THEN
    CREATE POLICY "Public can create report requests"
      ON public.report_requests
      FOR INSERT
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'report_requests'
      AND policyname = 'Users can read own report requests'
  ) THEN
    CREATE POLICY "Users can read own report requests"
      ON public.report_requests
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.customers c
          WHERE c.id = report_requests.customer_id
            AND (c.id = auth.uid() OR c.auth_user_id = auth.uid())
        )
        OR lower(report_requests.customer_email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
      );
  END IF;
END $$;

COMMIT;
