# 과거 스키마에서의 업그레이드 검증

이 디렉터리는 특정 predecessor 스키마에서 실행하는 검사다. 현재 스키마의 `test:db`와 분리한다. 적용된 과거 migration을
바꾸거나 사용 중인 로컬·운영 DB를 reset하지 않는다.

`remove-legacy-tables.test.ts`는 소유한 격리 DB `127.0.0.1:56122` 또는 `127.0.0.1:56222`를 사용한다.
`20261006200000_preserve_deleted_task_context.sql`까지 적용하고 `setup:local -- --skip-functions`로 준비한 뒤 실행한다:

```powershell
npx deno test --config supabase/functions/deno.json --allow-env --allow-net --allow-read --env-file=.env.local supabase/tests/migrations/remove-legacy-tables.test.ts
```

긴 원본·당시 캡처·사용자 삭제·편집·미이관 자료를 준비하고 새 migration의 SQL을 실제 트랜잭션에서 검증한다. 해당 DDL은
의도적으로 rollback하며 fixture 계정만 정리한다. 통과 후 CLI로 새 migration을 적용하고 현행 DB·HTTP·MCP 검사를 실행한다.
새 DB에 전체 migration을 순서대로 적용하는 검증도 별도로 수행한다.

`current-principle.ts`·`retire-unused.ts`는 이전 전환 단계의 predecessor 검사다. 파일에 명시된 격리 DB와 prepare/verify
단계를 사용하며 최신 스키마에서 실행하지 않는다.
