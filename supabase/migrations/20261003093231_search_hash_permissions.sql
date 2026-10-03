-- 원본 RLS 문맥에서 현재 입력 해시를 비교하는 데 필요한 최소 schema/function 접근.
grant usage on schema extensions to app_user;
grant execute on function extensions.digest(text,text) to app_user;
