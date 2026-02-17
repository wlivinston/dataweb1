-- DataWeb Database Schema for Supabase (Free Blog)
-- This script creates all the tables needed for a free blog backend

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. CUSTOMERS TABLE (for user authentication and profiles)
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    company VARCHAR(255),
    password_hash VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,
    verification_token VARCHAR(255),
    verification_expires TIMESTAMP,
    reset_token VARCHAR(255),
    reset_expires TIMESTAMP,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Reconcile existing customers table when it was created earlier without auth columns.
ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255),
    ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS verification_token VARCHAR(255),
    ADD COLUMN IF NOT EXISTS verification_expires TIMESTAMP,
    ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255),
    ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMP;

-- 2. BLOG_POSTS TABLE (for blog content)
CREATE TABLE IF NOT EXISTS blog_posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(255) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    excerpt TEXT,
    content TEXT NOT NULL,
    author VARCHAR(100) NOT NULL,
    category VARCHAR(100) DEFAULT 'General',
    tags TEXT[] DEFAULT '{}',
    featured BOOLEAN DEFAULT false,
    published BOOLEAN DEFAULT false,
    published_at TIMESTAMP,
    read_time INTEGER DEFAULT 5,
    view_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. BLOG_COMMENTS TABLE (for blog comments)
CREATE TABLE IF NOT EXISTS blog_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES blog_comments(id) ON DELETE CASCADE,
    author_name VARCHAR(100) NOT NULL,
    author_email VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    ip_address INET,
    user_agent TEXT,
    is_approved BOOLEAN DEFAULT false,
    is_spam BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. COMMENT_LIKES TABLE (for comment likes)
CREATE TABLE IF NOT EXISTS comment_likes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    comment_id UUID NOT NULL REFERENCES blog_comments(id) ON DELETE CASCADE,
    ip_address INET NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(comment_id, ip_address)
);

-- 5. POST_LIKES TABLE (for blog post likes)
CREATE TABLE IF NOT EXISTS post_likes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    ip_address INET NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(post_id, ip_address)
);

-- 6. PAGE_VIEWS TABLE (for analytics)
CREATE TABLE IF NOT EXISTS page_views (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    page_url VARCHAR(500) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    referrer VARCHAR(500),
    viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. NEWSLETTER_SUBSCRIBERS TABLE (for email subscriptions)
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    source VARCHAR(100) DEFAULT 'website',
    is_active BOOLEAN DEFAULT true,
    subscribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    unsubscribed_at TIMESTAMP
);



-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON blog_posts(slug);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published ON blog_posts(published);
CREATE INDEX IF NOT EXISTS idx_blog_posts_category ON blog_posts(category);
CREATE INDEX IF NOT EXISTS idx_blog_posts_featured ON blog_posts(featured);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published_at ON blog_posts(published_at);

CREATE INDEX IF NOT EXISTS idx_blog_comments_post_id ON blog_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_blog_comments_parent_id ON blog_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_blog_comments_approved ON blog_comments(is_approved);

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_verification_token ON customers(verification_token);
CREATE INDEX IF NOT EXISTS idx_customers_reset_token ON customers(reset_token);

CREATE INDEX IF NOT EXISTS idx_page_views_page_url ON page_views(page_url);
CREATE INDEX IF NOT EXISTS idx_page_views_viewed_at ON page_views(viewed_at);

CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_email ON newsletter_subscribers(email);
CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_active ON newsletter_subscribers(is_active);

-- Insert some sample blog posts
INSERT INTO blog_posts (slug, title, excerpt, content, author, category, tags, featured, published, published_at) VALUES
('introduction-to-data-analytics', 'Introduction to Data Analytics', 'Learn the fundamentals of data analytics and how it can transform your business decisions.', '# Introduction to Data Analytics\n\nData analytics is the process of examining data sets to draw conclusions about the information they contain.', 'DataWeb Team', 'Analytics', ARRAY['data', 'analytics', 'beginners'], true, true, CURRENT_TIMESTAMP),
('machine-learning-basics', 'Machine Learning Basics', 'A comprehensive guide to understanding machine learning concepts and applications.', '# Machine Learning Basics\n\nMachine learning is a subset of artificial intelligence that enables systems to learn and improve from experience.', 'DataWeb Team', 'Machine Learning', ARRAY['machine learning', 'AI', 'tutorial'], true, true, CURRENT_TIMESTAMP)
ON CONFLICT (slug) DO NOTHING;

-- Enable Row Level Security (RLS) for Supabase
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (basic policies - you may want to customize these)
-- Drop existing policies first so this script can be rerun safely.
DROP POLICY IF EXISTS "Allow public read access to published blog posts" ON blog_posts;
DROP POLICY IF EXISTS "Allow public read access to approved comments" ON blog_comments;
DROP POLICY IF EXISTS "Allow users to manage their own customer data" ON customers;
DROP POLICY IF EXISTS "Allow public newsletter subscription" ON newsletter_subscribers;
DROP POLICY IF EXISTS "Allow public page view tracking" ON page_views;
DROP POLICY IF EXISTS "Allow public to insert comments" ON blog_comments;
DROP POLICY IF EXISTS "Allow public to like posts" ON post_likes;
DROP POLICY IF EXISTS "Allow public to like comments" ON comment_likes;
DROP POLICY IF EXISTS "Allow public to read post likes" ON post_likes;
DROP POLICY IF EXISTS "Allow public to read comment likes" ON comment_likes;
DROP POLICY IF EXISTS "Allow public to read page views" ON page_views;
DROP POLICY IF EXISTS "Allow public to read newsletter subscribers" ON newsletter_subscribers;
DROP POLICY IF EXISTS "Allow public to update newsletter subscription" ON newsletter_subscribers;
DROP POLICY IF EXISTS "Allow public to register customers" ON customers;
DROP POLICY IF EXISTS "Allow public to read customer data for auth" ON customers;
DROP POLICY IF EXISTS "Allow public to update customer data" ON customers;

-- Allow public read access to published blog posts
CREATE POLICY "Allow public read access to published blog posts" ON blog_posts
    FOR SELECT USING (published = true);

-- Allow public read access to approved comments
CREATE POLICY "Allow public read access to approved comments" ON blog_comments
    FOR SELECT USING (is_approved = true);



-- Allow authenticated users to manage their own data
CREATE POLICY "Allow users to manage their own customer data" ON customers
    FOR ALL USING (auth.uid()::text = id::text);

-- Allow public to subscribe to newsletter
CREATE POLICY "Allow public newsletter subscription" ON newsletter_subscribers
    FOR INSERT WITH CHECK (true);

-- Allow public to view page views (for analytics)
CREATE POLICY "Allow public page view tracking" ON page_views
    FOR INSERT WITH CHECK (true);

-- Allow public to insert comments (they'll be moderated)
CREATE POLICY "Allow public to insert comments" ON blog_comments
    FOR INSERT WITH CHECK (true);

-- Allow public to like posts and comments
CREATE POLICY "Allow public to like posts" ON post_likes
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public to like comments" ON comment_likes
    FOR INSERT WITH CHECK (true);

-- Allow public to read likes (for displaying like counts)
CREATE POLICY "Allow public to read post likes" ON post_likes
    FOR SELECT USING (true);

CREATE POLICY "Allow public to read comment likes" ON comment_likes
    FOR SELECT USING (true);

-- Allow public to read page views (for analytics)
CREATE POLICY "Allow public to read page views" ON page_views
    FOR SELECT USING (true);

-- Allow public to read newsletter subscribers (for admin purposes)
CREATE POLICY "Allow public to read newsletter subscribers" ON newsletter_subscribers
    FOR SELECT USING (true);

-- Allow public to update newsletter subscription status
CREATE POLICY "Allow public to update newsletter subscription" ON newsletter_subscribers
    FOR UPDATE USING (true);

-- Allow public to insert customers (for registration)
CREATE POLICY "Allow public to register customers" ON customers
    FOR INSERT WITH CHECK (true);

-- Allow public to read customer data (for login verification)
CREATE POLICY "Allow public to read customer data for auth" ON customers
    FOR SELECT USING (true);

-- Allow public to update customer data (for password reset, email verification)
CREATE POLICY "Allow public to update customer data" ON customers
    FOR UPDATE USING (true);
