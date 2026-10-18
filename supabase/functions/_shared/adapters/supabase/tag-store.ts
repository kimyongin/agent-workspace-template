import { compareEntityIds } from "./entity-relation-locks.ts";
import { searchInputHash } from "../../core/shared/operations.ts";
import { authorizeWorkspace, requireWorkspaceActor, runInWorkspace } from "./workspace-context.ts";
import { AppError, invalidInput, notFound } from "../../core/shared/errors.ts";
import type { TagConnectionInput } from "../../contracts/tag-connection.ts";
import type { TagEntry } from "../../core/tags/application.ts";
import { loadBusinessEntityDefinition } from "./entity-values.ts";
import { insertWithIdRetry } from "./data-id.ts";
import type postgres from "postgres";
import type { TagResult } from "../../contracts/tag.ts";
import type { TagStore, TagUse } from "../../core/tags/application.ts";
import type { Actor } from "../../core/shared/actor.ts";
import type { Keyset } from "../../core/shared/store.ts";
import { conflict } from "../../core/shared/errors.ts";
import { SqlActorStore } from "./sql-context.ts";
import { SqlEntityStore } from "./entity-store.ts";
import { SqlTagTargets } from "./tag-targets.ts";
import { setTagLinks } from "./tag-links.ts";
const toTag = (r: Record<string, unknown>): TagResult => ({
  scope: r.scope as TagResult["scope"],
  id: r.id as string,
  name: r.name as string,
  version: r.version as number,
  created_at: (r.created_at as Date).toISOString(),
  updated_at: (r.updated_at as Date).toISOString(),
});
class SqlTagStore extends SqlActorStore implements TagStore {
  private get workspaceId() {
    return requireWorkspaceActor(this.actor).workspaceId;
  }
  async connectionTarget(input: TagConnectionInput): Promise<TagUse | null> {
    if (input.target_kind !== "entity") throw invalidInput("지원하지 않는 태그 연결 대상입니다");
    const value = await new SqlEntityStore(this.tx, this.actor).get(input.target_id, true);
    return value ? { kind: "entity", value } : null;
  }
  private deletionTargets?: { entity: string[]; task: string[]; record: string[] };
  private async targetIds(id: string) {
    const result = { entity: [] as string[], task: [] as string[], record: [] as string[] };
    for (const kind of ["entity", "task", "record"] as const) {
      const rows = await this.tx`select ${this.tx(`${kind}_id`)} id from ${this.tx(`app.${kind}_tags`)}
        where workspace_id=${this.workspaceId} and tag_id=${id}`;
      result[kind] = rows.map((row) => String(row.id)).sort(compareEntityIds);
    }
    return result;
  }
  private async deletionTypeIds(id: string) {
    const rows = await this.tx<{ entity_type_id: string }[]>`select distinct e.entity_type_id from app.entities e
      where e.workspace_id=${this.workspaceId} and e.id in (
        select entity_id from app.entity_tags where workspace_id=${this.workspaceId} and tag_id=${id}
        union select r.entity_id from app.records r join app.record_tags l on l.workspace_id=r.workspace_id and l.record_id=r.id
          where l.workspace_id=${this.workspaceId} and l.tag_id=${id} and r.entity_id is not null)`;
    return rows.map((row) => row.entity_type_id).sort();
  }
  async prepareDelete(id: string) {
    // The UoW has already authorized the complete server-resolved footprint.
    // Lock known targets before the dictionary; its FK key lock then prevents
    // new connections, and a second ID-only snapshot detects arrivals safely.
    for (const typeId of await this.deletionTypeIds(id)) await loadBusinessEntityDefinition(this.tx, typeId, true);
    this.deletionTargets = await this.targetIds(id);
    const entities = new SqlEntityStore(this.tx, this.actor), activity = new SqlTagTargets(this.tx, this.actor);
    for (const item of this.deletionTargets.entity) if (!await entities.get(item, true)) throw notFound();
    for (const item of this.deletionTargets.task) if (!await activity.task(item)) throw notFound();
    for (const item of this.deletionTargets.record) {
      if (!await activity.record(item, true)) throw notFound();
    }
  }
  async get(id: string, lock = false) {
    const [r] = await this.tx`select * from app.tags where workspace_id=${this.workspaceId} and id=${id} ${
      lock ? this.tx`for update` : this.tx``
    }`;
    if (
      lock && this.deletionTargets && JSON.stringify(await this.targetIds(id)) !== JSON.stringify(this.deletionTargets)
    ) {
      throw conflict("태그 연결이 변경되었습니다. 최신 상태에서 다시 삭제하세요");
    }
    return r ? toTag(r) : null;
  }
  async unique(fn: () => Promise<Record<string, unknown>[]>) {
    try {
      return toTag((await fn())[0]);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw conflict("같은 ID 또는 이름의 태그가 있습니다");
      throw e;
    }
  }
  async insert(name: string, scope: TagResult["scope"]) {
    return toTag(
      await insertWithIdRetry(() =>
        this.tx`insert into app.tags(workspace_id,name,scope) values (${this.workspaceId},${name},${scope})
      on conflict (id) do nothing returning *`
      ),
    );
  }
  rename(id: string, name: string) {
    return this.unique(() =>
      this
        .tx`update app.tags set name=${name},version=version+1,updated_at=now() where workspace_id=${this.workspaceId} and id=${id} returning *`
    );
  }
  async *uses(_id: string): AsyncIterable<TagUse> {
    const entities = new SqlEntityStore(this.tx, this.actor), activity = new SqlTagTargets(this.tx, this.actor);
    if (!this.deletionTargets) throw invalidInput("태그 삭제 대상을 먼저 확인하세요");
    for (const id of this.deletionTargets.entity) {
      const value = await entities.get(id);
      if (value) yield { kind: "entity", value };
    }
    for (const id of this.deletionTargets.task) {
      const value = await activity.task(id);
      if (value) yield { kind: "task", value };
    }
    for (const id of this.deletionTargets.record) {
      const value = await activity.record(id);
      if (value) yield { kind: "record", value };
    }
  }
  async setTags(use: TagUse, tag_ids: string[]): Promise<TagUse> {
    if (use.kind === "entity") {
      const entities = new SqlEntityStore(this.tx, this.actor);
      return {
        kind: "entity",
        value: await entities.setTags(use.value.id, tag_ids),
      };
    }
    const activity = new SqlTagTargets(this.tx, this.actor);
    await setTagLinks(this.tx, this.actor, use.kind, use.value.id, tag_ids);
    if (use.kind === "task") return { kind: "task", value: (await activity.task(use.value.id, true))! };
    await this
      .tx`update app.records set version=version+1,updated_at=now() where workspace_id=${this.workspaceId} and id=${use.value.id}`;
    const value = (await activity.record(use.value.id))!;
    await this.enqueueIndex({ kind: "record", id: value.id, input_hash: await searchInputHash(value.body) });
    return { kind: "record", value };
  }
  async delete(id: string) {
    const [deleted] = await this
      .tx`delete from app.tags where workspace_id=${this.workspaceId} and id=${id} returning id`;
    if (!deleted) throw new AppError("forbidden", "태그에 연결된 모든 대상의 쓰기 권한이 필요합니다");
  }
  async listRecordTemplateTags(limit: number, after?: Keyset) {
    const rows = await this.tx`select * from app.workspace_record_template_tags(${limit},${
      after?.at ?? null
    }::timestamptz,${after?.id ?? null}::text)`;
    return rows.map(toTag);
  }
  async list(limit: number, after?: Keyset, scope: TagResult["scope"] = "record") {
    const tx = this.tx;
    return (await tx`select * from app.tags where workspace_id=${this.workspaceId} and scope=${scope} ${
      after ? tx`and (updated_at,id)<(${after.at}::timestamptz,${after.id}::text)` : tx``
    } order by updated_at desc,id desc limit ${limit}`).map(toTag);
  }
}
export class SqlTagUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}
  run<T>(a: Actor, fn: (s: TagStore) => Promise<T>, entry?: TagEntry): Promise<T> {
    const actor = requireWorkspaceActor(a);
    return runInWorkspace(this.sql, actor, { mode: "business", requirements: [] }, async (tx) => {
      if (entry?.deleteTagId) {
        const [resolved] = await tx`select app.workspace_tag_delete_requirements(${entry.deleteTagId}) as requirements`;
        await tx`select set_config('request.workspace_requirements',${JSON.stringify(resolved.requirements)},true)`;
      }
      if (entry?.connection) {
        if (entry.connection.target_kind !== "entity") {
          throw invalidInput("지원하지 않는 태그 연결 대상입니다");
        }
        const [entity] =
          await tx`select entity_type_id from app.entities where workspace_id=${actor.workspaceId} and id=${entry.connection.target_id}`;
        if (!entity) throw notFound();
        const requirements = [{
          target_kind: "entity_type" as const,
          target_id: String(entity.entity_type_id),
          access: "write" as const,
        }];
        await authorizeWorkspace(tx, requirements);
        await tx`select set_config('request.workspace_requirements',${JSON.stringify(requirements)},true)`;
      }
      return fn(new SqlTagStore(tx, a));
    });
  }
}
