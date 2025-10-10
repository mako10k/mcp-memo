-- Add API key management and owner scoping for hierarchical namespaces

BEGIN;

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL,
    token_hash TEXT NOT NULL,
    root_namespace TEXT NOT NULL,
    default_namespace TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (char_length(token_hash) >= 32),
    CHECK (status IN ('active', 'revoked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_token_hash ON api_keys (token_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_owner_id ON api_keys (owner_id);

ALTER TABLE memory_entries
    ADD COLUMN owner_id UUID;

-- Assign existing records to a legacy owner and fold namespaces under a root prefix
UPDATE memory_entries
SET
    owner_id = '00000000-0000-0000-0000-000000000000'::uuid,
    namespace = CONCAT('legacy/', namespace)
WHERE owner_id IS NULL;

ALTER TABLE memory_entries
    ALTER COLUMN owner_id SET NOT NULL;

ALTER TABLE memory_entries
    DROP CONSTRAINT IF EXISTS memory_entries_pkey;

ALTER TABLE memory_entries
    ADD CONSTRAINT memory_entries_pkey PRIMARY KEY (owner_id, namespace, id);

DROP INDEX IF EXISTS idx_memory_entries_namespace_updated_at;
CREATE INDEX idx_memory_entries_owner_namespace_updated_at
    ON memory_entries (owner_id, namespace, updated_at DESC);

INSERT INTO api_keys (owner_id, token_hash, root_namespace, default_namespace, status)
VALUES (
    '00000000-0000-0000-0000-000000000000'::uuid,
    'legacy-placeholder-token-hash-0000000000000000000000000000',
    'legacy',
    'legacy/DEF',
    'revoked'
)
ON CONFLICT (token_hash) DO NOTHING;

COMMIT;
