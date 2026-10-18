-- Expose only execution admissibility after the current caller is authorized for
-- the exact stored workspace footprint. Historical executors remain private.
create function app.workspace_schema_execution_current(p_kind text,p_id uuid)
 returns boolean language plpgsql security definer set search_path='' as $$
declare w uuid;plan jsonb;permissions jsonb;kinds jsonb;job record;children integer:=0;
begin
 if p_kind is null or p_kind not in ('model','migration') then
  raise exception 'invalid schema execution kind' using errcode='22023';end if;
 perform app.authorize_workspace('[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb);
 w:=app.current_workspace_id();
 if p_kind='model' then
  select g.plan into plan from app.data_model_changes g where g.workspace_id=w and g.id=p_id;
  if not found then return false;end if;
  permissions:=plan->'protected_permissions';kinds:=plan->'protected_kind_ids';
  if jsonb_typeof(permissions) is distinct from 'array' or jsonb_array_length(permissions)=0
   or jsonb_typeof(kinds) is distinct from 'array' or jsonb_array_length(kinds)=0 then
   raise exception 'schema_execution_footprint_missing' using errcode='42501';end if;
  select permissions||jsonb_agg(jsonb_build_object('target_kind','entity_type','target_id',value,'access','write'))
   into permissions from jsonb_array_elements_text(kinds);
  for job in select j.required_permissions,j.required_kind_ids from app.data_model_children c
   left join app.entity_schema_migrations j on j.workspace_id=c.workspace_id and j.id=c.job_id
    and j.model_change_id=c.model_id and j.type_id=c.type_id and j.change_id=c.change_id
   where c.workspace_id=w and c.model_id=p_id loop
   children:=children+1;
   if jsonb_typeof(job.required_permissions) is distinct from 'array' or jsonb_array_length(job.required_permissions)=0
    or coalesce(cardinality(job.required_kind_ids),0)=0 then
    raise exception 'schema_execution_footprint_missing' using errcode='42501';end if;
   select permissions||job.required_permissions||jsonb_agg(jsonb_build_object('target_kind','entity_type','target_id',id::text,'access','write'))
    into permissions from unnest(job.required_kind_ids) id;
  end loop;
  if children=0 then raise exception 'schema_execution_footprint_missing' using errcode='42501';end if;
 else
  select j.required_permissions,j.required_kind_ids into job from app.entity_schema_migrations j where j.workspace_id=w and j.id=p_id;
  if not found then return false;end if;
  if jsonb_typeof(job.required_permissions) is distinct from 'array' or jsonb_array_length(job.required_permissions)=0
   or coalesce(cardinality(job.required_kind_ids),0)=0 then
   raise exception 'schema_execution_footprint_missing' using errcode='42501';end if;
  select job.required_permissions||jsonb_agg(jsonb_build_object('target_kind','entity_type','target_id',id::text,'access','write'))
   into permissions from unnest(job.required_kind_ids) id;
 end if;
 -- Validate descriptors before normalization; malformed stored scope fails closed.
 if not private.schema_permissions_allow(auth.uid(),w,permissions) then
  raise exception 'workspace_denied' using errcode='42501';end if;
 perform app.authorize_workspace(private.normalize_schema_permissions(permissions));
 if p_kind='model' then return coalesce(private.schema_group_current(w,p_id),false);end if;
 return coalesce(private.schema_job_current(w,p_id),false);
end $$;
revoke all on function app.workspace_schema_execution_current(text,uuid)
 from public,anon,authenticated,app_server,app_worker;
grant execute on function app.workspace_schema_execution_current(text,uuid) to app_user;
