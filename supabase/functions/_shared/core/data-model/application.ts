import { z } from "zod";
import {
  dataModelAction,
  type DataModelDocument,
  dataModelDocument,
  dataModelInput,
  dataModelPrepare,
  type ModelChange,
  type ModelReview,
} from "../../contracts/data-model.ts";
import type { Actor } from "../shared/actor.ts";
import { type RequestStore, runWrite } from "../shared/request.ts";
import { AppError, invalidInput, notFound } from "../shared/errors.ts";
import { parseSchemaDocument } from "../entity-types/schema-import-json.ts";
import { canonical, definitionFingerprint, schemaDefinitionDiff } from "../entity-types/evolution.ts";
import { validateEntityDefinition } from "../entity-types/schema-rules.ts";
import { APP_IDENTIFIER_RULE_ID, typeIdentityUpdate } from "../../contracts/entity-issuer.ts";
export type ModelSnapshot = {
  document: DataModelDocument;
  types: Record<string, { next_property_number: number; count: number; locked: boolean }>;
};
export type ModelPlan = { target: DataModelDocument; review: ModelReview; baseline: string; source: DataModelDocument };
export interface DataModelStore extends RequestStore {
  snapshot(): Promise<ModelSnapshot>;
  save(plan: ModelPlan): Promise<ModelChange>;
  get(id: string, lock?: boolean): Promise<(ModelChange & { plan: ModelPlan }) | null>;
  list(limit: number, cursor?: string): Promise<{ items: ModelChange[]; next_cursor: string | null }>;
  publishPreparedModel(plan: ModelPlan): Promise<NonNullable<ModelChange["result"]>>;
  complete(id: string, result: NonNullable<ModelChange["result"]>): Promise<ModelChange>;
}
export interface DataModelDeps {
  uow: { run<T>(a: Actor, fn: (s: DataModelStore) => Promise<T>, readOnly?: boolean): Promise<T> };
}
export function parseModel(raw: string): DataModelDocument {
  const document = dataModelDocument.safeParse(parseSchemaDocument(raw, { raw_bytes: Infinity, depth: 32 }));
  if (!document.success) {
    throw invalidInput(
      "자료 모델 형식을 확인하세요",
      document.error.issues.map((i) => ({ path: "document." + i.path.join("."), message: i.message })),
    );
  }
  const d = document.data;
  const unique = (values: string[], path: string) => {
    if (new Set(values).size !== values.length) {
      throw invalidInput("중복된 자료 모델 참조입니다", [{
        path,
        message: "각 정의의 식별자와 참조는 중복될 수 없습니다",
      }]);
    }
  };
  unique(d.entity_types.map((t) => t.ref), "entity_types.ref");
  unique(d.entity_types.map((t) => t.schema["x-type-id"]), "entity_types.schema.x-type-id");
  unique(d.relations.map((t) => t.id), "relations.id");
  unique(d.identity_definitions.rules.map((t) => t.id), "identity_definitions.rules.id");
  unique(d.identity_definitions.issuers.map((t) => t.code), "identity_definitions.issuers.code");
  for (const [n, t] of d.entity_types.entries()) {
    try {
      t.schema = validateEntityDefinition({ schema: t.schema }).schema;
    } catch (e) {
      if (e instanceof AppError) {
        throw invalidInput(e.message, e.fields?.map((f) => ({ ...f, path: `entity_types.${n}.${f.path}` })));
      }
      throw e;
    }
    if (!t.schema.title || !t.schema["x-icon"]) {
      throw invalidInput("자료 이름과 아이콘을 포함한 완전한 정의가 필요합니다");
    }
    if (
      !typeIdentityUpdate.safeParse({ ...t.identity, version: undefined, expected_version: t.identity.version }).success
    ) {
      const { version, ...identity } = t.identity;
      if (!typeIdentityUpdate.safeParse({ ...identity, expected_version: version }).success) {
        throw invalidInput("자료 식별자 기본 선택과 중복 발급처를 확인하세요");
      }
    }
    for (const s of t.identity.sources) {
      const rule = d.identity_definitions.rules.find((r) => r.id === s.rule_id && r.source === s.code),
        issuer = d.identity_definitions.issuers.find((i) => i.code === s.code);
      if (!rule || !issuer) {
        throw invalidInput("식별자 참조를 찾을 수 없습니다", [{
          path: `entity_types.${n}.identity.sources`,
          message: s.code,
        }]);
      }
      if (s.code === t.identity.default_source && (!s.active || !rule.active || !issuer.active)) {
        throw invalidInput("기본 발급처는 활성 상태여야 합니다");
      }
    }
  }
  for (const [n, r] of d.relations.entries()) {
    for (const e of r.ends) {
      if (!d.entity_types.some((t) => t.ref === e.type_ref)) {
        throw invalidInput("관계의 자료 종류 참조를 찾을 수 없습니다", [{
          path: `relations.${n}.ends`,
          message: e.type_ref,
        }]);
      }
    }
  }
  for (const i of d.identity_definitions.issuers) {
    if (i.system !== (i.code === "app") || i.code === "app" && !i.active) {
      throw invalidInput("앱 발급처 정의를 확인하세요");
    }
  }
  for (const rule of d.identity_definitions.rules) {
    if (!d.identity_definitions.issuers.some((i) => i.code === rule.source)) {
      throw invalidInput("번호 정의의 발급처를 찾을 수 없습니다");
    }
    if (
      (rule.source === "app") !==
        (rule.id === APP_IDENTIFIER_RULE_ID && rule.generation === "automatic" && rule.active) ||
      rule.source !== "app" && rule.generation !== "direct"
    ) throw invalidInput("시스템 번호 정의를 확인하세요");
  }
  return d;
}
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const x = schema.safeParse(raw);
  if (!x.success) {
    throw invalidInput(
      "자료 모델 입력을 확인하세요",
      x.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return x.data;
}
async function mappedId(seed: string, key: string) {
  const h = await definitionFingerprint([seed, key]);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const withoutVersion = (value: unknown) => {
  const c = structuredClone(value) as Record<string, unknown>;
  delete c.version;
  return c;
};
export async function resolveModel(
  snapshot: ModelSnapshot,
  document: DataModelDocument,
  mode: "update" | "copy",
): Promise<ModelPlan> {
  const source = snapshot.document,
    baseline = await definitionFingerprint(snapshot),
    seed = await definitionFingerprint({ baseline, document, mode }),
    target = structuredClone(document);
  // Copy collisions receive a visible new label, never an implicit merge by name.
  const occupied = new Set(source.entity_types.filter((t) => !t.schema.deprecated).map((t) => t.schema.title));
  if (mode === "copy") {
    for (const t of target.entity_types) {
      if (!t.schema.deprecated) {
        const original = t.schema.title!;
        let label = original, n = 1;
        while (occupied.has(label)) {
          const suffix = n === 1 ? " (복사)" : ` (복사 ${n})`;
          label = [...original].slice(0, 80 - [...suffix].length).join("") + suffix;
          n++;
        }
        t.schema.title = label;
        occupied.add(label);
      }
    }
  }
  // Reuse issuer codes and the fixed system rule; copy never edits shared registry metadata.
  target.identity_definitions.issuers = target.identity_definitions.issuers.map((i) =>
    mode === "copy" || i.system ? source.identity_definitions.issuers.find((o) => o.code === i.code) ?? i : i
  );
  target.identity_definitions.rules = target.identity_definitions.rules.map((r) =>
    r.id === APP_IDENTIFIER_RULE_ID ? source.identity_definitions.rules.find((o) => o.id === r.id) ?? r : r
  );
  const mapping: ModelReview["mapping"] = { types: {}, rules: {}, relations: {}, properties: {} };
  const items: ModelReview["items"] = [];
  for (const t of target.entity_types) {
    const old = mode === "update"
      ? source.entity_types.find((s) => s.schema["x-type-id"] === t.schema["x-type-id"])
      : undefined;
    mapping.types[t.ref] = old?.schema["x-type-id"] ?? await mappedId(seed, "type:" + t.ref);
    const keys = Object.keys(t.schema.properties).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5))),
      props: Record<string, string> = {};
    let next = old ? snapshot.types[old.schema["x-type-id"]].next_property_number : 1;
    for (const k of keys) {
      if (old && Object.hasOwn(old.schema.properties, k)) props[k] = k;
      else {
        if (old && Number(k.slice(5)) < next) {
          throw invalidInput("이미 발급·제거한 속성 키를 재사용할 수 없습니다", [{
            path: `entity_types.${t.ref}.schema.properties.${k}`,
            message: "원본 종류의 최신 속성 키를 사용하세요",
          }]);
        }
        props[k] = `prop_${next++}`;
      }
    }
    mapping.properties[t.ref] = props;
    t.schema = {
      ...t.schema,
      "x-type-id": mapping.types[t.ref],
      "x-version": old ? old.schema["x-version"] + 1 : 1,
      properties: Object.fromEntries(keys.map((k) => [props[k], t.schema.properties[k]])),
      required: t.schema.required.map((k) => props[k]),
    };
    validateEntityDefinition({ schema: t.schema });
    const diff = old ? schemaDefinitionDiff({ schema: old.schema }, { schema: t.schema }) : [];
    const identityChanged = !!old && canonical(withoutVersion(old.identity)) !== canonical(withoutVersion(t.identity));
    const kind = !old
      ? "new"
      : diff.some((d) => d.kind === "migration_required") && snapshot.types[old.schema["x-type-id"]].count > 0
      ? "migration_required"
      : diff.length || identityChanged
      ? "compatible"
      : "unchanged";
    if (old && !diff.length) t.schema["x-version"] = old.schema["x-version"];
    if (identityChanged) {
      diff.push({
        path: "식별자 설정",
        before: old!.identity.label + " · 기본 " + old!.identity.default_source + " · " +
          old!.identity.sources.map((x) => x.code).join(", "),
        after: t.identity.label + " · 기본 " + t.identity.default_source + " · " +
          t.identity.sources.map((x) => x.code).join(", "),
        before_present: true,
        after_present: true,
        kind: "compatible",
        reason: "자료 번호 설정 변경",
        next_action: "전체 모델과 함께 적용",
      });
    }
    items.push({
      ref: t.ref,
      label: t.schema.title!,
      kind,
      diff,
      current_schema_version: old?.schema["x-version"],
      source_schema_version: document.entity_types.find((x) => x.ref === t.ref)!.schema["x-version"],
      source_is_stale: !!old &&
        old.schema["x-version"] !== document.entity_types.find((x) => x.ref === t.ref)!.schema["x-version"],
      removed_keys: old ? Object.keys(old.schema.properties).filter((k) => !Object.hasOwn(t.schema.properties, k)) : [],
      target_schema_version: t.schema["x-version"],
      schema: t.schema,
      current_schema: old?.schema,
    });
  }
  for (const r of target.identity_definitions.rules) {
    const old = source.identity_definitions.rules.find((x) => x.id === r.id);
    mapping.rules[r.id] = r.source === "app"
      ? APP_IDENTIFIER_RULE_ID
      : mode === "update" && old
      ? r.id
      : await mappedId(seed, "rule:" + r.id);
    r.id = mapping.rules[r.id];
  }
  for (const t of target.entity_types) for (const s of t.identity.sources) s.rule_id = mapping.rules[s.rule_id];
  for (const r of target.relations) {
    const id = r.id;
    mapping.relations[id] = mode === "update" && source.relations.some((x) => x.id === id)
      ? id
      : await mappedId(seed, "relation:" + id);
    r.id = mapping.relations[id];
  }
  // Registry and relationship changes also appear in the same review, never silently apply outside its fingerprint.
  for (
    const [category, values, previous] of [
      ["issuer", target.identity_definitions.issuers, source.identity_definitions.issuers],
      ["rule", target.identity_definitions.rules, source.identity_definitions.rules],
      ["relation", target.relations, source.relations],
    ] as const
  ) {
    for (const value of values) {
      const key = "code" in value ? value.code : value.id;
      const old = previous.find((x) => ("code" in x ? x.code : x.id) === key);
      const comparable = (v: typeof value, doc: DataModelDocument) => {
        const out = withoutVersion(v);
        if ("ends" in v) {
          out.ends = v.ends.map((e) => ({
            ...e,
            type_ref: doc.entity_types.find((t) => t.ref === e.type_ref)?.schema["x-type-id"],
          }));
        }
        return out;
      };
      const equal = old && canonical(comparable(old as typeof value, source)) === canonical(comparable(value, target));
      items.push({
        ref: `${category}:${key}`,
        label: "label" in value ? value.label : value.ends.map((e) => e.label).join(" ↔ "),
        kind: equal ? "unchanged" : old ? "compatible" : "new",
        diff: equal ? [] : [{
          path: category === "relation" ? "자료 관계" : category === "rule" ? "번호 정의" : "발급처",
          before: old ? JSON.stringify(comparable(old as typeof value, source)) : null,
          after: JSON.stringify(comparable(value, target)),
          before_present: !!old,
          after_present: true,
          kind: "compatible",
          reason: "정의 설정 변경",
          next_action: "전체 모델과 함께 적용",
        }],
      });
    }
  }
  const labels = new Map<string, string>();
  for (
    const t of [
      ...source.entity_types.filter((t) =>
        !target.entity_types.some((n) => n.schema["x-type-id"] === t.schema["x-type-id"])
      ),
      ...target.entity_types,
    ]
  ) {
    if (!t.schema.deprecated) {
      const duplicate = labels.has(t.schema.title!);
      labels.set(t.schema.title!, t.ref);
      if (duplicate) {
        const item = items.find((x) => x.ref === t.ref);
        if (item) {
          item.kind = "conflict";
          item.message = "같은 이름의 활성 자료 종류가 있습니다";
        }
      }
    }
  }
  const review: ModelReview = {
    fingerprint: seed,
    mode,
    title: document.title,
    items,
    mapping,
    can_apply: !items.some((x) => x.kind === "migration_required" || x.kind === "conflict"),
  };
  return { target, review, baseline, source };
}
export function exportDataModel(d: DataModelDeps, a: Actor) {
  return d.uow.run(a, async (s) => (await s.snapshot()).document, true);
}
export function previewDataModel(d: DataModelDeps, a: Actor, raw: unknown) {
  const i = parse(dataModelInput, raw), document = parseModel(i.document);
  return d.uow.run(a, async (s) => (await resolveModel(await s.snapshot(), document, i.mode)).review, true);
}
export function prepareDataModel(d: DataModelDeps, a: Actor, raw: unknown) {
  const i = parse(dataModelPrepare, raw), document = parseModel(i.document);
  return runWrite(d.uow, a, "data-model.prepare", null, i, async (s) => {
    const plan = await resolveModel(await s.snapshot(), document, i.mode);
    if (plan.review.fingerprint !== i.preview_fingerprint) {
      throw new AppError("schema_plan_stale", "모델이 변경되었습니다. 입력을 유지하고 다시 검토하세요");
    }
    for (const item of plan.review.items) {
      const removed = item.removed_keys ?? [];
      if (canonical([...(i.remove_keys[item.ref] ?? [])].sort()) !== canonical([...removed].sort())) {
        throw invalidInput("영구 제거할 자료 항목을 명시적으로 확인하세요", [{
          path: `remove_keys.${item.ref}`,
          message: removed.join(", "),
        }]);
      }
    }
    return s.save(plan);
  });
}
export function listDataModelChanges(d: DataModelDeps, a: Actor, raw: unknown = {}) {
  const q = parse(
    z.strictObject({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      cursor: z.string().uuid().optional(),
    }),
    raw,
  );
  return d.uow.run(a, (s) => s.list(q.limit, q.cursor), true);
}
export function getDataModelChange(d: DataModelDeps, a: Actor, id: string) {
  id = parse(z.string().uuid(), id);
  return d.uow.run(a, async (s) => {
    const c = await s.get(id);
    if (!c) throw notFound();
    const { plan: _p, ...value } = c;
    return value;
  }, true);
}
export function applyDataModel(d: DataModelDeps, a: Actor, id: string, raw: unknown) {
  id = parse(z.string().uuid(), id);
  const i = parse(dataModelAction, raw);
  return runWrite(d.uow, a, "data-model.apply", id, i, async (s) => {
    const c = await s.get(id, true);
    if (!c) throw notFound();
    if (c.version !== i.expected_version || c.status !== "ready") {
      throw new AppError("schema_plan_stale", "적용할 변경안의 최신 검토를 확인하세요");
    }
    if (!c.review.can_apply) throw new AppError("schema_migration_required", "전체 모델의 값 변환 준비가 필요합니다");
    if (await definitionFingerprint(await s.snapshot()) !== c.plan.baseline) {
      throw new AppError("schema_plan_stale", "검토 후 모델이나 자료가 변경되었습니다. 다시 검토하세요");
    }
    return s.complete(id, await s.publishPreparedModel(c.plan));
  });
}
