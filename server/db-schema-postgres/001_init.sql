-- Phase 1: storage for audit snapshots.
-- Every sync creates an audit_run; campaign settings and check results are stored
-- per run, so history is preserved and nothing is overwritten.
-- Meta OAuth token storage is added in Phase 2.

CREATE TABLE ad_accounts (
  id               BIGSERIAL PRIMARY KEY,
  meta_account_id  TEXT        NOT NULL UNIQUE,   -- numeric id without the "act_" prefix
  name             TEXT        NOT NULL,
  currency         TEXT        NOT NULL DEFAULT 'INR',
  timezone         TEXT,
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  is_dev_data      BOOLEAN     NOT NULL DEFAULT FALSE, -- TRUE only for labelled development fixtures
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_runs (
  id            BIGSERIAL PRIMARY KEY,
  source        TEXT        NOT NULL CHECK (source IN ('meta', 'development')),
  trigger       TEXT        NOT NULL CHECK (trigger IN ('scheduled', 'manual', 'seed')),
  status        TEXT        NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  period_start  DATE,
  period_end    DATE,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  error         TEXT
);
CREATE INDEX audit_runs_latest_idx ON audit_runs (status, finished_at DESC);

CREATE TABLE audit_run_accounts (
  run_id         BIGINT NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  ad_account_id  BIGINT NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  status         TEXT   NOT NULL CHECK (status IN ('succeeded', 'failed')),
  error          TEXT,
  PRIMARY KEY (run_id, ad_account_id)
);

CREATE TABLE campaign_audits (
  id                 BIGSERIAL PRIMARY KEY,
  run_id             BIGINT        NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  ad_account_id      BIGINT        NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  meta_campaign_id   TEXT          NOT NULL,
  name               TEXT          NOT NULL,
  objective_raw      TEXT          NOT NULL,       -- as returned by Meta, e.g. OUTCOME_SALES
  objective          TEXT          NOT NULL,       -- SOP label: Sales, Traffic, … or Other
  effective_status   TEXT,
  currency           TEXT          NOT NULL DEFAULT 'INR',
  spend_7d           NUMERIC(14,2) NOT NULL DEFAULT 0,
  main_metric_kind   TEXT,
  main_metric_value  NUMERIC(14,4),
  rating             TEXT          NOT NULL DEFAULT 'NOT_RATED'
                     CHECK (rating IN ('GOOD', 'AVERAGE', 'BAD', 'NOT_RATED')),
  rating_indicative  BOOLEAN       NOT NULL DEFAULT FALSE,
  raw_snapshot       JSONB,                         -- API payload kept for audit traceability
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (run_id, meta_campaign_id)
);
CREATE INDEX campaign_audits_run_idx ON campaign_audits (run_id);
CREATE INDEX campaign_audits_campaign_idx ON campaign_audits (meta_campaign_id, created_at DESC);

CREATE TABLE check_results (
  campaign_audit_id  BIGINT NOT NULL REFERENCES campaign_audits(id) ON DELETE CASCADE,
  check_key          TEXT   NOT NULL CHECK (check_key IN (
                       'placements', 'naming', 'bid_strategy', 'frequency', 'min_budget',
                       'seven_sisters', 'creative_complete', 'buying_type', 'dynamic_creative')),
  outcome            TEXT   NOT NULL CHECK (outcome IN ('PASS', 'FAIL', 'NOT_CHECKABLE', 'NOT_APPLICABLE')),
  detail             TEXT,
  PRIMARY KEY (campaign_audit_id, check_key)
);
CREATE INDEX check_results_key_idx ON check_results (check_key, outcome);
