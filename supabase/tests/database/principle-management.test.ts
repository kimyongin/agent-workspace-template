import { assertEquals, assertRejects } from "@std/assert";
import { SqlPrincipleUnitOfWork } from "../../functions/_shared/adapters/supabase/principle-store.ts";
import { principleCreate, principleStatus, principleUpdate } from "../../functions/_shared/contracts/principle.ts";
import {
  createPrinciple,
  deletePrinciple,
  getPrinciple,
  setPrincipleStatus,
  updatePrinciple,
} from "../../functions/_shared/core/principles/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { connect, dbTest, devUsers, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { max: 3, prepare: false });
const users = await devUsers(admin), A = { userId: users.a }, B = { userId: users.b };
const deps = { uow: new SqlPrincipleUnitOfWork(sql) };
const create = (actor = A) =>
  createPrinciple(deps, actor, principleCreate.parse({ title: "판단 근거", summary: "기준을 기록" }));
dbTest("원칙 관리: 버전 경쟁·본문 색인 억제·제목 재색인·소유자 격리", async () => {
  const p = await create();
  const outcomes = await Promise.allSettled(
    [1, 2].map((i) =>
      updatePrinciple(deps, A, p.id, principleUpdate.parse({ expected_version: 1, body: `근거 ${i}` }))
    ),
  );
  assertEquals(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assertEquals((await admin`select msg_id from pgmq.q_search_index where message->>'id'=${p.id}`).length, 1);
  const current = await getPrinciple(deps, A, p.id);
  await updatePrinciple(deps, A, p.id, principleUpdate.parse({ expected_version: current.version, title: "새 표현" }));
  assertEquals((await admin`select msg_id from pgmq.q_search_index where message->>'id'=${p.id}`).length, 1);
  await assertRejects(
    () => updatePrinciple(deps, B, p.id, principleUpdate.parse({ expected_version: 3, title: "탈취" })),
    AppError,
  );
});
dbTest("원칙 관리: 대체 참조 격리·상태 전환·삭제 연결 해제·오래된 버전 거부", async () => {
  const old = await create(), replacement = await create(), foreign = await create(B);
  for (const target of [old.id, foreign.id, crypto.randomUUID()]) {
    await assertRejects(
      () =>
        setPrincipleStatus(
          deps,
          A,
          old.id,
          principleStatus.parse({ expected_version: 1, status: "inactive", replaced_by_id: target }),
        ),
      AppError,
    );
  }
  const inactive = await setPrincipleStatus(
    deps,
    A,
    old.id,
    principleStatus.parse({ expected_version: 1, status: "inactive", replaced_by_id: replacement.id }),
  );
  assertEquals(inactive.replaced_by_id, replacement.id);
  await assertRejects(() => deletePrinciple(deps, A, old.id, 1), AppError);
  const cleared = await setPrincipleStatus(
    deps,
    A,
    old.id,
    principleStatus.parse({ expected_version: 2, status: "inactive", replaced_by_id: null }),
  );
  assertEquals(cleared.replaced_by_id, null);
  const active = await setPrincipleStatus(
    deps,
    A,
    old.id,
    principleStatus.parse({ expected_version: 3, status: "active" }),
  );
  assertEquals(active.replaced_by_id, null);
  await setPrincipleStatus(
    deps,
    A,
    old.id,
    principleStatus.parse({ expected_version: 4, status: "inactive", replaced_by_id: replacement.id }),
  );
  await deletePrinciple(deps, A, replacement.id, 1);
  assertEquals((await getPrinciple(deps, A, old.id)).replaced_by_id, null);
  await deletePrinciple(deps, A, old.id, 6);
  await assertRejects(() => getPrinciple(deps, A, old.id), AppError);
});
