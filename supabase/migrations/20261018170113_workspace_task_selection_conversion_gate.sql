-- Keep the existing READ-authorized association seam frozen while its kind's
-- schema conversion owns the baseline. Ordinary task body edits do not enter it.
do $$ declare definition text;before text;after text;
begin
 select pg_get_functiondef('app.set_workspace_task_associations(text,text[],jsonb)'::regprocedure) into definition;
 before:='perform app.lock_business_entity_type(kind,false);';
 after:='if coalesce((app.lock_business_entity_type(kind,false)->>''schema_write_locked'')::boolean,false) then
   raise exception ''schema_migration_in_progress'' using errcode=''55000'';
  end if;';
 if strpos(definition,before)=0 then raise exception 'unexpected_task_selection_kind_lock';end if;
 execute replace(definition,before,after);
end $$;
revoke all on function app.set_workspace_task_associations(text,text[],jsonb) from public,anon,authenticated,app_server,app_worker;
grant execute on function app.set_workspace_task_associations(text,text[],jsonb) to app_user;
