-- Settings picker metadata only: no tag use counts, linked targets or values.
create function app.workspace_record_template_tags(p_limit integer,p_at timestamptz default null,p_id text default null)
 returns table(scope text,id text,name text,version integer,created_at timestamptz,updated_at timestamptz)
 language plpgsql security definer set search_path='' as $$
begin
 perform app.lock_workspace_account();perform app.lock_workspace(app.current_workspace_id(),false);
 perform app.authorize_workspace('[{"target_kind":"settings","target_id":"*","access":"read"}]'::jsonb);
 if p_limit is null or p_limit<1 or p_limit>101 or (p_at is null)<>(p_id is null) then
  raise exception 'invalid_template_tag_page' using errcode='22023';
 end if;
 return query select t.scope,t.id,t.name,t.version,t.created_at,t.updated_at from app.tags t
  where t.workspace_id=app.current_workspace_id() and t.scope='record' and (p_at is null or (t.updated_at,t.id)<(p_at,p_id))
  order by t.updated_at desc,t.id desc limit p_limit;
end $$;
revoke all on function app.workspace_record_template_tags(integer,timestamptz,text) from public,anon,authenticated,app_worker;
grant execute on function app.workspace_record_template_tags(integer,timestamptz,text) to app_user;
