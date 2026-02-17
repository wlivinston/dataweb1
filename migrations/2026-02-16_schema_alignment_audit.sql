-- Schema audit for DataWeb/Supabase alignment
-- Run before and after the full alignment migration.

-- 1) Missing tables
WITH expected_tables(table_name) AS (
  VALUES
    ('customers'),
    ('blog_posts'),
    ('blog_comments'),
    ('comment_likes'),
    ('post_likes'),
    ('page_views'),
    ('newsletter_subscribers'),
    ('subscription_plans'),
    ('customer_subscriptions'),
    ('subscription_payments'),
    ('report_requests')
)
SELECT et.table_name AS missing_table
FROM expected_tables et
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public'
 AND t.table_name = et.table_name
WHERE t.table_name IS NULL
ORDER BY et.table_name;

-- 2) Missing columns
WITH expected_columns(table_name, column_name) AS (
  VALUES
    ('customers','id'),
    ('customers','email'),
    ('customers','first_name'),
    ('customers','last_name'),
    ('customers','password_hash'),
    ('customers','email_verified'),
    ('customers','verification_token'),
    ('customers','verification_expires'),
    ('customers','reset_token'),
    ('customers','reset_expires'),
    ('customers','subscription_status'),
    ('customers','auth_user_id'),
    ('customers','age'),
    ('customers','registration_country'),
    ('blog_posts','id'),
    ('blog_posts','slug'),
    ('blog_posts','published'),
    ('blog_posts','read_time'),
    ('blog_posts','like_count'),
    ('blog_posts','comment_count'),
    ('blog_comments','id'),
    ('blog_comments','post_id'),
    ('blog_comments','parent_id'),
    ('blog_comments','author_website'),
    ('blog_comments','is_approved'),
    ('blog_comments','is_spam'),
    ('comment_likes','comment_id'),
    ('comment_likes','ip_address'),
    ('post_likes','post_id'),
    ('post_likes','ip_address'),
    ('page_views','page_url'),
    ('page_views','viewed_at'),
    ('newsletter_subscribers','consent_at'),
    ('newsletter_subscribers','consent_ip'),
    ('newsletter_subscribers','consent_user_agent'),
    ('subscription_plans','is_public'),
    ('customer_subscriptions','status'),
    ('subscription_payments','status'),
    ('report_requests','status')
)
SELECT ec.table_name, ec.column_name
FROM expected_columns ec
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = ec.table_name
 AND c.column_name = ec.column_name
WHERE c.column_name IS NULL
ORDER BY ec.table_name, ec.column_name;

-- 3) High-signal policy check
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'customers',
    'blog_posts',
    'blog_comments',
    'newsletter_subscribers',
    'subscription_plans',
    'customer_subscriptions',
    'subscription_payments',
    'report_requests'
  )
ORDER BY tablename, policyname;
