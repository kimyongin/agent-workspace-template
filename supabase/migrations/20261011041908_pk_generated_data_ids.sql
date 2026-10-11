begin;
-- Server candidates are pure; uniqueness is enforced only by the receiving table's PK.
-- Stop writers while deploying this migration and its matching adapters.
alter table app.tags alter column id set default app.data_id_candidate();
alter table app.tasks alter column id set default app.data_id_candidate();
alter table app.records alter column id set default app.data_id_candidate();
alter table app.principles alter column id set default app.data_id_candidate();
grant execute on function app.data_id_candidate() to app_user,app_server,app_worker;
drop function app.issue_data_id();
drop table private.data_id_reservations;
commit;
