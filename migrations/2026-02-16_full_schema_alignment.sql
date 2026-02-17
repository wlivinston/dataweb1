-- Migration: Full schema alignment for auth, blog/comments, subscriptions, newsletter, reports
-- Target: PostgreSQL / Supabase
-- Date: 2026-02-16

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 1) Customers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL DEFAULT '',
  last_name VARCHAR(100) NOT NULL DEFAULT '',
  company VARCHAR(255),
  password_hash VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT true,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  verification_token VARCHAR(255),
  verification_expires TIMESTAMPTZ,
  reset_token VARCHAR(255),
  reset_expires TIMESTAMPTZ,
  last_login TIMESTAMPTZ,
  phone VARCHAR(30),
  age INTEGER,
  registration_country VARCHAR(120),
  subscription_status VARCHAR(50) NOT NULL DEFAULT 'free',
  auth_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS first_name VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_name VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS company VARCHAR(255),
  ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255),
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_token VARCHAR(255),
  ADD COLUMN IF NOT EXISTS verification_expires TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255),
  ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone VARCHAR(30),
  ADD COLUMN IF NOT EXISTS age INTEGER,
  ADD COLUMN IF NOT EXISTS registration_country VARCHAR(120),
  ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS auth_user_id UUID,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

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

CREATE INDEX IF NOT EXISTS idx_customers_email_lower
  ON public.customers(lower(email));

CREATE INDEX IF NOT EXISTS idx_customers_auth_user_id
  ON public.customers(auth_user_id);

CREATE INDEX IF NOT EXISTS idx_customers_subscription_status
  ON public.customers(subscription_status);

CREATE INDEX IF NOT EXISTS idx_customers_verification_token
  ON public.customers(verification_token);

CREATE INDEX IF NOT EXISTS idx_customers_reset_token
  ON public.customers(reset_token);

CREATE INDEX IF NOT EXISTS idx_customers_registration_country
  ON public.customers(registration_country);

-- Backfill auth linkage from Supabase auth users.
UPDATE public.customers c
SET auth_user_id = u.id
FROM auth.users u
WHERE c.auth_user_id IS NULL
  AND c.email IS NOT NULL
  AND lower(c.email) = lower(u.email);

-- Align customers.id with auth uid when safe.
UPDATE public.customers c
SET id = c.auth_user_id
WHERE c.auth_user_id IS NOT NULL
  AND c.id <> c.auth_user_id
  AND NOT EXISTS (
    SELECT 1
    FROM public.customers c2
    WHERE c2.id = c.auth_user_id
  );

-- Backfill age / registration_country from auth metadata.
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
-- 2) Blog posts, comments, likes, page views
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  excerpt TEXT,
  content TEXT NOT NULL DEFAULT '',
  author VARCHAR(100) NOT NULL DEFAULT 'DataWeb Team',
  category VARCHAR(100) NOT NULL DEFAULT 'General',
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  featured BOOLEAN NOT NULL DEFAULT false,
  published BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  read_time INTEGER NOT NULL DEFAULT 5,
  view_count INTEGER NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.blog_posts
  ADD COLUMN IF NOT EXISTS slug VARCHAR(255),
  ADD COLUMN IF NOT EXISTS title VARCHAR(255),
  ADD COLUMN IF NOT EXISTS excerpt TEXT,
  ADD COLUMN IF NOT EXISTS content TEXT,
  ADD COLUMN IF NOT EXISTS author VARCHAR(100),
  ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS read_time INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comment_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'blog_posts'
      AND column_name = 'read_time'
      AND data_type IN ('character varying', 'text')
  ) THEN
    ALTER TABLE public.blog_posts
      ALTER COLUMN read_time TYPE INTEGER
      USING COALESCE(NULLIF(regexp_replace(read_time::text, '[^0-9]', '', 'g'), ''), '5')::INTEGER;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_blog_posts_slug
  ON public.blog_posts(slug);

CREATE INDEX IF NOT EXISTS idx_blog_posts_published
  ON public.blog_posts(published);

CREATE INDEX IF NOT EXISTS idx_blog_posts_category
  ON public.blog_posts(category);

CREATE INDEX IF NOT EXISTS idx_blog_posts_featured
  ON public.blog_posts(featured);

CREATE INDEX IF NOT EXISTS idx_blog_posts_published_at
  ON public.blog_posts(published_at DESC);

CREATE TABLE IF NOT EXISTS public.blog_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL,
  parent_id UUID,
  author_name VARCHAR(100) NOT NULL,
  author_email VARCHAR(255) NOT NULL,
  author_website TEXT,
  content TEXT NOT NULL,
  ip_address INET,
  user_agent TEXT,
  is_approved BOOLEAN NOT NULL DEFAULT false,
  is_spam BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.blog_comments
  ADD COLUMN IF NOT EXISTS post_id UUID,
  ADD COLUMN IF NOT EXISTS parent_id UUID,
  ADD COLUMN IF NOT EXISTS author_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS author_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS author_website TEXT,
  ADD COLUMN IF NOT EXISTS content TEXT,
  ADD COLUMN IF NOT EXISTS ip_address INET,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_spam BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'blog_comments_post_id_fkey'
      AND conrelid = 'public.blog_comments'::regclass
  ) THEN
    ALTER TABLE public.blog_comments
      ADD CONSTRAINT blog_comments_post_id_fkey
      FOREIGN KEY (post_id)
      REFERENCES public.blog_posts(id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'blog_comments_parent_id_fkey'
      AND conrelid = 'public.blog_comments'::regclass
  ) THEN
    ALTER TABLE public.blog_comments
      ADD CONSTRAINT blog_comments_parent_id_fkey
      FOREIGN KEY (parent_id)
      REFERENCES public.blog_comments(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_blog_comments_post_id
  ON public.blog_comments(post_id);

CREATE INDEX IF NOT EXISTS idx_blog_comments_parent_id
  ON public.blog_comments(parent_id);

CREATE INDEX IF NOT EXISTS idx_blog_comments_approved
  ON public.blog_comments(is_approved);

CREATE INDEX IF NOT EXISTS idx_blog_comments_post_created
  ON public.blog_comments(post_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.comment_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL,
  ip_address INET NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.comment_likes
  ADD COLUMN IF NOT EXISTS comment_id UUID,
  ADD COLUMN IF NOT EXISTS ip_address INET,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'comment_likes_comment_id_fkey'
      AND conrelid = 'public.comment_likes'::regclass
  ) THEN
    ALTER TABLE public.comment_likes
      ADD CONSTRAINT comment_likes_comment_id_fkey
      FOREIGN KEY (comment_id)
      REFERENCES public.blog_comments(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_comment_likes_unique
  ON public.comment_likes(comment_id, ip_address);

CREATE INDEX IF NOT EXISTS idx_comment_likes_comment_id
  ON public.comment_likes(comment_id);

CREATE TABLE IF NOT EXISTS public.post_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL,
  ip_address INET NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.post_likes
  ADD COLUMN IF NOT EXISTS post_id UUID,
  ADD COLUMN IF NOT EXISTS ip_address INET,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'post_likes_post_id_fkey'
      AND conrelid = 'public.post_likes'::regclass
  ) THEN
    ALTER TABLE public.post_likes
      ADD CONSTRAINT post_likes_post_id_fkey
      FOREIGN KEY (post_id)
      REFERENCES public.blog_posts(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_post_likes_unique
  ON public.post_likes(post_id, ip_address);

CREATE INDEX IF NOT EXISTS idx_post_likes_post_id
  ON public.post_likes(post_id);

CREATE TABLE IF NOT EXISTS public.page_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_url VARCHAR(500) NOT NULL,
  ip_address INET,
  user_agent TEXT,
  referrer VARCHAR(500),
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.page_views
  ADD COLUMN IF NOT EXISTS page_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS ip_address INET,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS referrer VARCHAR(500),
  ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_page_views_page_url
  ON public.page_views(page_url);

CREATE INDEX IF NOT EXISTS idx_page_views_viewed_at
  ON public.page_views(viewed_at DESC);

-- Keep comment_count in sync with existing data.
UPDATE public.blog_posts p
SET comment_count = stats.total_comments
FROM (
  SELECT post_id, COUNT(*)::INTEGER AS total_comments
  FROM public.blog_comments
  WHERE is_approved = true AND COALESCE(is_spam, false) = false
  GROUP BY post_id
) stats
WHERE stats.post_id = p.id;

-- ---------------------------------------------------------------------------
-- 3) Newsletter
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  source VARCHAR(100) DEFAULT 'website',
  is_active BOOLEAN NOT NULL DEFAULT true,
  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unsubscribed_at TIMESTAMPTZ,
  consent_at TIMESTAMPTZ,
  consent_ip INET,
  consent_user_agent TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.newsletter_subscribers
  ADD COLUMN IF NOT EXISTS email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS first_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS last_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS source VARCHAR(100) DEFAULT 'website',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_ip INET,
  ADD COLUMN IF NOT EXISTS consent_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.newsletter_subscribers
SET consent_at = subscribed_at
WHERE consent_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_subscribers_email_lower
  ON public.newsletter_subscribers(lower(email));

CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_active
  ON public.newsletter_subscribers(is_active);

-- ---------------------------------------------------------------------------
-- 4) Subscription plans, customer subscriptions, payments
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
-- 5) Report requests
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
-- 6) updated_at trigger utility
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

DROP TRIGGER IF EXISTS trg_blog_posts_set_updated_at ON public.blog_posts;
CREATE TRIGGER trg_blog_posts_set_updated_at
BEFORE UPDATE ON public.blog_posts
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_blog_comments_set_updated_at ON public.blog_comments;
CREATE TRIGGER trg_blog_comments_set_updated_at
BEFORE UPDATE ON public.blog_comments
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_newsletter_subscribers_set_updated_at ON public.newsletter_subscribers;
CREATE TRIGGER trg_newsletter_subscribers_set_updated_at
BEFORE UPDATE ON public.newsletter_subscribers
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

DROP TRIGGER IF EXISTS trg_report_requests_set_updated_at ON public.report_requests;
CREATE TRIGGER trg_report_requests_set_updated_at
BEFORE UPDATE ON public.report_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 7) RLS and policies
-- ---------------------------------------------------------------------------
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_requests ENABLE ROW LEVEL SECURITY;

-- Remove legacy policy names so migration can be rerun safely.
DROP POLICY IF EXISTS "Allow public read access to published blog posts" ON public.blog_posts;
DROP POLICY IF EXISTS "Allow public read access to approved comments" ON public.blog_comments;
DROP POLICY IF EXISTS "Allow users to manage their own customer data" ON public.customers;
DROP POLICY IF EXISTS "Allow public newsletter subscription" ON public.newsletter_subscribers;
DROP POLICY IF EXISTS "Allow public page view tracking" ON public.page_views;
DROP POLICY IF EXISTS "Allow public to insert comments" ON public.blog_comments;
DROP POLICY IF EXISTS "Allow public to like posts" ON public.post_likes;
DROP POLICY IF EXISTS "Allow public to like comments" ON public.comment_likes;
DROP POLICY IF EXISTS "Allow public to read post likes" ON public.post_likes;
DROP POLICY IF EXISTS "Allow public to read comment likes" ON public.comment_likes;
DROP POLICY IF EXISTS "Allow public to read page views" ON public.page_views;
DROP POLICY IF EXISTS "Allow public to read newsletter subscribers" ON public.newsletter_subscribers;
DROP POLICY IF EXISTS "Allow public to update newsletter subscription" ON public.newsletter_subscribers;
DROP POLICY IF EXISTS "Allow public to register customers" ON public.customers;
DROP POLICY IF EXISTS "Allow public to read customer data for auth" ON public.customers;
DROP POLICY IF EXISTS "Allow public to update customer data" ON public.customers;
DROP POLICY IF EXISTS "Users can insert own customer profile" ON public.customers;
DROP POLICY IF EXISTS "Users can read own customer profile" ON public.customers;
DROP POLICY IF EXISTS "Users can update own customer profile" ON public.customers;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'blog_posts'
      AND policyname = 'Public can read published blog posts'
  ) THEN
    CREATE POLICY "Public can read published blog posts"
      ON public.blog_posts
      FOR SELECT
      USING (published = true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'blog_comments'
      AND policyname = 'Public can read approved comments'
  ) THEN
    CREATE POLICY "Public can read approved comments"
      ON public.blog_comments
      FOR SELECT
      USING (is_approved = true AND COALESCE(is_spam, false) = false);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'blog_comments'
      AND policyname = 'Users can insert own comments'
  ) THEN
    CREATE POLICY "Users can insert own comments"
      ON public.blog_comments
      FOR INSERT
      WITH CHECK (
        auth.role() = 'authenticated'
        AND lower(author_email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
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
      AND policyname = 'Users can read own customer row'
  ) THEN
    CREATE POLICY "Users can read own customer row"
      ON public.customers
      FOR SELECT
      USING (
        auth.role() = 'authenticated'
        AND (
          id = auth.uid()
          OR auth_user_id = auth.uid()
          OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
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
      AND tablename = 'customers'
      AND policyname = 'Users can insert own customer row'
  ) THEN
    CREATE POLICY "Users can insert own customer row"
      ON public.customers
      FOR INSERT
      WITH CHECK (
        auth.role() = 'authenticated'
        AND (
          id = auth.uid()
          OR auth_user_id = auth.uid()
          OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
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
      AND tablename = 'customers'
      AND policyname = 'Users can update own customer row'
  ) THEN
    CREATE POLICY "Users can update own customer row"
      ON public.customers
      FOR UPDATE
      USING (
        auth.role() = 'authenticated'
        AND (
          id = auth.uid()
          OR auth_user_id = auth.uid()
          OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
        )
      )
      WITH CHECK (
        auth.role() = 'authenticated'
        AND (
          id = auth.uid()
          OR auth_user_id = auth.uid()
          OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
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
      AND tablename = 'newsletter_subscribers'
      AND policyname = 'Users can insert own newsletter subscription'
  ) THEN
    CREATE POLICY "Users can insert own newsletter subscription"
      ON public.newsletter_subscribers
      FOR INSERT
      WITH CHECK (
        auth.role() = 'authenticated'
        AND lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'newsletter_subscribers'
      AND policyname = 'Users can read own newsletter subscription'
  ) THEN
    CREATE POLICY "Users can read own newsletter subscription"
      ON public.newsletter_subscribers
      FOR SELECT
      USING (
        auth.role() = 'authenticated'
        AND lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'newsletter_subscribers'
      AND policyname = 'Users can update own newsletter subscription'
  ) THEN
    CREATE POLICY "Users can update own newsletter subscription"
      ON public.newsletter_subscribers
      FOR UPDATE
      USING (
        auth.role() = 'authenticated'
        AND lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
      )
      WITH CHECK (
        auth.role() = 'authenticated'
        AND lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'page_views'
      AND policyname = 'Public can insert page views'
  ) THEN
    CREATE POLICY "Public can insert page views"
      ON public.page_views
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
      AND tablename = 'post_likes'
      AND policyname = 'Public can read post likes'
  ) THEN
    CREATE POLICY "Public can read post likes"
      ON public.post_likes
      FOR SELECT
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'post_likes'
      AND policyname = 'Public can insert post likes'
  ) THEN
    CREATE POLICY "Public can insert post likes"
      ON public.post_likes
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
      AND tablename = 'comment_likes'
      AND policyname = 'Public can read comment likes'
  ) THEN
    CREATE POLICY "Public can read comment likes"
      ON public.comment_likes
      FOR SELECT
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'comment_likes'
      AND policyname = 'Public can insert comment likes'
  ) THEN
    CREATE POLICY "Public can insert comment likes"
      ON public.comment_likes
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
