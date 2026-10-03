-- T02-2: OAuth 클라이언트(MCP)용 토큰의 aud를 MCP 서버의 정식 URL로 바꾼다(T02-1 실험 2에서 채택).
-- 웹 세션 토큰(client_id 없음)은 그대로 aud=authenticated. 두 진입점은 각자의 audience만 받는다(ADR-0006).
-- MCP URL은 환경마다 다르므로 private.auth_settings에 둔다. 로컬은 scripts/local-setup.mjs, 호스팅은 배포 절차에서 넣는다.

create schema if not exists private;
revoke all on schema private from public;

create table private.auth_settings (
  key text primary key,
  value text not null
);
revoke all on private.auth_settings from public, anon, authenticated;

create function private.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb := event -> 'claims';
  mcp_audience text;
begin
  if coalesce(claims ->> 'client_id', '') = '' then
    return event;
  end if;
  select value into mcp_audience from private.auth_settings where key = 'mcp_audience';
  -- 설정이 없으면 OAuth 클라이언트 토큰 발급을 막는다(aud=authenticated로 웹 API를 여는 토큰을 만들지 않는다).
  if mcp_audience is null then
    raise exception 'mcp_audience is not configured';
  end if;
  return jsonb_set(event, '{claims}', jsonb_set(claims, '{aud}', to_jsonb(mcp_audience)));
end;
$$;

grant usage on schema private to supabase_auth_admin;
grant select on private.auth_settings to supabase_auth_admin;
grant execute on function private.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function private.custom_access_token_hook(jsonb) from public, anon, authenticated;
