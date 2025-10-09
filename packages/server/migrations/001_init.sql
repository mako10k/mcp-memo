CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS memory_entries (
    namespace TEXT NOT NULL,
    id UUID NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    content_embedding VECTOR(1536) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (namespace, id)
);

CREATE INDEX IF NOT EXISTS idx_memory_entries_namespace_updated_at
    ON memory_entries (namespace, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_entries_metadata
    ON memory_entries USING GIN (metadata);

CREATE INDEX IF NOT EXISTS idx_memory_entries_embedding
    ON memory_entries USING IVFFLAT (content_embedding vector_l2_ops)
    WITH (lists = 100);
