-- Run once against your database (psql, pgAdmin Query Tool, etc.)
-- Requires PostgreSQL 13+ (gen_random_uuid() is built in).

CREATE SCHEMA IF NOT EXISTS cry_analysis;

CREATE TABLE IF NOT EXISTS cry_analysis.users (
    user_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    level         VARCHAR(20) NOT NULL DEFAULT 'normal'
                  CHECK (level IN ('normal', 'admin')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cry_analysis.sessions (
    token      TEXT PRIMARY KEY,
    user_id    BIGINT NOT NULL
               REFERENCES cry_analysis.users(user_id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cry_analysis.analyses (
    analysis_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     BIGINT NOT NULL
                REFERENCES cry_analysis.users(user_id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    prediction  VARCHAR(50) NOT NULL,
    confidence  DOUBLE PRECISION NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cry_analysis.feedback (
    analysis_id UUID PRIMARY KEY
                REFERENCES cry_analysis.analyses(analysis_id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL
                REFERENCES cry_analysis.users(user_id) ON DELETE CASCADE,
    helpful     BOOLEAN NOT NULL,
    comment     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analyses_user
    ON cry_analysis.analyses (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_expires
    ON cry_analysis.sessions (expires_at);

-- Quick checks
-- SELECT * FROM cry_analysis.users;
-- SELECT * FROM cry_analysis.sessions;
-- SELECT * FROM cry_analysis.analyses;
-- SELECT * FROM cry_analysis.feedback;

-- Promote someone to admin later:
-- UPDATE cry_analysis.users SET level = 'admin' WHERE email = 'someone@example.com';
