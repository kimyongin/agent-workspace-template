import { type CreateAndLinkInput, createAndLinkInput } from "../../contracts/create-and-link.ts";
import type { EntityRelationDefinition } from "../../contracts/entity-relation.ts";
import { createEntityInTransaction, type EntityStore } from "../entity/application.ts";
import { type EntityRelationLinkStore, mutateRelationInTransaction, type RelationEntry } from "./links.ts";
import type { Actor } from "../shared/actor.ts";
import { type RequestStore, runWrite } from "../shared/request.ts";
import { AppError, conflict, invalidInput, notFound } from "../shared/errors.ts";
export interface CreateAndLinkStore extends RequestStore {
  entities: EntityStore;
  relations: EntityRelationLinkStore;
  /** Locks ordered kinds, identity registry, then all known endpoint/restore rows before creation. */
  prepare(definition: EntityRelationDefinition, input: CreateAndLinkInput): Promise<void>;
}
export interface CreateAndLinkDeps {
  uow: { run<T>(actor: Actor, fn: (s: CreateAndLinkStore) => Promise<T>, entry?: RelationEntry): Promise<T> };
}
export function createAndLinkEntity(d: CreateAndLinkDeps, a: Actor, raw: unknown) {
  const parsed = createAndLinkInput.safeParse(raw);
  if (!parsed.success) {
    throw invalidInput(
      "작성하고 연결할 입력을 확인하세요",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  const i = parsed.data;
  const uow: CreateAndLinkDeps["uow"] = {
    run: (actor, fn) =>
      d.uow.run(actor, fn, {
        definitionId: i.definition_id,
        typeIds: [i.entity.entity_type_id],
        endpointIds: [i.origin_id, ...(i.previous_other_id ? [i.previous_other_id] : [])],
        access: "write",
      }),
  };
  return runWrite(
    uow,
    a,
    "entity-relation.create-and-link",
    { definition_id: i.definition_id, side: i.side, origin_id: i.origin_id },
    i,
    async (s) => {
      const def = await s.relations.definition(i.definition_id, true);
      if (!def) throw notFound();
      if (def.version !== i.expected_definition_version) {
        throw new AppError(
          "settings_changed",
          "관계 설정이 변경되었습니다. 최신 설정을 확인하세요",
        );
      }
      if (def.archived) throw conflict("보관한 관계에는 새 자료를 연결할 수 없습니다");
      if (i.entity.entity_type_id !== def.ends[i.side === 0 ? 1 : 0].type_id) {
        throw invalidInput(
          "관계 상대 자료 종류로 작성하세요",
        );
      }
      const single = def.ends[i.side].cardinality === "one";
      if (!single && i.previous_other_id !== null) throw invalidInput("복수 관계는 기존 연결을 교체하지 않습니다");
      const [source] = await s.relations.endpoints([i.origin_id], false);
      if (!source) throw notFound();
      if (source.entity_type_id !== def.ends[i.side].type_id) {
        throw invalidInput("원점 자료 종류와 관계 방향이 맞지 않습니다");
      }
      if (single) {
        const current = await s.relations.linkedIds(def.id, i.side, i.origin_id);
        if (current.length > 1 || (current[0] ?? null) !== i.previous_other_id) {
          throw conflict("기존 연결이 변경되었습니다. 입력을 유지하고 현재 관계를 확인하세요");
        }
      }
      await s.prepare(def, i);
      const [origin] = await s.relations.endpoints([i.origin_id], false);
      if (!origin) throw notFound();
      if (origin.entity_type_id !== def.ends[i.side].type_id) {
        throw invalidInput(
          "원점 자료 종류와 관계 방향이 맞지 않습니다",
        );
      }
      if (origin.deleted_at || origin.type.archived) throw conflict("삭제·보관된 원점에는 작성하여 연결할 수 없습니다");
      if (origin.version !== i.expected_version) {
        throw conflict(
          "원점 자료가 변경되었습니다. 입력을 유지하고 현재 자료를 확인하세요",
        );
      }
      if (i.previous_other_id) {
        const [previous] = await s.relations.endpoints([i.previous_other_id], false);
        if (!previous) throw notFound();
        if (
          previous.entity_type_id !== def.ends[i.side === 0 ? 1 : 0].type_id ||
          previous.version !== i.expected_previous_version
        ) {
          throw conflict("기존 연결 자료가 변경되었습니다. 현재 관계를 확인하세요");
        }
      }
      let created;
      try {
        created = await createEntityInTransaction(s.entities, i.entity);
      } catch (error) {
        if (error instanceof AppError) {
          throw new AppError(
            error.code,
            error.message,
            error.fields?.map((f) => ({ ...f, path: `entity.${f.path}` })) ??
              [{ path: "entity", message: error.message }],
            error.current,
          );
        }
        throw error;
      }
      const relation = await mutateRelationInTransaction(s.relations, {
        definition_id: def.id,
        side: i.side,
        origin_id: origin.id,
        other_id: created.id,
        expected_definition_version: def.version,
        expected_version: i.expected_version,
        expected_other_version: created.version,
        previous_other_id: i.previous_other_id,
        expected_previous_version: i.expected_previous_version,
        change_note: i.change_note,
        change_tag_ids: i.change_tag_ids,
      }, single ? "replace" : "connect");
      const entity = await s.entities.get(created.id);
      if (!entity) throw notFound();
      return { entity, relation };
    },
  );
}
