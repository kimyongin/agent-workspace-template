-- Definition metadata remains settings-only. Stored assignment changes resolve
-- their actual kinds before checking usage and share the trusted replay footprint.
do $$
declare definition text;insertion text;
begin
 select pg_get_functiondef('private.guard_identity_definition()'::regprocedure) into definition;
 insertion:=E'begin\n if tg_table_name=''entity_identifier_rules'' then\n if new.workspace_id is not null\n'
  ||E'  and new.meaning is distinct from old.meaning and old.source<>''app'' then\n'
  ||E'  perform private.authorize_workspace_model_kinds(array(select distinct type_id from app.entity_type_identity_sources\n'
  ||E'   where workspace_id=old.workspace_id and rule_id=old.id));\n end if;\n end if;\n';
 if strpos(definition,E'begin\n')=0 or strpos(definition,'referenced_rule_immutable')=0 then
  raise exception 'unexpected_identity_definition_guard';end if;
 execute replace(definition,E'begin\n',insertion);

 select pg_get_functiondef('private.guard_type_identity_source()'::regprocedure) into definition;
 insertion:=E'begin\n if tg_op=''DELETE'' then\n'
  ||E'  if old.workspace_id is not null and exists(select 1 from app.entity_types where workspace_id=old.workspace_id and id=old.type_id) then\n'
  ||E'   perform private.authorize_workspace_model_kinds(array[old.type_id]);\n  end if;\n'
  ||E' elsif old.workspace_id is not null and (new.rule_id is distinct from old.rule_id or old.referenced and not new.referenced) then\n'
  ||E'  perform private.authorize_workspace_model_kinds(array[old.type_id]);\n end if;\n';
 if strpos(definition,E'begin\n')=0 or strpos(definition,'referenced_mapping_immutable')=0 then
  raise exception 'unexpected_identity_source_guard';end if;
 execute replace(definition,E'begin\n',insertion);
end $$;
