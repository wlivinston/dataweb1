-- ============================================================
-- Tighten RLS policies for production security
-- Date: 2026-03-28
-- Purpose: Restrict public (anon) access to sensitive tables.
--          Backend uses service_role key which bypasses RLS,
--          so these policies only constrain the frontend anon key.
-- ============================================================

-- --------------------------------
-- CUSTOMERS: restrict public access
-- --------------------------------
-- Drop overly permissive policies
DROP POLICY IF EXISTS "Allow public to read customer data for auth" ON customers;
DROP POLICY IF EXISTS "Allow public to update customer data" ON customers;
DROP POLICY IF EXISTS "Allow public to register customers" ON customers;

-- Authenticated users can only read/update their OWN row
CREATE POLICY "customers_select_own" ON customers
    FOR SELECT USING (
        auth.uid() IS NOT NULL
        AND (
            auth.uid()::text = auth_user_id::text
            OR auth.uid()::text = id::text
            OR (auth.jwt() ->> 'email') = email
        )
    );

CREATE POLICY "customers_update_own" ON customers
    FOR UPDATE USING (
        auth.uid() IS NOT NULL
        AND (
            auth.uid()::text = auth_user_id::text
            OR auth.uid()::text = id::text
            OR (auth.jwt() ->> 'email') = email
        )
    );

-- Insert: authenticated users can create their own customer record
CREATE POLICY "customers_insert_own" ON customers
    FOR INSERT WITH CHECK (
        auth.uid() IS NOT NULL
    );

-- Drop the old catch-all policy
DROP POLICY IF EXISTS "Allow users to manage their own customer data" ON customers;


-- --------------------------------
-- NEWSLETTER_SUBSCRIBERS: restrict reads
-- --------------------------------
DROP POLICY IF EXISTS "Allow public to read newsletter subscribers" ON newsletter_subscribers;
DROP POLICY IF EXISTS "Allow public to update newsletter subscription" ON newsletter_subscribers;

-- Public can still subscribe (insert) but cannot read the full list
-- Keep insert policy as-is (public can subscribe)

-- Only allow reading your own subscription by email match
CREATE POLICY "newsletter_select_own" ON newsletter_subscribers
    FOR SELECT USING (
        auth.uid() IS NOT NULL
        AND (auth.jwt() ->> 'email') = email
    );

-- Only allow updating your own subscription
CREATE POLICY "newsletter_update_own" ON newsletter_subscribers
    FOR UPDATE USING (
        auth.uid() IS NOT NULL
        AND (auth.jwt() ->> 'email') = email
    );


-- --------------------------------
-- PAGE_VIEWS: restrict reads (write-only for public)
-- --------------------------------
DROP POLICY IF EXISTS "Allow public to read page views" ON page_views;

-- Only service_role (backend) can read page_views
-- Public/anon can still insert (for tracking)


-- --------------------------------
-- Verification
-- --------------------------------
SELECT 'RLS policies tightened successfully.' AS status;
