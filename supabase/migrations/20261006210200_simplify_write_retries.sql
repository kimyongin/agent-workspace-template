-- Writes use actual object UUIDs and per-document versions, without replaying past responses.
-- Existing business rows/versions remain unchanged; newly created principles start at 1.
drop table app.request_results;
drop table app.principle_versions;
