-- CLI generated and sequenced after the applied body-search follow-up.
-- ADR-0013 / #148 already retired the archive sources and their part mappings.
-- Keep that contract: the recreated routine has no source tables to recover.
drop procedure private.preserve_principle_sources(uuid);
