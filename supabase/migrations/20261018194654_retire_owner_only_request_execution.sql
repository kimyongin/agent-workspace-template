-- All current business requests use executor/workspace-scoped receipts.
-- Preserve historical receipt rows and expiry maintenance, but retire the
-- owner-only executables so they cannot allocate or replay legacy requests.
drop function app.begin_request(uuid,text,text);
drop function app.finish_request(uuid,jsonb);
drop function app.replay_retained_request(uuid,text,text);
