-- Manual verification of SOP items Meta cannot expose. Only a person sets these;
-- no row means Pending. Keyed by Meta campaign id so a verification carries across runs.

CREATE TABLE manual_verifications (
  meta_campaign_id  TEXT        NOT NULL,
  item_key          TEXT        NOT NULL CHECK (item_key IN (
                      'creative_approval', 'next_day_launch', 'stock', 'copy', 'sku', 'coupon',
                      'custom_audience_exclusions')),
  status            TEXT        NOT NULL CHECK (status IN ('VERIFIED', 'FAILED', 'NOT_APPLICABLE')),
  note              TEXT,
  updated_by        BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (meta_campaign_id, item_key)
);

-- Append-only trail of every change, including resets to Pending.
CREATE TABLE manual_verification_events (
  id                BIGSERIAL   PRIMARY KEY,
  meta_campaign_id  TEXT        NOT NULL,
  item_key          TEXT        NOT NULL,
  status            TEXT        NOT NULL CHECK (status IN ('PENDING', 'VERIFIED', 'FAILED', 'NOT_APPLICABLE')),
  note              TEXT,
  user_id           BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX manual_events_campaign_idx ON manual_verification_events (meta_campaign_id, created_at DESC);
