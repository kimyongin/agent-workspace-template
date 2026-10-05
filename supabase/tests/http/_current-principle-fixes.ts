// Shared assertions run separately through real HTTP and OAuth MCP transports.
import { assert, assertEquals } from "@std/assert";
import { admin } from "./_client.ts";

export type Invoke = (operation: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;

export async function currentPrincipleFixes(invoke: Invoke) {
  const marker = `review-${crypto.randomUUID()}`;
  const baseline = (await invoke("current", {})).current as { version: number; id: string } | null;
  const ids: string[] = [];
  let version = baseline?.version;
  let recordId: string | undefined;
  try {
    for (let n = 0; n < 3; n++) {
      const row = await invoke("save", {
        title: `${marker} ${n}`,
        summary: "context",
        body: "original",
        ...(version ? { expected_version: version, change_note: "next" } : {}),
      });
      ids.unshift(row.id as string);
      version = row.version as number;
    }
    const old = await invoke("get", { id: ids[2] });
    const queue =
      await admin`select message from pgmq.q_search_index where message->>'kind'='principle' and message->>'id'=${old
        .id as string} order by msg_id`;
    const count = async () =>
      (await admin`select count(*)::int n from app.records where change_metadata->>'target_id'=${old
        .id as string} and change_metadata->>'action'='update'`)[0].n;
    const beforeCount = await count();
    const memoInput = {
      id: old.id,
      expected_version: old.version,
      change_note: "corrected reason",
      request_id: crypto.randomUUID(),
    };
    const corrected = await invoke("correct", memoInput);
    assertEquals([corrected.title, corrected.summary, corrected.body, corrected.saved_at, corrected.is_current], [
      old.title,
      old.summary,
      old.body,
      old.saved_at,
      false,
    ]);
    assertEquals(corrected.change_note, "corrected reason");
    assertEquals(corrected.version, (old.version as number) + 1);
    assertEquals(await invoke("correct", memoInput), corrected);
    assertEquals(
      await invoke("correct", { id: old.id, expected_version: corrected.version, change_note: "corrected reason" }),
      corrected,
    );
    assertEquals(await count(), beforeCount + 1);
    assertEquals(
      await admin`select message from pgmq.q_search_index where message->>'kind'='principle' and message->>'id'=${old
        .id as string} order by msg_id`,
      queue,
    );

    for (const view of ["current", "history", "all"] as const) {
      const base = {
        query: marker,
        kinds: ["principle"],
        mode: "keyword",
        principle_view: view,
        limit: 1,
        anchor: { kind: "principle", id: old.id },
      };
      const expected = view === "current" ? ids.slice(0, 1) : view === "history" ? ids.slice(1) : ids;
      const ref = await invoke("search", base);
      for (const status of ["active", "inactive", "all"]) {
        const result = await invoke("search", { ...base, status });
        assertEquals(result, ref);
        assertEquals(result.anchor_page, view === "current" ? null : expected.length);
        // Coverage is account-wide within the filter, so verify exact transport parity above.
        assert((result.semantic_coverage as { pending: number }).pending >= expected.length);
        const found = (result.items as { id: string }[]).map((i) => i.id);
        let cursor = result.next_cursor;
        while (cursor) {
          const page = await invoke("search", { ...base, status, cursor });
          found.push(...(page.items as { id: string }[]).map((i) => i.id));
          cursor = page.next_cursor;
        }
        assertEquals(found, expected);
      }
      const alias = ({ current: "active", history: "inactive", all: "all" } as const)[view];
      assertEquals(await invoke("search", { ...base, principle_view: undefined, status: alias }), ref);
      if (ref.next_cursor) {
        assertEquals(
          await invoke("search", { ...base, principle_view: undefined, status: alias, cursor: ref.next_cursor }),
          await invoke("search", { ...base, cursor: ref.next_cursor }),
        );
      }
    }

    const record = await invoke("create_record", {
      title: marker,
      summary: "decision",
      applied_principle_ids: [old.id],
    });
    recordId = record.id as string;
    const snapshots = record.applied_principle_snapshots;
    await invoke("delete", { id: old.id, expected_version: corrected.version });
    ids.pop();
    const omitted = await invoke("update_record", {
      id: record.id,
      expected_version: record.version,
      body: "detail",
      change_note: "keep captured source",
    });
    assertEquals(omitted.applied_principle_ids, []);
    assertEquals(omitted.applied_principle_snapshots, snapshots);
    const clearInput = {
      id: record.id,
      expected_version: omitted.version,
      applied_principle_ids: [],
      change_note: "clear captured source",
      request_id: crypto.randomUUID(),
    };
    const cleared = await invoke("update_record", clearInput);
    assertEquals(cleared.applied_principle_snapshots, []);
    assertEquals(cleared.version, (omitted.version as number) + 1);
    assertEquals(await invoke("update_record", clearInput), cleared);
    assertEquals(
      await invoke("update_record", { ...clearInput, request_id: undefined, expected_version: cleared.version }),
      cleared,
    );
    const events = await admin`select change_metadata from app.records where change_metadata->>'target_id'=${record
      .id as string} and change_note='clear captured source'`;
    assertEquals(events.length, 0);
  } finally {
    if (recordId) {
      const row = await invoke("get_record", { id: recordId });
      await invoke("delete_record", { id: recordId, expected_version: row.version });
    }
    for (const id of ids) {
      const row = await invoke("get", { id });
      await invoke("delete", { id, expected_version: row.version });
    }
    assertEquals(((await invoke("current", {})).current as { id: string } | null)?.id ?? null, baseline?.id ?? null);
  }
}
