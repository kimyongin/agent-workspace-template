-- Use the existing validated narrow author projection; app_user has no auth schema access.
create or replace function private.capture_workspace_model_plan_actor() returns trigger language plpgsql set search_path='' as $$
declare actor jsonb;
begin
 if tg_op='INSERT' then
  actor:=app.workspace_author();
  new.created_by:=(actor->>'created_by')::uuid;
  new.created_by_name:=actor->>'created_by_name';
  new.initiated_by:=(actor->>'created_by')::uuid;
  new.workspace_generation:=app.workspace_generation();
 else
  if old.workspace_generation is distinct from new.workspace_generation then
   raise exception 'model_plan_generation_immutable' using errcode='23514';
  end if;
  if current_user='app_user' and (new.created_by is distinct from old.created_by or new.created_by_name is distinct from old.created_by_name) then
   raise exception 'model_plan_author_immutable' using errcode='23514';
  end if;
  if current_user='app_user' and new.initiated_by is distinct from old.initiated_by and new.initiated_by is distinct from (app.workspace_author()->>'created_by')::uuid then
   raise exception 'model_plan_initiator_invalid' using errcode='23514';
  end if;
 end if;
 return new;
end $$;
