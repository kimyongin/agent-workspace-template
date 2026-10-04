-- Preserve legacy documents and connections. No fictional historical change events.
alter table app.tags add column scope text not null default 'activity' check(scope in ('entity','activity'));
drop index app.tags_owner_name;
create unique index tags_owner_name on app.tags(owner_id,scope,lower(name));
create table app.entity_tags (
  owner_id uuid not null references auth.users(id) on delete cascade,
  entity_id uuid not null,
  tag_id uuid not null,
  primary key(entity_id,tag_id),
  foreign key(entity_id,owner_id) references app.entities(id,owner_id) on delete cascade,
  foreign key(tag_id,owner_id) references app.tags(id,owner_id) on delete cascade
);
alter table app.entity_tags enable row level security;
create policy entity_tags_owner on app.entity_tags to app_user
  using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
revoke all on app.entity_tags from public,anon,authenticated;
grant select,insert,update,delete on app.entity_tags to app_user;

alter table app.principles
  add column is_current boolean not null default false,
  add column saved_at timestamptz(3),
  add column change_note text check(change_note is null or char_length(btrim(change_note)) between 1 and 1000),
  add column origin text not null default 'legacy' check(origin in ('legacy','saved')),
  add column legacy_context jsonb;
update app.principles p set saved_at=created_at,
  legacy_context=jsonb_build_object('entity_id',entity_id,'applies_when',applies_when,'status',status,'replaced_by_id',replaced_by_id,
    'tag_ids',coalesce((select jsonb_agg(pt.tag_id) from app.principle_tags pt where pt.principle_id=p.id),'[]'::jsonb),
    'tags',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name)) from app.principle_tags pt join app.tags t on t.id=pt.tag_id where pt.principle_id=p.id),'[]'::jsonb));
update app.principles p set is_current=true where id in (
  select distinct on(owner_id) id from app.principles where status='active' order by owner_id,created_at desc,id desc
);
alter table app.principles alter column saved_at set not null, alter column saved_at set default clock_timestamp(), alter column origin set default 'saved';
create unique index principles_one_current on app.principles(owner_id) where is_current;
create index principles_saved on app.principles(owner_id,saved_at desc,id desc);

-- Owner revision survives deleting the last document, preventing stale version reuse after promotion/recreation.
create table app.principle_versions (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  version integer not null check(version > 0)
);
alter table app.principle_versions enable row level security;
create policy principle_versions_owner on app.principle_versions to app_user
  using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
revoke all on app.principle_versions from public,anon,authenticated;
grant select,insert,update on app.principle_versions to app_user;
insert into app.principle_versions(owner_id,version) select owner_id,max(version) from app.principles group by owner_id;

alter table app.records
  add column record_kind text not null default 'user' check(record_kind in ('user','result','change')),
  add column change_note text check(change_note is null or char_length(btrim(change_note)) between 1 and 1000),
  add column change_metadata jsonb,
  add column applied_principle_snapshots jsonb not null default '[]'::jsonb;
update app.records set record_kind='result' where task_id is not null;
-- This preserves the migration-time source, rather than inventing an application-time revision.
update app.records r set applied_principle_snapshots=coalesce((
  select jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'summary',p.summary,'body',p.body,
    'version',p.version,'status',p.status,'saved_at',p.saved_at,'captured_at','migration'))
  from app.record_principles rp join app.principles p on p.id=rp.principle_id where rp.record_id=r.id
),'[]'::jsonb);
create index records_kind on app.records(owner_id,record_kind,occurred_at desc,id desc);

-- Enforce scope on direct app_user linking too; legacy principle links are retained read-only.
create function private.check_tag_scope() returns trigger language plpgsql security invoker
set search_path='' as $$
declare wanted text;
begin
  wanted := case when tg_table_name='entity_tags' then 'entity' else 'activity' end;
  if not exists(select 1 from app.tags where id=new.tag_id and owner_id=new.owner_id and scope=wanted) then
    raise exception 'tag scope mismatch' using errcode='23503';
  end if;
  return new;
end $$;
revoke all on function private.check_tag_scope() from public,anon,authenticated;
create trigger entity_tag_scope before insert or update on app.entity_tags for each row execute function private.check_tag_scope();
create trigger task_tag_scope before insert or update on app.task_tags for each row execute function private.check_tag_scope();
create trigger record_tag_scope before insert or update on app.record_tags for each row execute function private.check_tag_scope();
revoke insert,update,delete on app.principle_tags from app_user;
