-- Business readers retain the current kind revision while validating typed
-- filters; writers serialize with publication without gaining settings access.
create function app.lock_business_entity_type(p_type uuid,p_write boolean)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare kind app.entity_types;
begin
 if p_write is null then raise exception 'invalid_permissions' using errcode='22023';end if;
 perform app.authorize_workspace(jsonb_build_array(jsonb_build_object('target_kind','entity_type','target_id',p_type::text,
  'access',case when p_write then 'write' else 'read' end)));
 if p_write then
  select * into kind from app.entity_types where workspace_id=app.current_workspace_id() and id=p_type for update;
 else
  select * into kind from app.entity_types where workspace_id=app.current_workspace_id() and id=p_type for share;
 end if;
 if not found then return null;end if;
 return jsonb_build_object('id',kind.id,'schema_version',kind.schema_version,'schema_write_locked',kind.schema_write_locked);
end $$;
revoke all on function app.lock_business_entity_type(uuid,boolean) from public,anon,authenticated,app_worker;
grant execute on function app.lock_business_entity_type(uuid,boolean) to app_user;
