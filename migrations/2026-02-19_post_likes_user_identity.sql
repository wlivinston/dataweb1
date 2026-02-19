-- Migration: add authenticated identity support for post likes
-- Date: 2026-02-19

BEGIN;

ALTER TABLE public.post_likes
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS user_email TEXT;

CREATE INDEX IF NOT EXISTS idx_post_likes_user_id
  ON public.post_likes(user_id);

CREATE INDEX IF NOT EXISTS idx_post_likes_user_email_lower
  ON public.post_likes(lower(user_email));

CREATE UNIQUE INDEX IF NOT EXISTS idx_post_likes_unique_user_id
  ON public.post_likes(post_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_post_likes_unique_user_email
  ON public.post_likes(post_id, lower(user_email))
  WHERE user_id IS NULL AND user_email IS NOT NULL;

COMMIT;
