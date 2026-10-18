-- Business creation holds the registry epoch without receiving settings write
-- authority. The caller holds the current kind lock before this identity lock.
create function app.lock_business_entity_identity(p_type uuid) returns boolean
 language plpgsql security definer set search_path='' as $$
begin
 perform app.authorize_workspace(jsonb_build_array(jsonb_build_object('target_kind','entity_type','target_id',p_type::text,'access','write')));
 perform pg_advisory_xact_lock(hashtextextended(app.current_workspace_id()::text||':entity-identity-registry',0));
 perform 1 from app.entity_type_identity where workspace_id=app.current_workspace_id() and type_id=p_type for share;
 return found;
end $$;
revoke all on function app.lock_business_entity_identity(uuid) from public,anon,authenticated,app_worker;
grant execute on function app.lock_business_entity_identity(uuid) to app_user;
