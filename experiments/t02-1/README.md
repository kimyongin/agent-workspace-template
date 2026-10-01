# T02-1 실험: 트랜잭션과 MCP OAuth

[Template-02 T02-1](../../docs/tickets/template-02-implementation-base.md) 작업 9의 격리 실험이다. 결과와 채택 판단은 [T02-1 실험 결과](../../docs/tickets/template-02-t02-1-contracts.md#실험-결과-작업-9)에 있다. 앱 코드가 아니다.

| 실험 | 확인 내용 | 파일 |
| --- | --- | --- |
| 1 | 직접 Postgres 트랜잭션의 Actor 문맥 전달, RLS, 연결 재사용 시 문맥 해제, 원본 저장과 `pgmq.send`의 원자성, 일반 사용자 직접 쓰기 차단 | `exp1.mjs`, `exp1-negative.mjs`, `supabase/functions/exp1-edge/`, `supabase/migrations/*_exp1.sql` |
| 2 | Supabase OAuth 2.1 서버의 동적 등록·PKCE, Custom Access Token Hook으로 MCP 토큰 `aud` 변경, 웹·MCP 토큰의 교차 사용 거부 | `exp2-flow.mjs`, `supabase/functions/exp2-mcp/`, `supabase/functions/exp2-api/`, `supabase/migrations/*_exp2.sql`, `consent/` |

## 준비

필요한 도구: Docker, Supabase CLI(2.98.2에서 확인), Node 22 이상, Python 3(동의 화면 정적 서버).

포트는 다른 로컬 Supabase 프로젝트와 겹치지 않게 55320~55329(Supabase), 55380(동의 화면), 55390(실험 2 callback), 8183(Edge inspector)을 쓴다.

이 폴더에서 실행한다. 서명 키는 비밀값이라 커밋하지 않으며 `supabase start` 전에 만들어야 한다.

```bash
npm install
supabase gen signing-key --algorithm ES256 > supabase/signing_keys.json
node -e "const fs=require('fs');const f='supabase/signing_keys.json';const v=JSON.parse(fs.readFileSync(f,'utf8'));fs.writeFileSync(f,JSON.stringify(Array.isArray(v)?v:[v]))"
supabase start -x studio,imgproxy,vector,logflare,mailpit
```

## 실험 1 실행

```bash
npm run exp1
node exp1-negative.mjs
```

`npm run exp1`은 모든 항목이 PASS여야 한다. `exp1-negative.mjs`는 일부러 세션 단위 설정을 써서 `DETECTED leak`을 출력해야 정상이다(검사가 누출을 잡는지 확인하는 대조 실험).

Edge Runtime 확인은 다른 터미널에서 함수를 띄운 뒤 호출한다. 응답의 `direct`와 `pooler-transaction` 모두 `forged`가 `42501`, `rolledBack`이 `true`, `contextAfter.u`가 `app_server`여야 한다.

```bash
supabase functions serve exp1-edge --no-verify-jwt
```

```bash
curl http://127.0.0.1:55321/functions/v1/exp1-edge
```

## 실험 2 준비

로컬 공개 키·JWKS와 시험 계정을 git에서 제외되는 파일에 만든다.

```bash
JWKS=$(curl -s http://127.0.0.1:55321/auth/v1/.well-known/jwks.json)
PUB=$(supabase status -o env | grep -E '^PUBLISHABLE_KEY=' | cut -d= -f2- | tr -d '"')
SECRET=$(supabase status -o env | grep -E '^SECRET_KEY=' | cut -d= -f2- | tr -d '"')
printf 'SUPABASE_JWKS=%s\nSUPABASE_PUBLISHABLE_KEY=%s\n' "$JWKS" "$PUB" > .env.functions
printf 'EXP_PUBLISHABLE_KEY=%s\nEXP_SECRET_KEY=%s\nEXP_USER_EMAIL=exp-a@example.test\nEXP_USER_PASSWORD=%s\n' "$PUB" "$SECRET" "$(node -e 'console.log(require("crypto").randomBytes(18).toString("base64url"))')" > .env.local
printf 'export const SUPABASE_URL = "http://127.0.0.1:55321";\nexport const PUBLISHABLE_KEY = "%s";\n' "$PUB" > consent/config.js
. ./.env.local
curl -s -X POST http://127.0.0.1:55321/auth/v1/admin/users -H "apikey: $EXP_SECRET_KEY" -H "Authorization: Bearer $EXP_SECRET_KEY" -H "Content-Type: application/json" -d "{\"email\":\"$EXP_USER_EMAIL\",\"password\":\"$EXP_USER_PASSWORD\",\"email_confirm\":true}"
```

동의 화면과 함수를 각각 다른 터미널에서 띄운다.

```bash
python -m http.server 55380 --bind 127.0.0.1 --directory consent
```

```bash
supabase functions serve --no-verify-jwt --env-file .env.functions
```

## 실험 2 실행

스크립트가 `authorize-url.txt`에 인가 주소를 쓰고 승인을 기다린다. 그 주소를 브라우저로 열어 `.env.local`의 시험 계정으로 로그인하고 승인하면 결과가 출력된다. 모든 항목이 PASS여야 한다.

```bash
node exp2-flow.mjs
```

실제 클라이언트 확인:

- Claude Code: `claude mcp add --transport http exp2 http://127.0.0.1:55321/functions/v1/exp2-mcp` 후 `claude`에서 `/mcp`로 인증하고 `whoami` 도구를 호출한다. 응답의 `aud`가 MCP URL이고 `client_id`가 있어야 한다.
- Codex: 사용자 설정과 분리하려면 임시 `CODEX_HOME`을 지정하고 `codex mcp add exp2 --url http://127.0.0.1:55321/functions/v1/exp2-mcp`를 실행한다. 브라우저 승인 후 `Successfully logged in`이 나와야 한다.

## 정리

```bash
supabase stop
```

데이터까지 지우려면 `supabase stop --no-backup`을 쓴다. Claude Code에 추가한 서버는 `claude mcp remove exp2`, 임시 `CODEX_HOME`은 폴더째 지운다.
