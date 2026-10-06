-- MCP는 Auth와 같은 Supabase 프로젝트의 표준 Edge Function 주소를 사용한다.
-- Auth가 생성한 issuer만 사용한다. 사용자 metadata나 OAuth 요청의 resource는 읽지 않는다.
create or replace function private.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  claims jsonb := event -> 'claims';
  issuer text := claims ->> 'iss';
  mcp_audience text;
begin
  if coalesce(claims ->> 'client_id', '') = '' then
    return event;
  end if;
  if issuer is null or issuer !~ '^https?://[^/?#@[:space:]]+/auth/v1$' then
    raise exception 'invalid Auth issuer';
  end if;
  mcp_audience := left(issuer, length(issuer) - length('/auth/v1')) || '/functions/v1/mcp';
  return jsonb_set(event, '{claims}', jsonb_set(claims, '{aud}', to_jsonb(mcp_audience)));
end;
$$;

revoke execute on function private.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function private.custom_access_token_hook(jsonb) to supabase_auth_admin;
drop table private.auth_settings;
