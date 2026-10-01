-- T02-1 실험 2: OAuth 서버가 발급한 MCP 토큰의 aud를 MCP 서버 URL로 바꿀 수 있는지 확인한다.
-- 격리 실험 전용이며 앱 migration이 아니다. URL은 로컬 실험 함수 주소다.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb := event -> 'claims';
begin
  if coalesce(claims ->> 'client_id', '') <> '' then
    claims := jsonb_set(claims, '{aud}', to_jsonb('http://127.0.0.1:55321/functions/v1/exp2-mcp'::text));
  end if;
  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
