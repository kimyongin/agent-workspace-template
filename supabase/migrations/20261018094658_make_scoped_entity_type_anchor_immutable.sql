-- Legacy NULL kinds may enter their authorized workspace during #513 conversion.
-- Once scoped, a kind cannot remove or change its anchor, including through NULL.
create function private.reject_entity_type_workspace_move() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.workspace_id is not null and new.workspace_id is distinct from old.workspace_id then
    raise exception using errcode='23514',message='workspace_entity_type_anchor_immutable';
  end if;
  return new;
end $$;
revoke all on function private.reject_entity_type_workspace_move() from public,anon,authenticated,app_user,app_server,app_worker;
create trigger entity_type_workspace_immutable before update on app.entity_types
  for each row execute function private.reject_entity_type_workspace_move();
