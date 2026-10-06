-- Final transfer of archived sources, then retire the migration-only storage.
-- Existing mappings honor user-edited/deleted records; this never recreates them.
call private.preserve_principle_sources();

drop procedure private.preserve_principle_sources(uuid);
drop table app.record_principles;
drop table app.principle_tags;
drop table app.legacy_principle_record_parts;
drop table private.retired_principle_sources;
