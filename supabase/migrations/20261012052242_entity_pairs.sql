-- One owner-scoped unordered pair; historical links survive endpoint soft deletion.
create table app.entity_pairs (
 owner_id uuid not null references auth.users(id) on delete cascade,
 entity_id text not null,
 other_id text not null,
 created_at timestamptz not null default now(),
 primary key(owner_id,entity_id,other_id),
 constraint entity_pairs_canonical check(entity_id collate "C" < other_id collate "C"),
 foreign key(owner_id,entity_id) references app.entities(owner_id,id) on delete cascade,
 foreign key(owner_id,other_id) references app.entities(owner_id,id) on delete cascade
);
create index entity_pairs_other_endpoint on app.entity_pairs(owner_id,other_id,entity_id);
alter table app.entity_pairs enable row level security;
create policy entity_pairs_owner on app.entity_pairs for all to app_user
 using(owner_id=auth.uid()) with check(owner_id=auth.uid());
grant select,insert,delete on app.entity_pairs to app_user;

-- SECURITY INVOKER reads are already restricted to the authenticated Actor by entities_owner RLS.
-- Resolve the owner from that visible locked row without requesting extra auth schema grants.
create or replace function app.rekey_entity(old_id text,new_source text,new_external_id text) returns void
language plpgsql security invoker set search_path='' as $$
declare next_id text:=new_source||':'||new_external_id; entity_owner uuid; preserved_pairs jsonb;
begin
  select owner_id into entity_owner from app.entities where id=old_id and deleted_at is null for update;
  if not found then raise exception 'entity not found' using errcode='23503'; end if;
  select jsonb_agg(jsonb_build_object('peer',case when entity_id=old_id then other_id else entity_id end,'created_at',created_at)) into preserved_pairs from app.entity_pairs where owner_id=entity_owner and (entity_id=old_id or other_id=old_id);
  delete from app.entity_pairs where owner_id=entity_owner and (entity_id=old_id or other_id=old_id);
  update app.entities set id=next_id,source=new_source,external_id=new_external_id,version=version+1,updated_at=now()
    where owner_id=entity_owner and id=old_id;
  insert into app.entity_pairs(owner_id,entity_id,other_id,created_at)
    select entity_owner,least(next_id collate "C",p->>'peer' collate "C"),greatest(next_id collate "C",p->>'peer' collate "C"),(p->>'created_at')::timestamptz
    from jsonb_array_elements(coalesce(preserved_pairs,'[]'::jsonb)) p;
  update app.tasks t set entity_ids=array_replace(entity_ids,old_id,next_id),
    entity_context=app.rewrite_entity_refs(entity_context,old_id,next_id,true),version=version+1,updated_at=now()
    where owner_id=entity_owner and (old_id=any(entity_ids) or entity_context @> jsonb_build_array(jsonb_build_object('id',old_id)));
  update app.records r set entity_ids=array_replace(entity_ids,old_id,next_id),
    entity_context=app.rewrite_entity_refs(entity_context,old_id,next_id,true),
    change_metadata=app.rewrite_entity_refs(change_metadata,old_id,next_id,change_metadata->>'target_kind'='entity'),
    version=version+1,updated_at=now()
    where owner_id=entity_owner and (old_id=any(entity_ids) or entity_context @> jsonb_build_array(jsonb_build_object('id',old_id))
      or app.rewrite_entity_refs(change_metadata,old_id,next_id,change_metadata->>'target_kind'='entity') is distinct from change_metadata);
end $$;
