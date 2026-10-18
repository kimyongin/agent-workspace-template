-- Only actual result/change records belong to workspace business parents.
-- Legacy owner rows remain untouched for the explicit #518 cleanup manifest.
alter table app.records add constraint record_workspace_result_kind
 check(workspace_id is null or record_kind in ('result','change'));
