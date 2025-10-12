BEGIN;

CREATE TABLE IF NOT EXISTS memory_relations (
    owner_id UUID NOT NULL,
    namespace TEXT NOT NULL,
    source_memo_id UUID NOT NULL,
    target_memo_id UUID NOT NULL,
    tag TEXT NOT NULL,
    weight NUMERIC(3,2) NOT NULL CHECK (weight >= 0 AND weight <= 1),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (owner_id, namespace, source_memo_id, target_memo_id, tag)
);

ALTER TABLE memory_relations
    ADD CONSTRAINT fk_memory_relations_source
    FOREIGN KEY (owner_id, namespace, source_memo_id)
    REFERENCES memory_entries (owner_id, namespace, id)
    ON DELETE CASCADE;

ALTER TABLE memory_relations
    ADD CONSTRAINT fk_memory_relations_target
    FOREIGN KEY (owner_id, namespace, target_memo_id)
    REFERENCES memory_entries (owner_id, namespace, id)
    ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_memory_relations_source
    ON memory_relations (owner_id, namespace, source_memo_id, tag);

CREATE INDEX IF NOT EXISTS idx_memory_relations_target
    ON memory_relations (owner_id, namespace, target_memo_id, tag);

COMMIT;
