// contracts(정본)와 DB CHECK의 판정이 같은지, DB 컬럼과 contracts 응답 필드가 같은지 확인한다.
// 형식 검사만 본다. 소유자 격리는 isolation.test.ts가 맡는다.
import { assertEquals } from "@std/assert";
import type { z } from "zod";
import { recordCreate, recordResult } from "../../functions/_shared/contracts/record.ts";
import { principleCreate, principleResult } from "../../functions/_shared/contracts/principle.ts";
import { taskCreate, taskResult } from "../../functions/_shared/contracts/task.ts";
import { connect, dbTest, devUsers, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const { a: A } = await devUsers(admin);

/** 한 행을 넣어 보고 롤백한다. CHECK·NOT NULL 위반이면 false. */
async function dbAccepts(table: "tasks" | "records" | "principles", row: Record<string, unknown>): Promise<boolean> {
  try {
    await admin.begin(async (tx) => {
      await tx`insert into ${tx("app." + table)} ${tx({ owner_id: A, ...row })}`;
      throw new Error("rollback");
    });
  } catch (e) {
    if ((e as Error).message === "rollback") return true;
    const code = (e as { code?: string }).code;
    if (code === "23514" || code === "23502") return false;
    throw e;
  }
  return true;
}

function contractAccepts(schema: z.ZodType, value: unknown): boolean {
  return schema.safeParse({ id: crypto.randomUUID(), ...(value as Record<string, unknown>) }).success;
}

const boundaries = (field: "title" | "body", max: number, min: number) => [
  { name: `${field} ${max}자`, value: "가".repeat(max) },
  { name: `${field} ${max + 1}자`, value: "가".repeat(max + 1) },
  ...(min > 0 ? [{ name: `${field} 빈 값`, value: "" }] : []),
];
const record = { title: "제목", body: "" };
const onceTask = { kind: "once", title: "제목", body: "" };
for (const [field, max, min] of [["title", 100, 1], ["body", 22000, 0]] as const) {
  for (const b of boundaries(field, max, min)) {
    dbTest(`할 일 parity: ${b.name}`, async () => {
      const input = { ...onceTask, [field]: b.value };
      assertEquals(await dbAccepts("tasks", { ...input, status: "open" }), contractAccepts(taskCreate, input));
    });
    dbTest(`원칙 parity: ${b.name}`, async () => {
      const input = { title: "제목", body: "", [field]: b.value };
      assertEquals(await dbAccepts("principles", input), contractAccepts(principleCreate, input));
    });
    if (field === "body") {
      dbTest(`기록 parity: ${b.name}`, async () => {
        const input = { body: b.value };
        assertEquals(await dbAccepts("records", input), contractAccepts(recordCreate, input));
      });
    }
  }
}
dbTest("새 기록은 빈 본문을 거부하며 DB는 기존 빈 원문 보존을 허용한다", async () => {
  assertEquals(contractAccepts(recordCreate, { body: "" }), false);
  assertEquals(await dbAccepts("records", { body: "" }), true);
});

dbTest("할 일 parity: 선택지 밖의 종류", async () => {
  const input = { ...onceTask, kind: "someday" };
  assertEquals(await dbAccepts("tasks", { ...input, status: "open" }), contractAccepts(taskCreate, input));
});

dbTest("할 일 parity: 반복 할 일에 규칙·시간대가 없으면 거부", async () => {
  const input = { ...onceTask, kind: "recurring" };
  assertEquals(await dbAccepts("tasks", { ...input, status: "active" }), contractAccepts(taskCreate, input));
});

async function columns(table: string): Promise<string[]> {
  const rows = await admin<{ column_name: string }[]>`
    select column_name from information_schema.columns where table_schema = 'app' and table_name = ${table}`;
  return rows.map((r) => r.column_name).filter((c) => c !== "owner_id").sort();
}

dbTest("할 일: DB 컬럼(owner_id 제외)과 contracts 응답 필드가 같다", async () => {
  assertEquals(await columns("tasks"), Object.keys(taskResult.shape).filter((k) => k !== "tag_ids").sort());
});

dbTest("기록: DB 컬럼(owner_id 제외)과 contracts 응답 필드가 같다", async () => {
  assertEquals(
    (await columns("records")).map((k) => k === "change_metadata" ? "change" : k).sort(),
    Object.keys(recordResult.shape).filter((k) => k !== "tag_ids").sort(),
  );
});

dbTest("원칙: legacy fields rejected by current input and retired DB aliases and current result columns", async () => {
  assertEquals(
    principleCreate.safeParse({ id: crypto.randomUUID(), ...{ ...record, applies_when: "legacy" } }).success,
    false,
  );
  assertEquals(
    principleCreate.safeParse({ id: crypto.randomUUID(), ...{ ...record, entity_id: crypto.randomUUID() } }).success,
    false,
  );
  assertEquals(principleCreate.safeParse({ id: crypto.randomUUID(), ...{ ...record, tag_ids: [] } }).success, false);
  assertEquals(await columns("principles"), Object.keys(principleResult.shape).sort());
});
