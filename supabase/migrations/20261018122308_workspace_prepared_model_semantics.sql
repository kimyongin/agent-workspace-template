-- Persisted preparation is trusted publication input, not an editable JSON
-- document. Only bounded analysis progress and trusted readiness may change.
create function private.keep_prepared_model_semantics() returns trigger
 language plpgsql set search_path='' as $$
declare expected_refs jsonb;requirements jsonb;
begin
 if old.workspace_id is null then return new;end if;
 if (old.plan-array['conversion_refs','baseline','review']) is distinct from (new.plan-array['conversion_refs','baseline','review'])
  or ((old.plan->'review')-'can_apply') is distinct from ((new.plan->'review')-'can_apply') then
  raise exception 'model_plan_semantics_immutable' using errcode='23514';end if;
 if current_user='app_user' then
  if old.plan->'review'->'can_apply' is distinct from new.plan->'review'->'can_apply' then
   raise exception 'model_plan_semantics_immutable' using errcode='23514';end if;
  if old.plan->'conversion_refs' is distinct from new.plan->'conversion_refs'
    or old.plan->'baseline' is distinct from new.plan->'baseline' then
   if old.status not in ('needs_conversion','ready','analyzing','failed') or new.status<>'analyzing' or new.version<>old.version+1
     or new.plan->>'baseline' is null or new.plan->>'baseline' !~ '^[0-9a-f]{64}$' then
    raise exception 'model_plan_semantics_immutable' using errcode='23514';end if;
   select coalesce(jsonb_agg(item->'ref' order by ordinal),'[]'::jsonb) into expected_refs
    from jsonb_array_elements(old.plan->'review'->'items') with ordinality reviewed(item,ordinal)
    where item->>'kind'='migration_required' and exists(select 1 from jsonb_array_elements(old.plan->'target'->'entity_types') target
     where target->>'ref'=item->>'ref');
   if new.plan->'conversion_refs' is distinct from expected_refs then
    raise exception 'model_plan_semantics_immutable' using errcode='23514';end if;
   requirements:=coalesce(old.plan->'protected_permissions','[]'::jsonb)
    ||'[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb;
   perform app.authorize_workspace(requirements);
   if app.export_workspace_data_model() is distinct from old.plan->'source' then
    raise exception 'schema_plan_stale' using errcode='P0001';end if;
   perform set_config('request.workspace_requirements',
    (coalesce(nullif(current_setting('request.workspace_requirements',true),''),'[]')::jsonb||requirements)::text,true);
  end if;
 end if;
 return new;
end $$;
revoke all on function private.keep_prepared_model_semantics() from public,anon,authenticated,app_user,app_server,app_worker;
create trigger keep_prepared_model_semantics before update on app.data_model_changes
 for each row execute function private.keep_prepared_model_semantics();
