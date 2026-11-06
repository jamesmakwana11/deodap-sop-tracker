-- Users, roles and sessions.
-- Roles: viewer (read + reports), auditor (+ manual verification, manual refresh),
-- admin (+ Meta connection, account selection, users, schedule).

CREATE TABLE users (
  id                    BIGSERIAL PRIMARY KEY,
  email                 TEXT        NOT NULL,
  name                  TEXT        NOT NULL,
  password_hash         TEXT        NOT NULL,
  role                  TEXT        NOT NULL CHECK (role IN ('admin', 'auditor', 'viewer')),
  is_active             BOOLEAN     NOT NULL DEFAULT TRUE,
  must_change_password  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

-- Only a SHA-256 of the session token is stored; the raw token lives in an httpOnly cookie.
CREATE TABLE sessions (
  token_hash    TEXT        PRIMARY KEY,
  user_id       BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent    TEXT
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

ALTER TABLE audit_runs ADD COLUMN triggered_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
