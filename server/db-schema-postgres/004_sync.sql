-- Campaign detail captured at sync time: rating notes, ad sets and ads.

ALTER TABLE campaign_audits ADD COLUMN rating_note         TEXT;
ALTER TABLE campaign_audits ADD COLUMN leads_baseline_cpl  NUMERIC(14,4);
ALTER TABLE campaign_audits ADD COLUMN buying_type         TEXT;
ALTER TABLE campaign_audits ADD COLUMN bid_strategy        TEXT;
ALTER TABLE campaign_audits ADD COLUMN daily_budget        NUMERIC(14,2);  -- rupees
ALTER TABLE campaign_audits ADD COLUMN lifetime_budget     NUMERIC(14,2);
ALTER TABLE campaign_audits ADD COLUMN start_time          TIMESTAMPTZ;

CREATE TABLE adset_audits (
  id                   BIGSERIAL PRIMARY KEY,
  campaign_audit_id    BIGINT  NOT NULL REFERENCES campaign_audits(id) ON DELETE CASCADE,
  meta_adset_id        TEXT    NOT NULL,
  name                 TEXT    NOT NULL,
  effective_status     TEXT,
  daily_budget         NUMERIC(14,2),
  lifetime_budget      NUMERIC(14,2),
  bid_strategy         TEXT,
  optimization_goal    TEXT,
  is_dynamic_creative  BOOLEAN,
  publisher_platforms  TEXT[],
  frequency_cap        TEXT,
  locations            TEXT,
  excluded_locations   TEXT,
  raw_snapshot         JSONB
);
CREATE INDEX adset_audits_campaign_idx ON adset_audits (campaign_audit_id);

CREATE TABLE ad_audits (
  id                 BIGSERIAL PRIMARY KEY,
  campaign_audit_id  BIGINT  NOT NULL REFERENCES campaign_audits(id) ON DELETE CASCADE,
  meta_adset_id      TEXT,
  meta_ad_id         TEXT    NOT NULL,
  name               TEXT    NOT NULL,
  effective_status   TEXT,
  creative_id        TEXT,
  primary_text       TEXT,
  headline           TEXT,
  cta_type           TEXT,
  thumbnail_url      TEXT,
  image_url          TEXT,
  permalink_url      TEXT,
  raw_snapshot       JSONB
);
CREATE INDEX ad_audits_campaign_idx ON ad_audits (campaign_audit_id);
CREATE INDEX ad_audits_meta_ad_idx ON ad_audits (meta_ad_id);
