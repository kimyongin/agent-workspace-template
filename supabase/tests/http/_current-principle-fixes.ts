// Current contract parity; archived fixture sources remain read-only data.
import { assertEquals } from "@std/assert";
import { admin } from "./_client.ts";
export type Invoke = (operation: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
export async function currentPrincipleFixes(invoke: Invoke) {
  const marker = `review-${crypto.randomUUID()}`,
    baseline = (await invoke("current", {})).current as { id: string; version: number } | null;
  let current: Record<string, unknown> | undefined, record: Record<string, unknown> | undefined;
  const ids: string[] = [];
  try {
    if (baseline) await admin`update app.principles set is_current=false where id=${baseline.id}`;
    current = await invoke("create", { title: marker, body: "원문" });
    ids.push(current.id as string);
    const [owner] = await admin`select owner_id from app.principles where id=${current.id as string}`;
    const [archive] =
      await admin`insert into app.principles(owner_id,title,body,is_current,origin) values(${owner.owner_id},${marker},'과거 원문',false,'legacy') returning id`;
    ids.push(archive.id);
    const saved = await invoke("update", {
      id: current.id,
      title: marker,
      body: "새 원문",
      expected_version: current.version,
    });
    assertEquals(saved.id, current.id);
    current = saved;
    assertEquals(await invoke("get", { id: current.id }), current);
    const found = await invoke("search", { query: marker, kinds: ["principle"], mode: "keyword" });
    assertEquals((found.items as { id: string }[]).map((r) => r.id), [current.id]);
    record = await invoke("create_record", { body: "판단 메모" });
    const snapshot = [{
      id: archive.id,
      title: "당시 제목",
      summary: "당시 요약",
      body: "당시 원문",
      version: 1,
      saved_at: "2020-01-02T00:00:00.000Z",
      status: "inactive",
      captured_at: "migration",
    }];
    await admin`update app.records set applied_principle_snapshots=${admin.json(snapshot)} where id=${record
      .id as string}`;
    const old = await invoke("get_record", { id: record.id });
    const count = (await admin`select count(*)::int n from app.records where owner_id=${owner.owner_id}`)[0].n;
    const patch = { id: record.id, expected_version: old.version, body: "메모 정정" };
    const edited = await invoke("update_record", patch);
    assertEquals(edited.applied_principle_snapshots, snapshot);
    assertEquals((await invoke("retry_record", patch)).code, "conflict");
    record = edited;
    assertEquals((await admin`select count(*)::int n from app.records where owner_id=${owner.owner_id}`)[0].n, count);
  } finally {
    if (record) await invoke("delete_record", { id: record.id, expected_version: record.version });
    await admin`delete from app.principles where id in ${admin(ids)}`;
    if (baseline) await admin`update app.principles set is_current=true where id=${baseline.id}`;
  }
}
