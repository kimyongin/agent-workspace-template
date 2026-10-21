begin;
set local lock_timeout='5s';

-- Pure validation, with no data lookup or authorization expansion.
create or replace function app.entity_title_definition_valid(p_schema jsonb) returns boolean
language plpgsql immutable parallel safe security invoker set search_path='' as $function$
declare v_template text;v_match text[];v_key text;
 v_whitespace constant text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
 if p_schema is null or jsonb_typeof(p_schema) is distinct from 'object'
  or jsonb_typeof(p_schema->'properties') is distinct from 'object'
  or jsonb_typeof(p_schema->'x-title-template') is distinct from 'string' then return false;end if;
 v_template:=p_schema->>'x-title-template';
 if char_length(v_template)>4096 or btrim(v_template,v_whitespace)='' then return false;end if;
 if exists(select 1 from jsonb_each(p_schema->'properties') f
  where jsonb_typeof(f.value)<>'object' or f.value ?| array['x-representative','x-show-in-list','x-list-order']) then return false;end if;
 if strpos(regexp_replace(v_template,'\$\{[^$]*?\$\}|\$\$|\$[^$]*?\$','','g'),'$')>0 then return false;end if;
 for v_match in select regexp_matches(v_template,'\$\{([^$]*?)\$\}|\$\$|\$([^$]*?)\$','g') loop
  v_key:=coalesce(v_match[1],v_match[2]);
  if v_key is null then continue;end if;
  if v_key!~'^prop_[1-9][0-9]*$' or not(p_schema->'properties' ? v_key)
   or coalesce((p_schema->'properties'->v_key->>'deprecated')::boolean,false) then return false;end if;
 end loop;
 return true;
exception when invalid_text_representation then return false;
end $function$;
revoke all on function app.entity_title_definition_valid(jsonb) from public,anon,authenticated;
grant execute on function app.entity_title_definition_valid(jsonb) to app_user,app_worker;

-- A quiescent barrier preserves every durable execution input and fingerprint.
lock table app.entity_types,app.entity_schema_versions,app.entity_schema_changes,
 app.entity_schema_analyses,app.entity_schema_migrations,app.data_model_changes in share row exclusive mode;
do $cutover$
declare r record;v_schema jsonb;v_template text;v_representatives text[];
begin
 if exists(select 1 from app.entity_types where workspace_id is not null and schema_write_locked)
  or exists(select 1 from app.entity_schema_analyses where workspace_id is not null and status in ('queued','running'))
  or exists(select 1 from app.entity_schema_changes where workspace_id is not null and status='analyzing')
  or exists(select 1 from app.entity_schema_migrations where workspace_id is not null and status in ('queued','preparing','ready_to_commit','committing'))
  or exists(select 1 from app.data_model_changes where workspace_id is not null and status in ('analyzing','queued','preparing','ready_to_commit','committing')) then
  raise exception 'entity_title_cutover_requires_quiescent_workers' using errcode='55000';
 end if;
 create temporary table entity_title_cutover_targets(workspace_id uuid,type_id uuid,source_version integer,schema jsonb) on commit drop;
 for r in select t.workspace_id,t.id,t.schema_version,v.schema from app.entity_types t
  join app.entity_schema_versions v on v.workspace_id=t.workspace_id and v.type_id=t.id and v.schema_version=t.schema_version
  where t.workspace_id is not null order by t.workspace_id,t.id loop
  v_schema:=r.schema;
  if v_schema ? 'x-title-template' then
   if jsonb_typeof(v_schema->'x-title-template')<>'string' then raise exception 'entity_title_cutover_invalid_template' using errcode='22023';end if;
   v_template:=v_schema->>'x-title-template';
  else
   select array_agg(key order by key) into v_representatives from jsonb_each(v_schema->'properties')
    where value->'x-representative'='true'::jsonb;
   if cardinality(v_representatives) is distinct from 1 then raise exception 'entity_title_cutover_invalid_representative' using errcode='22023';end if;
   v_template:='$'||v_representatives[1]||'$';
  end if;
  v_schema:=jsonb_set(v_schema,'{properties}',(select jsonb_object_agg(key,value-array['x-representative','x-show-in-list','x-list-order']) from jsonb_each(v_schema->'properties')));
  v_schema:=v_schema||jsonb_build_object('x-title-template',v_template);
  if not app.entity_title_definition_valid(v_schema) then raise exception 'entity_title_cutover_invalid_template' using errcode='22023';end if;
  if v_schema=r.schema then continue;end if;
  if r.schema_version>=2147483647 then raise exception 'entity_title_cutover_version_limit' using errcode='54000';end if;
  v_schema:=v_schema||jsonb_build_object('x-type-id',r.id,'x-version',r.schema_version+1);
  if octet_length(v_schema::text)>262144 then raise exception 'entity_title_cutover_size_limit' using errcode='54000';end if;
  insert into entity_title_cutover_targets values(r.workspace_id,r.id,r.schema_version,v_schema);
 end loop;
 -- Only after every target is validated do we publish immutable forward versions.
 for r in select * from entity_title_cutover_targets order by workspace_id,type_id loop
  perform set_config('request.workspace_id',r.workspace_id::text,true);
  insert into app.entity_schema_versions(workspace_id,schema) values(r.workspace_id,r.schema);
  update app.entity_types set schema_version=r.source_version+1,updated_at=now()
   where workspace_id=r.workspace_id and id=r.type_id and schema_version=r.source_version;
 end loop;
end $cutover$;

-- Historical rows remain immutable; only future workspace-scoped definitions use this guard.
create or replace function private.guard_entity_title_definition() returns trigger
language plpgsql security invoker set search_path='' as $function$
begin
 if new.workspace_id is not null and not app.entity_title_definition_valid(new.schema) then
  raise exception 'entity_title_definition_invalid' using errcode='23514';
 end if;
 return new;
end $function$;
revoke all on function private.guard_entity_title_definition() from public,anon,authenticated,app_user,app_server,app_worker;
drop trigger if exists entity_title_definition on app.entity_schema_versions;
create trigger entity_title_definition before insert on app.entity_schema_versions
 for each row execute function private.guard_entity_title_definition();

-- A pure projection: callers retain their existing workspace/row authorization.
create or replace function app.entity_title(p_schema jsonb,p_properties jsonb,p_fallback text)
returns text language plpgsql immutable parallel safe security invoker set search_path='' as $function$
declare
 v_template text:=p_schema->>'x-title-template';v_key text;v_field jsonb;v_raw jsonb;v_choice text;
 v_position integer:=1;v_open integer;v_start integer;v_end integer;v_legacy boolean;
 v_value text;v_result text:='';v_has_content boolean:=false;
 v_whitespace constant text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
 while v_position<=char_length(v_template) loop
  v_open:=strpos(substr(v_template,v_position),'$');
  if v_open=0 then
   v_value:=substr(v_template,v_position);v_position:=char_length(v_template)+1;
  elsif v_open>1 then
   v_value:=substr(v_template,v_position,v_open-1);v_position:=v_position+v_open-1;
  elsif substr(v_template,v_position,2)='$$' then
   v_value:='$';v_position:=v_position+2;
  else
   v_legacy:=substr(v_template,v_position,2)='${';
   v_start:=v_position+case when v_legacy then 2 else 1 end;
   v_end:=strpos(substr(v_template,v_start),case when v_legacy then '$}' else '$' end);
   if v_end=0 then exit;end if;
   v_key:=substr(v_template,v_start,v_end-1);
   v_position:=v_start+v_end-1+case when v_legacy then 2 else 1 end;
   v_field:=p_schema->'properties'->v_key;v_raw:=p_properties->v_key;
   select item->>'title' into v_choice from jsonb_array_elements(
    case when jsonb_typeof(v_field->'oneOf')='array' then v_field->'oneOf' else '[]'::jsonb end
   ) item where item->'const'=v_raw and item ? 'title' limit 1;
   if found then v_value:=v_choice;
   elsif jsonb_typeof(v_raw)='boolean' then v_value:=case when v_raw='true'::jsonb then '예' else '아니오' end;
   elsif jsonb_typeof(v_raw)='number' then
    v_value:=v_raw#>>'{}';
    -- JSONB can retain numeric scale; JavaScript's validated Number projection does not.
    if v_value::numeric=0 then v_value:='0';
    elsif strpos(v_value,'.')>0 then v_value:=rtrim(rtrim(v_value,'0'),'.');end if;
   elsif jsonb_typeof(v_raw)='string' then v_value:=v_raw#>>'{}';
   else v_value:='';end if;
  end if;
  v_has_content:=v_has_content or btrim(v_value,v_whitespace)<>'';
  -- Keep at most one overflow code point while still inspecting later parts for fallback.
  v_result:=left(v_result||v_value,4097);
 end loop;
 if not v_has_content then v_result:=coalesce(p_fallback,'');end if;
 return case when char_length(v_result)>4096 then left(v_result,4095)||'…' else v_result end;
end $function$;
revoke all on function app.entity_title(jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function app.entity_title(jsonb,jsonb,text) to app_user,app_worker;


commit;
