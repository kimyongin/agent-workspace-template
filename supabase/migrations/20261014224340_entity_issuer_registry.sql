-- Owner-scoped reusable issuers, rules and independently versioned type identity.
create table app.entity_issuers (
 owner_id uuid not null references auth.users(id) on delete cascade,
 code text not null check(code ~ '^[a-z][a-z0-9_-]{0,31}$'),
 label text not null check(length(btrim(label)) between 1 and 100),
 active boolean not null default true, system boolean not null default false,
 version integer not null default 1 check(version>0), primary key(owner_id,code),
 check(system=(code='app')), check(code<>'app' or active)
);
create table app.entity_identifier_rules (
 owner_id uuid not null references auth.users(id) on delete cascade,id uuid not null default gen_random_uuid(),source text not null,
 label text not null check(length(btrim(label)) between 1 and 100),
 meaning text not null check(length(btrim(meaning)) between 1 and 500),
 generation text not null check(generation in ('automatic','direct')),
 active boolean not null default true,version integer not null default 1 check(version>0),
 primary key(owner_id,id),unique(owner_id,source,id),
 foreign key(owner_id,source) references app.entity_issuers(owner_id,code),
 check((source='app' and generation='automatic' and active and id='00000000-0000-4000-8000-000000000001'::uuid) or (source<>'app' and generation='direct'))
);
create table app.entity_type_identity (
 owner_id uuid not null,type_id uuid not null,label text not null default '번호' check(length(btrim(label)) between 1 and 100),
 default_source text not null,version integer not null default 1 check(version>0),
 primary key(owner_id,type_id),foreign key(owner_id,type_id) references app.entity_types(owner_id,id) on delete cascade,
 foreign key(owner_id,default_source) references app.entity_issuers(owner_id,code)
);
create table app.entity_type_identity_sources (
 owner_id uuid not null,type_id uuid not null,code text not null,rule_id uuid not null,
 active boolean not null default true,referenced boolean not null default false,
 primary key(owner_id,type_id,code),
 foreign key(owner_id,type_id) references app.entity_type_identity(owner_id,type_id) on delete cascade,
 foreign key(owner_id,code,rule_id) references app.entity_identifier_rules(owner_id,source,id)
);
alter table app.entity_type_identity add foreign key(owner_id,type_id,default_source)
 references app.entity_type_identity_sources(owner_id,type_id,code) deferrable initially deferred;
create index entity_identity_rule_references on app.entity_type_identity_sources(owner_id,rule_id);

-- Copy each owner's real sources, including sources retained in deleted entity rows.
insert into app.entity_issuers(owner_id,code,label,active,system)
select owner_id,'app','앱',true,true from app.entity_types group by owner_id;
update app.entity_issuers i set label=x->>'label' from app.user_business_settings s cross join lateral jsonb_array_elements(s.settings->'sources') x where s.owner_id=i.owner_id and s.id='entity_identity' and i.code='app' and x->>'code'='app';
insert into app.entity_issuers(owner_id,code,label,active,system)
select s.owner_id,x->>'code',x->>'label',not coalesce((x->>'deleted')::boolean,false),false
from app.user_business_settings s cross join lateral jsonb_array_elements(s.settings->'sources') x
where s.id='entity_identity' and x->>'code'<>'app' on conflict do nothing;
insert into app.entity_issuers(owner_id,code,label,active,system)
select distinct owner_id,source,source,true,false from app.entities where source<>'app' on conflict do nothing;
insert into app.entity_identifier_rules(owner_id,id,source,label,meaning,generation)
select owner_id,'00000000-0000-4000-8000-000000000001','app','자동 발급','앱이 발급한 자료 번호','automatic' from app.entity_issuers where code='app';
insert into app.entity_identifier_rules(owner_id,source,label,meaning,generation,active)
select owner_id,code,'원본 번호','발급처가 관리하는 원본 번호','direct',active from app.entity_issuers where code<>'app';
insert into app.entity_type_identity(owner_id,type_id,label,default_source)
select t.owner_id,t.id,'번호',case when exists(select 1 from app.entity_issuers i where i.owner_id=t.owner_id and i.code=s.settings->>'default_source' and i.active) then s.settings->>'default_source' else 'app' end
from app.entity_types t left join app.user_business_settings s on s.owner_id=t.owner_id and s.id='entity_identity';
insert into app.entity_type_identity_sources(owner_id,type_id,code,rule_id,active,referenced)
select t.owner_id,t.type_id,r.source,r.id,r.active,
 exists(select 1 from app.entities e where e.owner_id=t.owner_id and e.entity_type_id=t.type_id and e.source=r.source)
from app.entity_type_identity t join app.entity_identifier_rules r on r.owner_id=t.owner_id;

alter table app.entity_issuers enable row level security;
alter table app.entity_identifier_rules enable row level security;
alter table app.entity_type_identity enable row level security;
alter table app.entity_type_identity_sources enable row level security;
revoke all on app.entity_issuers,app.entity_identifier_rules,app.entity_type_identity,app.entity_type_identity_sources from public,anon,authenticated;
grant select,insert,update on app.entity_issuers,app.entity_identifier_rules,app.entity_type_identity to app_user;
grant select,insert,update,delete on app.entity_type_identity_sources to app_user;
create policy issuer_owner on app.entity_issuers for all to app_user using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy identifier_rule_owner on app.entity_identifier_rules for all to app_user using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy type_identity_owner on app.entity_type_identity for all to app_user using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy type_identity_source_owner on app.entity_type_identity_sources for all to app_user using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));

create function private.guard_identity_definition() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='entity_issuers' then
  if new.owner_id<>old.owner_id or new.code<>old.code or new.system<>old.system then raise exception 'issuer_code_immutable' using errcode='23514'; end if;
 end if;
 if tg_table_name='entity_identifier_rules' then
  if new.owner_id<>old.owner_id or new.id<>old.id or new.source<>old.source or new.generation<>old.generation then raise exception 'rule_identity_immutable' using errcode='23514'; end if;
  if new.meaning<>old.meaning and (old.source='app' or exists(select 1 from app.entity_type_identity_sources s where s.owner_id=old.owner_id and s.rule_id=old.id and s.referenced)) then raise exception 'referenced_rule_immutable' using errcode='23514'; end if;
 end if;
 return new;
end $$;
create trigger issuer_definition_guard before update on app.entity_issuers for each row execute function private.guard_identity_definition();
create trigger identifier_rule_definition_guard before update on app.entity_identifier_rules for each row execute function private.guard_identity_definition();
create function private.guard_type_identity_source() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then
  if old.referenced and exists(select 1 from app.entity_types where owner_id=old.owner_id and id=old.type_id) then raise exception 'referenced_mapping_immutable' using errcode='23514'; end if;return old;
 end if;
 if new.owner_id<>old.owner_id or new.type_id<>old.type_id or new.code<>old.code or (old.referenced and (not new.referenced or new.rule_id<>old.rule_id)) then raise exception 'referenced_mapping_immutable' using errcode='23514'; end if;
 return new;
end $$;
create trigger type_identity_source_guard before update or delete on app.entity_type_identity_sources for each row execute function private.guard_type_identity_source();
create function private.mark_entity_identity_reference() returns trigger language plpgsql set search_path='' as $$
begin
 update app.entity_type_identity_sources set referenced=true where owner_id=new.owner_id and type_id=new.entity_type_id and code=new.source and not referenced;
 if not exists(select 1 from app.entity_type_identity_sources where owner_id=new.owner_id and type_id=new.entity_type_id and code=new.source) then raise exception 'identity_source_missing' using errcode='23503';end if;
 return new;
end $$;
create trigger entity_identity_reference after insert or update of entity_type_id,source on app.entities for each row execute function private.mark_entity_identity_reference();
create function private.check_identity_default_active() returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from app.entity_type_identity t join app.entity_type_identity_sources s on s.owner_id=t.owner_id and s.type_id=t.type_id and s.code=t.default_source join app.entity_issuers i on i.owner_id=s.owner_id and i.code=s.code join app.entity_identifier_rules r on r.owner_id=s.owner_id and r.id=s.rule_id where t.owner_id=new.owner_id and not(s.active and i.active and r.active)) then raise exception 'identity_default_inactive' using errcode='23514';end if;
 return new;
end $$;
create constraint trigger identity_default_active after insert or update on app.entity_type_identity deferrable initially deferred for each row execute function private.check_identity_default_active();
create constraint trigger identity_mapping_default_active after insert or update on app.entity_type_identity_sources deferrable initially deferred for each row execute function private.check_identity_default_active();
create constraint trigger identity_issuer_default_active after update on app.entity_issuers deferrable initially deferred for each row execute function private.check_identity_default_active();
create constraint trigger identity_rule_default_active after update on app.entity_identifier_rules deferrable initially deferred for each row execute function private.check_identity_default_active();
revoke all on function private.guard_identity_definition(),private.guard_type_identity_source(),private.mark_entity_identity_reference(),private.check_identity_default_active() from public,anon,authenticated;

-- Prepared entity registration is bound to effective type identity settings.
-- Presentation label edits do not change number meaning; active/meaning edits do.
create function private.bump_type_identity_configuration() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='entity_issuers' then
  if new.active is distinct from old.active then
   update app.entity_type_identity t set version=version+1 where t.owner_id=new.owner_id
    and exists(select 1 from app.entity_type_identity_sources s where s.owner_id=t.owner_id and s.type_id=t.type_id and s.code=new.code);
  end if;
 elsif tg_table_name='entity_identifier_rules' then
  if new.active is distinct from old.active or new.meaning is distinct from old.meaning then
   update app.entity_type_identity t set version=version+1 where t.owner_id=new.owner_id
    and exists(select 1 from app.entity_type_identity_sources s where s.owner_id=t.owner_id and s.type_id=t.type_id and s.rule_id=new.id);
  end if;
 end if;
 return new;
end $$;
create trigger issuer_effective_configuration after update on app.entity_issuers for each row execute function private.bump_type_identity_configuration();
create trigger rule_effective_configuration after update on app.entity_identifier_rules for each row execute function private.bump_type_identity_configuration();
revoke all on function private.bump_type_identity_configuration() from public,anon,authenticated;
