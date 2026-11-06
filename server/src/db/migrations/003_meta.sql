-- Meta connections (encrypted tokens), OAuth state, ad account selection, app settings.

CREATE TABLE meta_connections (
  id                BIGSERIAL PRIMARY KEY,
  meta_user_id      TEXT        NOT NULL UNIQUE,
  meta_user_name    TEXT,
  token_type        TEXT        NOT NULL CHECK (token_type IN ('user', 'system_user')),
  token_ciphertext  TEXT        NOT NULL,           -- AES-256-GCM, never returned by the API
  scopes            TEXT[]      NOT NULL DEFAULT '{}',
  expires_at        TIMESTAMPTZ,                    -- NULL = does not expire
  status            TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invalid')),
  last_error        TEXT,
  connected_by      BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE oauth_states (
  state_hash  TEXT        PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL
);

-- is_active now means "selected for auditing". Newly discovered accounts start unselected.
ALTER TABLE ad_accounts ALTER COLUMN is_active SET DEFAULT FALSE;
ALTER TABLE ad_accounts ADD COLUMN connection_id  BIGINT REFERENCES meta_connections(id) ON DELETE SET NULL;
ALTER TABLE ad_accounts ADD COLUMN account_status INT;
ALTER TABLE ad_accounts ADD COLUMN business_name  TEXT;
ALTER TABLE ad_accounts ADD COLUMN last_seen_at   TIMESTAMPTZ;

CREATE TABLE app_settings (
  key         TEXT        PRIMARY KEY,
  value       JSONB       NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT      REFERENCES users(id) ON DELETE SET NULL
);
