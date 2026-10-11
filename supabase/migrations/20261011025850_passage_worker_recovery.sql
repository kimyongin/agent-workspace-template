-- Exhausted unknown remains pending, with durable effect status explaining the hold.
CREATE OR REPLACE FUNCTION app.finish_search_index(p_message bigint, p_pipeline text, p_state text, p_reason text, p_chunks jsonb DEFAULT NULL::jsonb, p_delay integer DEFAULT 0)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare source jsonb; c jsonb; v extensions.vector; s integer; e integer; covered integer:=0;
  n integer:=0; o uuid; i text; body_length integer;
begin
  if p_state is null or p_state not in ('indexed','excluded','failed','retry','held')
    or (p_state='indexed' and (p_chunks is null or jsonb_typeof(p_chunks)<>'array' or jsonb_array_length(p_chunks)=0))
    or (p_state<>'indexed' and (p_reason is null or p_reason not in
      ('invalid_input','input_limit','configuration','retry_exhausted','transient','invalid_response','provider_unknown','unsupported_recovery','key_expired')))
    or p_delay not between 0 and 3600 then raise exception '잘못된 색인 결과' using errcode='22023'; end if;
  source:=app.prepare_search_index(p_message,p_pipeline);
  if source is null then return false; end if;
  if p_state='held' then
    update app.search_index_state set reason=p_reason,message_id=null,updated_at=now()
      where owner_id=(source->>'owner_id')::uuid and kind='record' and id=source->>'id';
    perform pgmq.archive('search_index',p_message); return true;
  end if;
  if p_state='retry' then perform pgmq.set_vt('search_index',p_message,p_delay); return true; end if;
  o:=(source->>'owner_id')::uuid; i:=(source->>'id')::text; body_length:=char_length(source->>'body');
  delete from app.search_chunks where owner_id=o and record_id=i;
  if p_state='indexed' then
    for c in select value from jsonb_array_elements(p_chunks) loop
      s:=(c->>'start')::integer; e:=(c->>'end')::integer; v:=(c->>'vector')::extensions.vector;
      if s is null or e is null or s<0 or s>covered or e<=s or e>body_length
        or v is null or extensions.vector_dims(v)<>1024 or extensions.vector_norm(v)=0 then
        raise exception '잘못된 본문 구간' using errcode='22023';
      end if;
      insert into app.search_chunks(owner_id,record_id,generation,ordinal,start_offset,end_offset,embedding)
        values(o,i,p_message,n,s,e,v);
      covered:=greatest(covered,e); n:=n+1;
    end loop;
    if covered<>body_length then raise exception '누락된 본문 구간' using errcode='22023'; end if;
  end if;
  update app.search_index_state set state=p_state,reason=p_reason,generation=case when p_state='indexed' then p_message end,
    message_id=null,updated_at=now() where owner_id=o and kind='record' and id=i;
  if p_state='indexed' then perform pgmq.delete('search_index',p_message);
  else perform pgmq.archive('search_index',p_message); end if;
  return true;
end $function$
;
