-- Task authority shares the user's task content. Associated materials retain
-- their own current read boundary, including direct app_user SQL access.
revoke select,update on app.tasks from app_user;
do $$ declare columns text;
begin
 select string_agg(quote_ident(attname),',' order by attnum) into columns
 from pg_attribute where attrelid='app.tasks'::regclass and attnum>0 and not attisdropped
  and attname not in ('entity_ids','entity_context');
 execute 'grant select ('||columns||') on app.tasks to app_user';
 execute 'grant update ('||columns||') on app.tasks to app_user';
end $$;

create function app.workspace_task_associations(p_task text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare target app.tasks;ids text[];context jsonb;
begin
 perform app.authorize_workspace('[{"target_kind":"tasks","target_id":"*","access":"read"}]'::jsonb);
 select * into target from app.tasks where workspace_id=app.current_workspace_id() and id=p_task;
 if not found then return null;end if;
 select coalesce(array_agg(e.id order by e.id),'{}'::text[]) into ids from app.entities e
 where e.workspace_id=target.workspace_id and e.id=any(target.entity_ids)
  and app.workspace_allows('entity_type',e.entity_type_id::text,'read');
 select coalesce(jsonb_agg(c.value order by c.ordinality),'[]'::jsonb) into context
 from jsonb_array_elements(target.entity_context) with ordinality c(value,ordinality)
 where c.value->>'id'=any(ids);
 return jsonb_build_object('entity_ids',to_jsonb(ids),'entity_context',context);
end $$;
revoke all on function app.workspace_task_associations(text) from public,anon,authenticated,app_server,app_worker;
grant execute on function app.workspace_task_associations(text) to app_user;

-- This mutation returns no captures. It retains inaccessible associations inside
-- storage while applying only the caller's readable selection. Content/version,
-- event, queue and receipt remain owned by the surrounding business transaction.
create function app.set_workspace_task_associations(p_task text,p_ids text[],p_context jsonb) returns void
 language plpgsql security definer set search_path='' as $$
declare before_ids text[];target app.tasks;kind uuid;available integer;hidden text[];selected text[];context jsonb;requirements jsonb;
begin
 perform app.authorize_workspace('[{"target_kind":"tasks","target_id":"*","access":"write"}]'::jsonb);
 if p_ids is null or array_position(p_ids,null) is not null or cardinality(p_ids)>100
  or jsonb_typeof(p_context) is distinct from 'array' or jsonb_array_length(p_context)>100 then
  raise exception 'invalid_task_selection' using errcode='22023';end if;
 select entity_ids into before_ids from app.tasks where workspace_id=app.current_workspace_id() and id=p_task;
 if not found then raise exception 'task_selection_missing' using errcode='23503';end if;
 select count(*) into available from app.entities e where e.workspace_id=app.current_workspace_id() and e.id=any(p_ids)
  and app.workspace_allows('entity_type',e.entity_type_id::text,'read')
  and (e.deleted_at is null or e.id=any(before_ids));
 if available<>cardinality(p_ids) then raise exception 'task_selection_missing' using errcode='23503';end if;
 select coalesce(jsonb_agg(jsonb_build_object('target_kind','entity_type','target_id',id::text,'access','read')),'[]'::jsonb)
 into requirements from (select distinct e.entity_type_id id from app.entities e
  where e.workspace_id=app.current_workspace_id() and e.id=any(p_ids||before_ids)
   and app.workspace_allows('entity_type',e.entity_type_id::text,'read')) kinds;
 perform app.authorize_workspace(requirements);
 for kind in select (value->>'target_id')::uuid from jsonb_array_elements(requirements) order by value->>'target_id' loop
  perform app.lock_business_entity_type(kind,false);
 end loop;
 select * into target from app.tasks where workspace_id=app.current_workspace_id() and id=p_task for update;
 if not found then raise exception 'task_selection_missing' using errcode='23503';end if;
 if target.entity_ids is distinct from before_ids then
  raise exception 'task_selection_changed' using errcode='40001';end if;
 select coalesce(array_agg(old_ref.id order by old_ref.id),'{}'::text[]) into hidden from unnest(target.entity_ids) old_ref(id)
 where not exists(select 1 from app.entities e where e.workspace_id=target.workspace_id and e.id=old_ref.id
  and app.workspace_allows('entity_type',e.entity_type_id::text,'read'));
 select coalesce(array_agg(id order by id),'{}'::text[]) into selected from (select distinct unnest(p_ids||hidden) id) ids;
 if exists(select 1 from jsonb_array_elements(p_context) c where jsonb_typeof(c) is distinct from 'object'
  or c->>'id' is null or not(c->>'id'=any(p_ids))) then
  raise exception 'invalid_task_capture' using errcode='22023';end if;
 select coalesce(jsonb_agg(capture order by id),'[]'::jsonb) into context from (
  select selected_ref.id,coalesce(
   (select c from jsonb_array_elements(target.entity_context) c where c->>'id'=selected_ref.id limit 1),
   (select c from jsonb_array_elements(p_context) c where c->>'id'=selected_ref.id limit 1)) capture
  from unnest(selected) selected_ref(id)
 ) captures where capture is not null;
 update app.tasks set entity_ids=selected,entity_context=context where workspace_id=target.workspace_id and id=p_task;
 perform set_config('request.workspace_requirements',
  (current_setting('request.workspace_requirements')::jsonb||requirements)::text,true);
end $$;
revoke all on function app.set_workspace_task_associations(text,text[],jsonb) from public,anon,authenticated,app_server,app_worker;
grant execute on function app.set_workspace_task_associations(text,text[],jsonb) to app_user;

-- Existing inaccessible references are preserved by the narrow setter. A
-- changed association needs material READ; unchanged hidden associations do not.
create or replace function private.guard_workspace_task_selection() returns trigger
 language plpgsql security definer set search_path='' as $$
declare requirements jsonb;available integer;changed_ids text[];
begin
 if new.workspace_id is null then return new;end if;
 if tg_op='UPDATE' and new.entity_ids is not distinct from old.entity_ids then return new;end if;
 if new.workspace_id is distinct from app.current_workspace_id() then raise exception 'workspace_denied' using errcode='42501';end if;
 perform app.authorize_workspace('[{"target_kind":"tasks","target_id":"*","access":"write"}]'::jsonb);
 if new.entity_ids is null or array_position(new.entity_ids,null) is not null then
  raise exception 'invalid_task_selection' using errcode='23514';end if;
 select count(*) into available from app.entities e where e.workspace_id=new.workspace_id and e.id=any(new.entity_ids);
 if available<>cardinality(new.entity_ids) then raise exception 'task_selection_missing' using errcode='23503';end if;
 if tg_op='INSERT' then changed_ids:=new.entity_ids;
 else select coalesce(array_agg(id),'{}'::text[]) into changed_ids from (
  (select unnest(new.entity_ids) id except select unnest(old.entity_ids))
  union (select unnest(old.entity_ids) id except select unnest(new.entity_ids))
 ) changed;end if;
 select coalesce(jsonb_agg(jsonb_build_object('target_kind','entity_type','target_id',e.entity_type_id::text,'access','read')),'[]'::jsonb)
 into requirements from app.entities e where e.workspace_id=new.workspace_id and e.id=any(changed_ids);
 perform app.authorize_workspace(requirements);
 perform set_config('request.workspace_requirements',
  (coalesce(nullif(current_setting('request.workspace_requirements',true),''),'[]')::jsonb||requirements)::text,true);
 return new;
end $$;
