-- Push notification subscriptions (Web Push API)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID        NOT NULL,
  email         VARCHAR(255),
  endpoint      TEXT        NOT NULL UNIQUE,
  p256dh        TEXT        NOT NULL,
  auth          TEXT        NOT NULL,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_email ON push_subscriptions (email);

-- Row Level Security
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY push_subscriptions_select_own ON push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY push_subscriptions_insert_own ON push_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY push_subscriptions_delete_own ON push_subscriptions
  FOR DELETE USING (auth.uid() = user_id);

-- Service role bypass for backend operations
CREATE POLICY push_subscriptions_service_role ON push_subscriptions
  FOR ALL USING (auth.role() = 'service_role');

-- Notification log for auditing and deduplication
CREATE TABLE IF NOT EXISTS notification_log (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID,
  type          VARCHAR(50) NOT NULL,
  title         VARCHAR(255) NOT NULL,
  body          TEXT NOT NULL,
  url           TEXT,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        VARCHAR(20) NOT NULL DEFAULT 'sent',
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_notification_log_user_id ON notification_log (user_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_type ON notification_log (type);
CREATE INDEX IF NOT EXISTS idx_notification_log_sent_at ON notification_log (sent_at);

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_log_select_own ON notification_log
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY notification_log_service_role ON notification_log
  FOR ALL USING (auth.role() = 'service_role');
