import { runWrite } from "../shared/request.ts";
import { prepareSchemaChange } from "./schema-changes.ts";
import { schemaChangeCreate, type SchemaEdit } from "../../contracts/entity-schema-change.ts";
import { z } from "zod";
import {
  type EntitySchemaImportInput,
  entitySchemaImportPrepare,
  entitySchemaImportPreview,
  type EntitySchemaImportResult,
  type EntitySchemaImportReview,
} from "../../contracts/entity-schema-import.ts";
import type { EntityTypeDeps, EntityTypeStore } from "./application.ts";
import type { Actor } from "../shared/actor.ts";
import { AppError, invalidInput, notFound } from "../shared/errors.ts";
import { parseSchemaDocument } from "./schema-import-json.ts";
import { publicationDefinition, validateEntityDefinition } from "./schema-rules.ts";
import { canonical, definitionFingerprint, schemaDefinitionDiff } from "./evolution.ts";
import { type EntitySchema, entityTypeIcon } from "../../contracts/entity-type.ts";
function parseInput(raw: unknown): EntitySchemaImportInput {
  const parsed = entitySchemaImportPreview.safeParse(raw);
  if (!parsed.success) {
    throw invalidInput(
      "가져오기 입력을 확인하세요",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return parsed.data;
}
function sourceIdentity(document: Record<string, unknown>) {
  const parsed = z.strictObject({ id: z.string().uuid(), version: z.number().int().positive().max(2147483647) })
    .safeParse({ id: document["x-type-id"], version: document["x-version"] });
  if (!parsed.success) {
    throw invalidInput(
      "문서의 원본 종류 ID와 버전을 확인하세요",
      parsed.error.issues.map((i) => ({
        path: i.path[0] === "id" ? "document.x-type-id" : "document.x-version",
        message: i.message,
      })),
    );
  }
  return parsed.data;
}
function comparableHistorical(schema: EntitySchema) {
  const result = structuredClone(schema);
  if (Array.isArray(result.required)) result.required.sort();
  for (const field of Object.values(result.properties ?? {})) {
    for (const name of ["deprecated", "readOnly", "x-representative", "x-show-in-list"] as const) {
      if (field && typeof field === "object" && field[name] === false) delete field[name];
    }
  }
  return canonical(result);
}
function keyOrder(a: string, b: string) {
  const aa = a.slice(5), bb = b.slice(5);
  return aa.length - bb.length || (aa < bb ? -1 : aa > bb ? 1 : 0);
}
function remapImportedSchema(schema: EntitySchema, mapping: Record<string, string>): EntitySchema {
  return {
    ...structuredClone(schema),
    properties: Object.fromEntries(
      Object.keys(schema.properties).sort(keyOrder).map(
        (key) => [mapping[key], structuredClone(schema.properties[key])],
      ),
    ),
    required: schema.required.map((key) => mapping[key]),
  };
}
async function reviewImport(
  store: EntityTypeStore | undefined,
  input: EntitySchemaImportInput,
  document: Record<string, unknown>,
): Promise<EntitySchemaImportReview> {
  const source = sourceIdentity(document);
  let current: EntitySchema | undefined, next = 1, metadataPreserved = false;
  let previous: Awaited<ReturnType<EntityTypeStore["lockExistingSchemaChange"]>> | undefined;
  let candidate = document;
  if (input.mode === "update") {
    if (source.id !== input.type_id) {
      throw invalidInput("문서와 요청 대상 종류 ID가 다릅니다", [{
        path: "document.x-type-id",
        message: "같은 종류의 문서를 지정하세요",
      }]);
    }
    const context = await store!.loadSchemaChangeDraft(input.type_id!);
    const type = await store!.get(input.type_id!);
    if (!type) throw notFound();
    if (context.type.schema_version !== input.expected_schema_version) {
      throw new AppError(
        "schema_changed",
        "검토한 현재 정의가 변경되었습니다. 입력을 유지하고 새로 검토하세요",
        undefined,
        { type_id: input.type_id!, schema_version: context.type.schema_version },
      );
    }
    current = context.definition.schema;
    next = type.next_property_number;
    if (input.change_id) {
      previous = await store!.lockExistingSchemaChange(input.type_id!, input.change_id);
      if (
        previous.version !== input.expected_change_version ||
        previous.source_schema_version !== input.expected_schema_version ||
        ["applied", "cancelled"].includes(previous.status)
      ) throw new AppError("schema_plan_stale", "가져오기 변경안의 최신 상태를 다시 검토하세요");
    }
    if (document.title === undefined || document["x-icon"] === undefined) {
      const historical = await store!.schema(source.id, source.version);
      if (
        !historical?.metadata_missing ||
        comparableHistorical(document as EntitySchema) !== comparableHistorical(historical.schema)
      ) {
        throw invalidInput("확인할 수 없는 불완전 정의입니다. 이름·아이콘·보관 상태를 완성하세요", [{
          path: "document",
          message: "알려진 과거 버전의 원본만 현재 종류 정보를 유지하며 복구할 수 있습니다",
        }]);
      }
      metadataPreserved = true;
      candidate = {
        ...document,
        title: current.title,
        "x-icon": current["x-icon"],
        deprecated: current.deprecated ?? false,
        ...(current.description !== undefined ? { description: current.description } : {}),
      };
      if (current.description === undefined) delete candidate.description;
    }
  } else if (input.new_keys.length || input.remove_keys.length) {
    throw invalidInput("새 종류 복사는 모든 속성을 새 키로 발급합니다. 기존 키 지정은 받지 않습니다");
  }
  let schema: EntitySchema;
  try {
    schema = validateEntityDefinition({ schema: candidate }).schema;
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError(
        error.code,
        error.message,
        error.fields?.map((field) => ({ ...field, path: field.path.replace(/^schema(?=\.|$)/, "document") })),
        error.current,
      );
    }
    throw error;
  }
  const mapping: Record<string, string> = {}, known = current?.properties ?? {}, reservedBefore = next;
  if (
    new Set(input.new_keys).size !== input.new_keys.length ||
    new Set(input.remove_keys).size !== input.remove_keys.length
  ) throw invalidInput("속성 키 목록은 중복될 수 없습니다");
  for (const key of input.new_keys) {
    if (!Object.hasOwn(schema.properties, key) || Object.hasOwn(known, key)) {
      throw invalidInput("새 키 대응에는 가져온 문서의 새 속성만 지정하세요", [{
        path: `new_keys.${key}`,
        message: "현재 속성은 새 키로 조용히 바꿀 수 없습니다",
      }]);
    }
  }
  for (const key of Object.keys(schema.properties).sort(keyOrder)) {
    if (Object.hasOwn(known, key)) {
      mapping[key] = key;
      continue;
    }
    if (input.mode === "update" && keyOrder(key, `prop_${reservedBefore}`) < 0 && !input.new_keys.includes(key)) {
      throw invalidInput("이미 발급·제거한 속성 키를 재사용할 수 없습니다", [{
        path: `document.properties.${key}`,
        message: "새 속성으로 명시해 새 키 대응을 검토하세요",
      }]);
    }
    const ref = await importClientReference(key);
    mapping[key] = previous?.reservations[ref] ?? `prop_${next++}`;
  }
  const target = remapImportedSchema(schema, mapping);
  const removed = current
    ? Object.keys(current.properties).filter((key) => !Object.hasOwn(schema.properties, key)).sort(keyOrder)
    : [];
  const diff = current ? schemaDefinitionDiff({ schema: current }, { schema: target }) : schemaDefinitionDiff({
    schema: { ...target, properties: {}, required: [], title: undefined, "x-icon": undefined, deprecated: false },
  }, { schema: target });
  if (current && diff.length) publicationDefinition({ schema: target }, source.id, current["x-version"] + 1);
  const review = {
    mode: input.mode,
    changed: input.mode === "copy" || diff.length > 0,
    source_type_id: source.id,
    source_schema_version: source.version,
    current_schema_version: current?.["x-version"] ?? null,
    source_is_stale: current !== undefined && source.version !== current["x-version"],
    metadata_preserved: metadataPreserved,
    key_mapping: mapping,
    removed_keys: removed,
    diff,
    schema: target,
  };
  return {
    ...review,
    preview_fingerprint: await definitionFingerprint({
      expected_schema_version: input.expected_schema_version ?? null,
      new_keys: [...input.new_keys].sort(keyOrder),
      current: current ?? null,
      previous: previous ? { id: previous.id, version: previous.version, reservations: previous.reservations } : null,
      ...review,
    }),
  };
}
export async function previewEntitySchemaImport(
  d: EntityTypeDeps,
  actor: Actor,
  raw: unknown,
): Promise<EntitySchemaImportReview> {
  const input = parseInput(raw), document = parseSchemaDocument(input.document);
  if (input.mode === "copy") return await reviewImport(undefined, input, document);
  return await d.uow.run(actor, (store) => reviewImport(store, input, document));
}

async function importClientReference(key: string) {
  return key.length <= 70 ? "import_" + key : "import_" + (await definitionFingerprint(key)).slice(0, 40);
}
async function importEdits(
  store: EntityTypeStore,
  input: EntitySchemaImportInput,
  review: EntitySchemaImportReview,
): Promise<SchemaEdit[]> {
  const current = (await store.loadSchemaChangeDraft(input.type_id!)).definition.schema;
  const edits: SchemaEdit[] = [],
    changedKeys = new Set(review.diff.map((d) => /^properties\.(prop_[0-9]+)/.exec(d.path)?.[1]));
  for (const [source, key] of Object.entries(review.key_mapping)) {
    const field = review.schema.properties[key], required = review.schema.required.includes(key);
    if (!Object.hasOwn(current.properties, source)) {
      edits.push({ op: "add_property", client_ref: await importClientReference(source), field, required });
    } else if (changedKeys.has(key)) edits.push({ op: "update_property", key, field, required });
  }
  for (const key of review.removed_keys) edits.push({ op: "remove_property", key });
  if (review.diff.some((d) => ["title", "description", "x-icon", "deprecated"].includes(d.path))) {
    edits.push({
      op: "set_metadata",
      title: review.schema.title!,
      description: review.schema.description ?? null,
      "x-icon": entityTypeIcon.parse(review.schema["x-icon"]),
      deprecated: review.schema.deprecated ?? false,
    });
  }
  return edits;
}
export async function prepareEntitySchemaImport(
  d: EntityTypeDeps,
  actor: Actor,
  raw: unknown,
): Promise<EntitySchemaImportResult> {
  const parsed = entitySchemaImportPrepare.safeParse(raw);
  if (!parsed.success) {
    throw invalidInput(
      "가져오기 준비 입력을 확인하세요",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  const input = parsed.data, document = parseSchemaDocument(input.document);
  return await runWrite(
    d.uow,
    actor,
    "entity-schema-import.prepare",
    input.mode === "update" ? input.type_id : null,
    input,
    async (store) => {
      const review = await reviewImport(store, input, document);
      if (review.preview_fingerprint !== input.preview_fingerprint) {
        throw new AppError(
          "schema_plan_stale",
          "검토 후 정의나 속성 예약이 바뀌었습니다. 원문을 유지하고 다시 검토하세요",
        );
      }
      if (canonical([...input.remove_keys].sort(keyOrder)) !== canonical(review.removed_keys)) {
        throw invalidInput(
          "영구 제거할 속성을 검토하고 명시적으로 확인하세요",
          review.removed_keys.map((key) => ({
            path: `remove_keys.${key}`,
            message: "문서에서 빠진 속성의 제거 확인이 필요합니다",
          })),
        );
      }
      const { schema: _schema, diff: _diff, ...summary } = review;
      if (!review.changed) return { ...summary, change: null };
      if (input.mode === "copy") {
        const type = await store.createImportedType(review.schema);
        return { ...summary, schema: { ...review.schema, "x-type-id": type.id, "x-version": 1 }, type, change: null };
      }
      const edits = await importEdits(store, input, review);
      const draft = schemaChangeCreate.parse({ expected_schema_version: input.expected_schema_version, edits });
      const change = await prepareSchemaChange(store, input.type_id!, {
        ...draft,
        expected_change_version: input.expected_change_version,
      }, input.change_id);
      const mapping = { ...review.key_mapping };
      for (const source of Object.keys(mapping)) {
        const ref = await importClientReference(source);
        if (change.reservations[ref]) mapping[source] = change.reservations[ref];
      }
      return {
        ...summary,
        key_mapping: mapping,
        change: {
          id: change.id,
          type_id: change.type_id,
          source_schema_version: change.source_schema_version,
          version: change.version,
          status: change.status,
          change_kind: change.change_kind,
          created_at: change.created_at,
          updated_at: change.updated_at,
        },
      };
    },
  );
}
