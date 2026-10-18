import { assertEquals, assertRejects } from "@std/assert";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { SqlActorStore } from "../../functions/_shared/adapters/supabase/sql-context.ts";
import { replayRetainedSqlRequest } from "../../functions/_shared/adapters/supabase/request-ledger.ts";
import { asUser, connect, dbTest, urls } from "./_db.ts";
import { businessWorkspaceFixture } from "./_workspace-business.ts";

const admin = connect(urls.admin, { max: 1 });
const user = connect(urls.direct, { max: 1, prepare: false });

dbTest(
  "business request execution and retained replay reject missing workspace before accessing any legacy receipt",
  async () => {
    const fixture = await businessWorkspaceFixture(admin, user);
    try {
      const actor = { userId: fixture.manager.userId };
      const request = { key: crypto.randomUUID(), operation: "task.create", fingerprint: "b".repeat(64) };
      let executions = 0;
      const execute = () =>
        asUser(
          user,
          actor.userId,
          (tx) => new SqlActorStore(tx, actor).executeRequest(request, () => Promise.resolve(++executions)),
        );
      assertEquals((await assertRejects(execute, AppError)).code, "invalid_input");
      assertEquals(executions, 0);
      assertEquals(
        (await assertRejects(
          () => asUser(user, actor.userId, (tx) => replayRetainedSqlRequest(tx, actor, request)),
          AppError,
        )).code,
        "invalid_input",
      );
      assertEquals(
        (await admin`select count(*)::int n from private.request_results where owner_id=${actor.userId}`)[0].n,
        0,
      );
    } finally {
      await fixture.cleanup();
    }
  },
);

dbTest(
  "current database retires owner-only request executables while preserving historical receipt storage",
  async () => {
    const [functions] = await admin`select to_regprocedure('app.begin_request(uuid,text,text)')::text as begin,
    to_regprocedure('app.finish_request(uuid,jsonb)')::text as finish,
    to_regprocedure('app.replay_retained_request(uuid,text,text)')::text as replay,
    to_regclass('private.request_results')::text as history`;
    assertEquals(functions, { begin: null, finish: null, replay: null, history: "private.request_results" });
  },
);
