-- CLI-generated timestamp was behind147; ordered after that migration.
-- Analysis success cannot override immutable identifier or relationship conflicts.
begin;
CREATE OR REPLACE FUNCTION private.refresh_workspace_model_analysis(p_workspace uuid, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid:=p_workspace;v_group app.data_model_changes%rowtype;v_status text;v_pending boolean;v_failed boolean;
begin
 perform private.lock_data_model_owner(v_owner);
 select * into v_group from app.data_model_changes g where g.workspace_id=v_owner and g.id=p_id for update;
 if not found or v_group.status not in ('analyzing','needs_conversion','ready') then return;end if;
 select coalesce(bool_or(a.status in ('queued','running')),false),coalesce(bool_or(a.status='failed' or a.failed>0 or d.status='stale'),false) into v_pending,v_failed
 from app.data_model_children c join app.entity_schema_analyses a on a.workspace_id=c.workspace_id and a.id=c.analysis_id join app.entity_schema_changes d on d.workspace_id=c.workspace_id and d.id=c.change_id where c.workspace_id=v_owner and c.model_id=p_id;
 v_failed:=v_failed or exists(select 1 from jsonb_array_elements(v_group.plan->'review'->'items') item where item->>'kind'='conflict');
 v_status:=case when v_pending then 'analyzing' when v_failed then 'needs_conversion' else 'ready' end;
 update app.data_model_changes g set status=v_status,version=g.version+case when g.status<>v_status then 1 else 0 end,
 plan=jsonb_set(g.plan,'{review,can_apply}',to_jsonb(v_status='ready')),updated_at=now() where g.workspace_id=v_owner and g.id=p_id;
end $function$
;
commit;
