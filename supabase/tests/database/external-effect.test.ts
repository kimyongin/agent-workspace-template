import type postgres from "postgres";
import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import {
  SqlEffectStatusReader,
  SqlExternalEffectLedger,
} from "../../functions/_shared/adapters/supabase/external-effect.ts";
import { SqlIndexQueue } from "../../functions/_shared/adapters/supabase/index-queue.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { recordCreate, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";
import {
  type ActiveEffectClaim,
  executePassageEffect,
  type PassageEffectInput,
  type PassageProvider,
} from "../../functions/_shared/core/search/external-effect.ts";
import { searchInputHash } from "../../functions/_shared/core/shared/operations.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { requestActor } from "../_request.ts";
import { asUser, connect, dbTest, fixtureOwner, outcome, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 }), user = connect(urls.pooler, { max: 3, prepare: false });
const workerUrl = new URL(urls.pooler);
workerUrl.username = "app_worker.pooler-dev";
workerUrl.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
const worker = connect(workerUrl.href, { max: 3, prepare: false });
const queue = new SqlIndexQueue(worker), ledger = new SqlExternalEffectLedger(worker);
const fixture = await fixtureOwner(admin), foreign = await fixtureOwner(admin), actor = fixture.actor;
const deps = {
  uow: new SqlUnitOfWork(user),
  clock: { now: () => new Date() },
  effectStatus: new SqlEffectStatusReader(user),
};
const vector = Array.from({ length: 1024 }, (_, n) => n === 0 ? 1 : 0);
async function job(text = "원문은 비밀이며 effect에는 저장하지 않는다", who = actor) {
  const record = await activity.createRecord(deps, requestActor(who), recordCreate.parse({ body: text }));
  const [claim] = await queue.claim({ limit: 1, owner_id: who.userId, kind: "record", id: record.id });
  const input: PassageEffectInput = {
    message_id: claim.msg_id,
    pipeline: SEARCH_PIPELINE,
    provider_scope: "a".repeat(64),
    model: "llama-text-embed-v2",
    dimensions: 1024,
    start: 0,
    end: [...text].length,
    input_hash: await searchInputHash(text),
  };
  return { record, input, text };
}
const status = (id: string) => activity.getRecordIndexEffects(deps, actor, id);
// Fault injection only: move the durable lease/backoff clock; assertions use public use cases.
async function release(effectId: string) {
  await admin`update private.passage_effects set lease_until=now()-interval '1 second',next_attempt_at=now()-interval '1 second' where id=${effectId}::uuid`;
}
function active(claim: Awaited<ReturnType<typeof ledger.claim>>): ActiveEffectClaim {
  if (!("fence" in claim)) throw Error("expected active claim");
  return claim;
}

dbTest("external effects: competing workers, saved success survives queue ack failure", async () => {
  const a = await job();
  const started = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
  const sentTexts: string[] = [];
  const provider: PassageProvider = {
    send: async (text) => {
      sentTexts.push(text);
      started.resolve();
      await finish.promise;
      return { state: "succeeded", vector };
    },
  };
  const first = executePassageEffect(ledger, provider, a.input, a.text);
  await started.promise;
  assertEquals(await executePassageEffect(ledger, provider, a.input, a.text), { state: "busy" });
  finish.resolve();
  assertEquals(await first, { state: "succeeded", vector });
  assertEquals((await status(a.record.id))[0].state, "succeeded");
  // Inject an actual DB ack failure, scoped to this fixture's message only.
  const functionName = `effect_ack_${crypto.randomUUID().replaceAll("-", "")}`;
  await admin.unsafe(
    `create function private.${functionName}() returns trigger language plpgsql as $$ begin if old.msg_id=${a.input.message_id} then raise exception 'injected_ack_failure'; end if; return old; end $$`,
  );
  await admin.unsafe(
    `create trigger ${functionName} before delete on pgmq.q_search_index for each row execute function private.${functionName}()`,
  );
  try {
    await assertRejects(() =>
      queue.finish(a.input.message_id, SEARCH_PIPELINE, "indexed", null, [{
        start: 0,
        end: a.input.end,
        text: a.text,
        vector,
      }])
    );
    assertEquals(await executePassageEffect(ledger, provider, a.input, a.text), { state: "succeeded", vector });
    assertEquals(sentTexts.length, 1);
  } finally {
    await admin.unsafe(`drop trigger ${functionName} on pgmq.q_search_index`);
    await admin.unsafe(`drop function private.${functionName}()`);
  }
  assertEquals(
    await queue.finish(a.input.message_id, SEARCH_PIPELINE, "indexed", null, [{
      start: 0,
      end: a.input.end,
      text: a.text,
      vector,
    }]),
    true,
  );
  const b = await job();
  await executePassageEffect(ledger, provider, b.input, b.text);
  assertEquals(sentTexts.length, 2);
});

dbTest(
  "external effects: death before/after call, lease recovery fences old worker and preserves attempts",
  async () => {
    const a = await job();
    const first = active(await ledger.claim(a.input));
    // Death before send still consumes the reserved send budget; recovery cannot prove no call occurred.
    await release(first.effect_id);
    const second = active(await ledger.claim(a.input));
    assertEquals(second.attempts, 2);
    assertEquals(await ledger.complete(first, { state: "succeeded", vector }), false);
    // Death after the provider accepts: no success was recorded. Recovery consumes the remaining bounded sends.
    await release(second.effect_id);
    const sentTexts: string[] = [];
    const result = await executePassageEffect(
      ledger,
      {
        send: (text) => {
          sentTexts.push(text);
          return Promise.resolve({ state: "succeeded", vector });
        },
      },
      a.input,
      a.text,
    );
    assertEquals(result.state, "succeeded");
    assertEquals(sentTexts, [a.text]);
    assertEquals((await status(a.record.id))[0].attempts, 3);
  },
);

dbTest(
  "external effects: timeout stays unknown, backoff blocks immediate resend and status excludes secrets",
  async () => {
    const a = await job();
    let sends = 0;
    const provider: PassageProvider = {
      send: () => {
        sends++;
        throw Error(`secret credential ${a.text}`);
      },
    };
    assertEquals(await executePassageEffect(ledger, provider, a.input, a.text), {
      state: "unknown",
      reason: "provider_unknown",
      attempts: 1,
    });
    const [effect] = await status(a.record.id);
    assertEquals(await executePassageEffect(ledger, provider, a.input, a.text), { state: "busy" });
    assertEquals(sends, 1);
    await release(effect.effect_id);
    assertEquals(await executePassageEffect(ledger, provider, a.input, a.text), {
      state: "unknown",
      reason: "provider_unknown",
      attempts: 2,
    });
    const visible = JSON.stringify(await status(a.record.id));
    assertEquals(visible.includes("secret"), false);
    assertEquals(visible.includes(a.text), false);
  },
);

dbTest(
  "external effects: success storage failure remains uncertain; bounded recomputation exhausts at five",
  async () => {
    const a = await job();
    let sends = 0;
    const provider: PassageProvider = {
      send: () => {
        sends++;
        return Promise.resolve({ state: "succeeded", vector });
      },
    };
    const failingSave = {
      claim: ledger.claim.bind(ledger),
      complete: (claim: ActiveEffectClaim, result: Parameters<typeof ledger.complete>[1]) =>
        worker.begin(async (tx) => {
          await new SqlExternalEffectLedger(tx as unknown as postgres.Sql).complete(claim, result);
          throw Error("injected_storage_failure_before_commit");
        }),
    };
    await assertRejects(() => executePassageEffect(failingSave, provider, a.input, a.text));
    const id = (await status(a.record.id))[0].effect_id;
    await release(id);
    assertEquals((await status(a.record.id))[0].state, "unknown");
    provider.send = () => {
      sends++;
      return Promise.resolve({ state: "unknown", reason: "provider_unknown" });
    };
    for (let attempt = 2; attempt <= 5; attempt++) {
      const r = await executePassageEffect(ledger, provider, a.input, a.text);
      assertEquals(r, { state: "unknown", reason: "provider_unknown", attempts: attempt });
      await release(id);
    }
    assertEquals(await executePassageEffect(ledger, provider, a.input, a.text), {
      state: "unknown",
      reason: "retry_exhausted",
      attempts: 5,
    });
    assertEquals(sends, 5);
  },
);

dbTest(
  "external effects: confirmed failures retry only when transient; source deletion/revision and owner access",
  async () => {
    const a = await job();
    const provider: PassageProvider = {
      send: () => Promise.resolve({ state: "failed", reason: "configuration" }),
    };
    assertEquals((await executePassageEffect(ledger, provider, a.input, a.text)).state, "failed");
    assertEquals((await executePassageEffect(ledger, provider, a.input, a.text)).state, "failed");
    const foreignError = await assertRejects(
      () => activity.getRecordIndexEffects(deps, foreign.actor, a.record.id),
      AppError,
    );
    assertEquals(foreignError.code, "not_found");
    await activity.updateRecord(
      deps,
      requestActor(actor),
      a.record.id,
      recordUpdate.parse({ expected_version: 1, body: a.text, occurred_at: "2025-01-01T00:00:00.000Z" }),
    );
    assertEquals(await status(a.record.id), []);
    // The same pending message now binds to the new record revision.
    assertEquals(
      (await executePassageEffect(
        ledger,
        { send: () => Promise.resolve({ state: "succeeded", vector }) },
        a.input,
        a.text,
      )).state,
      "succeeded",
    );
    const b = await job();
    const claimed = active(await ledger.claim(b.input));
    await activity.deleteRecord(deps, requestActor(actor), b.record.id, 1);
    assertEquals(await ledger.complete(claimed, { state: "succeeded", vector }), false);
    assertEquals((await ledger.claim(b.input)).action, "stale");
    // Retention is checked at the DB storage boundary: pending/running/unknown never age out with the source.
    assertEquals((await admin`select id from private.passage_effects where id=${claimed.effect_id}::uuid`).length, 1);
    await activity.deleteRecord(deps, requestActor(actor), a.record.id, 2);
    assertEquals(
      (await admin`select e.id from private.passage_effects e where e.record_id=${a.record.id}`)
        .length,
      0,
    );
    for (const role of ["anon", "authenticated", "app_user", "app_worker"]) {
      assertMatch(
        await outcome(admin.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx`select * from private.passage_effects`;
        })),
        /^42501/,
      );
    }
    assertMatch(
      await outcome(
        asUser(
          user,
          actor.userId,
          (tx) => tx`select app.claim_passage_effect(1,'p','s','m',1024,0,1,'h')`,
        ),
      ),
      /^42501/,
    );
  },
);

dbTest("external effects: definite transient failures retain backoff and stop after five sends", async () => {
  const a = await job();
  const sentTexts: string[] = [];
  const provider: PassageProvider = {
    send: (text) => {
      sentTexts.push(text);
      return Promise.resolve({ state: "failed", reason: "transient" });
    },
  };
  for (let attempts = 1; attempts <= 5; attempts++) {
    assertEquals(await executePassageEffect(ledger, provider, a.input, a.text), {
      state: "failed",
      reason: "transient",
      attempts,
    });
    await release((await status(a.record.id))[0].effect_id);
  }
  assertEquals(await executePassageEffect(ledger, provider, a.input, a.text), {
    state: "failed",
    reason: "retry_exhausted",
    attempts: 5,
  });
  assertEquals(sentTexts.length, 5);
});

dbTest("external effects: local record, request result, queue roll back together", async () => {
  let recordId = "";
  const failingDeps = {
    ...deps,
    uow: {
      run: <T>(who: typeof actor, fn: Parameters<typeof deps.uow.run<T>>[1]) =>
        deps.uow.run(who, async (store) => {
          const result = await fn(store);
          recordId = (result as { id: string }).id;
          throw Error("injected_local_transaction_failure");
        }),
    },
  };
  await assertRejects(() =>
    activity.createRecord(failingDeps, requestActor(actor), recordCreate.parse({ body: "rolled back" }))
  );
  assertEquals(
    (await admin`select id from private.passage_effects where owner_id=${actor.userId} and record_id=${recordId}`)
      .length,
    0,
  );
  const missing = await assertRejects(() => activity.getRecord(deps, actor, recordId), AppError);
  assertEquals(missing.code, "not_found");
  assertEquals(await queue.claim({ limit: 1, owner_id: actor.userId, kind: "record", id: recordId }), []);
});

dbTest("external effects: account cascade removes effects/results and rejects remaining actor", async () => {
  const owned = await fixtureOwner(admin);
  const ownedJob = await job("cascade", owned.actor);
  const ownedClaim = active(await ledger.claim(ownedJob.input));
  await ledger.complete(ownedClaim, { state: "succeeded", vector });
  await owned.cleanup();
  assertEquals((await admin`select id from private.passage_effects where id=${ownedClaim.effect_id}::uuid`).length, 0);
  assertEquals(
    (await admin`select id from private.passage_effects where owner_id=${owned.actor.userId}`).length,
    0,
  );
  const error = await assertRejects(
    () => activity.getRecordIndexEffects(deps, owned.actor, ownedJob.record.id),
    AppError,
  );
  assertEquals(error.code, "unauthenticated");
});

dbTest("external-effect fixture cleanup", async () => {
  await fixture.cleanup();
  await foreign.cleanup();
});
