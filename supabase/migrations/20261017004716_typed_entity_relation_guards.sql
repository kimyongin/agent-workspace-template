-- app_user link writes share the same owner-first lock as definitions.
create trigger lock_entity_relation_link_owner before insert or delete on app.entity_relation_links for each statement execute function app.lock_entity_relation_owner();
create function app.guard_entity_relation_link() returns trigger language plpgsql security invoker set search_path='' as $$
declare link app.entity_relation_links%rowtype; d app.entity_relation_definitions%rowtype; kind record; left_kind uuid; right_kind uuid; left_deleted timestamptz; right_deleted timestamptz; left_archived boolean; right_archived boolean;
begin
 if tg_op='DELETE' then link:=old; else link:=new; end if;
 -- Account/explicit administrator cleanup has no Actor. RLS still denies unauthenticated app_user DML.
 if nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub' is null then
  if tg_op='DELETE' then return old; end if;
 end if;
 select * into d from app.entity_relation_definitions where owner_id=link.owner_id and id=link.definition_id for update;
 if not found then raise exception 'relation_definition_missing' using errcode='23503'; end if;
 for kind in select t.id,t.schema_write_locked from app.entity_types t where t.owner_id=link.owner_id and t.id in (d.left_type_id,d.right_type_id) order by t.id for update loop
  if kind.schema_write_locked then raise exception 'schema_migration_in_progress' using errcode='55000'; end if;
 end loop;
 perform 1 from app.entities e where e.owner_id=link.owner_id and e.id in (link.left_entity_id,link.right_entity_id) order by e.id collate "C" for update;
 if tg_op='DELETE' then return old; end if;
 select e.entity_type_id,e.deleted_at,coalesce((v.schema->>'deprecated')::boolean,false) into left_kind,left_deleted,left_archived from app.entities e join app.entity_types t on t.owner_id=e.owner_id and t.id=e.entity_type_id join app.entity_schema_versions v on v.owner_id=t.owner_id and v.type_id=t.id and v.schema_version=t.schema_version where e.owner_id=link.owner_id and e.id=link.left_entity_id;
 select e.entity_type_id,e.deleted_at,coalesce((v.schema->>'deprecated')::boolean,false) into right_kind,right_deleted,right_archived from app.entities e join app.entity_types t on t.owner_id=e.owner_id and t.id=e.entity_type_id join app.entity_schema_versions v on v.owner_id=t.owner_id and v.type_id=t.id and v.schema_version=t.schema_version where e.owner_id=link.owner_id and e.id=link.right_entity_id;
 if left_kind is null or right_kind is null then raise exception 'relation_endpoint_missing' using errcode='23503'; end if;
 if left_kind<>d.left_type_id or right_kind<>d.right_type_id or link.left_entity_id=link.right_entity_id then raise exception 'relation_endpoint_kind' using errcode='23514'; end if;
 if d.archived or left_deleted is not null or right_deleted is not null or left_archived or right_archived then raise exception 'relation_endpoint_inactive' using errcode='23514'; end if;
 if d.left_cardinality='one' and exists(select 1 from app.entity_relation_links where owner_id=link.owner_id and definition_id=link.definition_id and left_entity_id=link.left_entity_id) or d.right_cardinality='one' and exists(select 1 from app.entity_relation_links where owner_id=link.owner_id and definition_id=link.definition_id and right_entity_id=link.right_entity_id) then raise exception 'relation_single_occupied' using errcode='23505'; end if;
 return new;
end $$;
revoke all on function app.guard_entity_relation_link() from public;
create trigger guard_entity_relation_link before insert or delete on app.entity_relation_links for each row execute function app.guard_entity_relation_link();

create or replace function app.entity_schema_reference_baseline(p_owner uuid,p_type uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object(
 'typed_links',coalesce((select jsonb_agg(jsonb_build_array(l.definition_id,l.left_entity_id,l.right_entity_id,l.created_at,d.version) order by l.definition_id,l.left_entity_id collate "C",l.right_entity_id collate "C") from app.entity_relation_links l join app.entity_relation_definitions d on d.owner_id=l.owner_id and d.id=l.definition_id where l.owner_id=p_owner and exists(select 1 from app.entities e where e.owner_id=p_owner and e.entity_type_id=p_type and e.id in (l.left_entity_id,l.right_entity_id))),'[]'::jsonb),
 'pairs',coalesce((select jsonb_agg(jsonb_build_array(p.entity_id,p.other_id,p.created_at) order by p.entity_id collate "C",p.other_id collate "C") from app.entity_pairs p where p.owner_id=p_owner and exists(select 1 from app.entities e where e.owner_id=p_owner and e.entity_type_id=p_type and e.id in (p.entity_id,p.other_id))),'[]'::jsonb),
 'tasks',coalesce((select jsonb_agg(jsonb_build_array(t.id,t.entity_ids,t.entity_context) order by t.id collate "C") from app.tasks t where t.owner_id=p_owner and exists(select 1 from app.entities e where e.owner_id=p_owner and e.entity_type_id=p_type and e.id=any(t.entity_ids))),'[]'::jsonb),
 'records',coalesce((select jsonb_agg(jsonb_build_array(r.id,r.task_id,r.entity_ids,r.entity_context) order by r.id collate "C") from app.records r where r.owner_id=p_owner and r.record_kind<>'change' and exists(select 1 from app.entities e where e.owner_id=p_owner and e.entity_type_id=p_type and e.id=any(r.entity_ids))),'[]'::jsonb))
$$;
