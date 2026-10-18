-- Minimal relation metadata for business consumers, independent of settings.
-- Full definition tables keep their settings policies; these functions expose
-- only the two roles after current workspace and both-kind authorization.
create function app.business_relation_definitions()
 returns table(workspace_id uuid,id uuid,version integer,archived boolean,left_type_id uuid,left_label text,left_cardinality text,right_type_id uuid,right_label text,right_cardinality text)
 language plpgsql security definer set search_path='' as $$
begin
 perform app.authorize_workspace('[]'::jsonb);
 return query select d.workspace_id,d.id,d.version,d.archived,d.left_type_id,d.left_label,d.left_cardinality,d.right_type_id,d.right_label,d.right_cardinality
 from app.entity_relation_definitions d where d.workspace_id=app.current_workspace_id()
 and app.workspace_allows('entity_type',d.left_type_id::text,'read')
 and app.workspace_allows('entity_type',d.right_type_id::text,'read');
end $$;

create function app.business_relation_definition(p_id uuid,p_write boolean default false)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare d app.entity_relation_definitions;requirements jsonb;
begin
 if p_write is null then raise exception 'invalid_permissions' using errcode='22023';end if;
 perform app.authorize_workspace('[]'::jsonb);
 if p_write then
  perform pg_advisory_xact_lock(hashtextextended(app.current_workspace_id()::text||':entity-relations',0));
  select * into d from app.entity_relation_definitions where workspace_id=app.current_workspace_id() and id=p_id for update;
 else
  select * into d from app.entity_relation_definitions where workspace_id=app.current_workspace_id() and id=p_id;
 end if;
 if not found then return null;end if;
 select jsonb_agg(jsonb_build_object('target_kind','entity_type','target_id',k::text,'access',case when p_write then 'write' else 'read' end) order by k)
 into requirements from(select distinct unnest(array[d.left_type_id,d.right_type_id]) k) q;
 perform app.authorize_workspace(requirements);
 perform set_config('request.workspace_requirements',
  (coalesce(nullif(current_setting('request.workspace_requirements',true),''),'[]')::jsonb||requirements)::text,true);
 return jsonb_build_object('id',d.id,'version',d.version,'archived',d.archived,'left_type_id',d.left_type_id,'left_label',d.left_label,'left_cardinality',d.left_cardinality,'right_type_id',d.right_type_id,'right_label',d.right_label,'right_cardinality',d.right_cardinality);
end $$;
revoke all on function app.business_relation_definitions(),app.business_relation_definition(uuid,boolean) from public,anon,authenticated,app_server,app_worker;
grant execute on function app.business_relation_definitions(),app.business_relation_definition(uuid,boolean) to app_user;
