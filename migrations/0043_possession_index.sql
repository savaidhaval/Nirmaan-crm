-- 0043: the Possession list counts open snags per flat. Additive: one index.
CREATE INDEX IF NOT EXISTS idx_snag_unit ON site_snags(unit_id, status);
