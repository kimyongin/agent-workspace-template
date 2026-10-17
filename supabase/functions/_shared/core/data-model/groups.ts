import { z } from "zod";
import { dataModelAction, modelGroupAnalyze } from "../../contracts/data-model.ts";
import type { Actor } from "../shared/actor.ts";
import { runWrite } from "../shared/request.ts";
import { AppError, invalidInput, notFound } from "../shared/errors.ts";
import { compileMigration } from "../entity-types/conversions.ts";
import type { ModelGroupAnalyze } from "../../contracts/data-model.ts";
import type { DataModelDeps, ModelPlan } from "./application.ts";
function parse<T>(s: z.ZodType<T>, raw: unknown): T {
  const p = s.safeParse(raw);
  if (!p.success) {
    throw invalidInput(
      "전체 모델 값 변환 입력을 확인하세요",
      p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return p.data;
}
export function analyzeDataModel(d: DataModelDeps, a: Actor, id: string, raw: unknown) {
  id = parse(z.string().uuid(), id);
  const i = parse(modelGroupAnalyze, raw);
  return runWrite(d.uow, a, "data-model.analyze", id, i, async (s) => {
    const c = await s.get(id, true);
    if (!c) throw notFound();
    if (c.version !== i.expected_version) {
      throw new AppError("schema_plan_stale", "변경안이 바뀌었습니다. 최신 상태를 확인하세요");
    }
    if (!["needs_conversion", "ready", "analyzing", "failed"].includes(c.status)) {
      throw invalidInput("진행 중이거나 완료한 전체 변경안은 수정할 수 없습니다");
    }
    validateModelGroupConversions(c.plan, i);
    if (!s.analyzeGroup) throw invalidInput("전체 값 변환 저장소가 준비되지 않았습니다");
    return s.analyzeGroup(id, i);
  });
}
export function changeDataModelGroup(d: DataModelDeps, a: Actor, id: string, raw: unknown, action: "cancel" | "retry") {
  id = parse(z.string().uuid(), id);
  const i = parse(dataModelAction, raw);
  return runWrite(d.uow, a, `data-model.${action}`, id, i, async (s) => {
    const c = await s.get(id, true);
    if (!c) throw notFound();
    if (c.version !== i.expected_version) {
      throw new AppError("schema_plan_stale", "작업 상태가 바뀌었습니다. 최신 상태를 확인하세요");
    }
    if (action === "cancel") {
      if (!s.cancelGroup) throw invalidInput("전체 작업 취소가 지원되지 않습니다");
      return s.cancelGroup(id);
    }
    if (!s.retryGroup) throw invalidInput("전체 작업 재시도가 지원되지 않습니다");
    return s.retryGroup(id);
  });
}

export function validateModelGroupConversions(plan: ModelPlan, input: ModelGroupAnalyze) {
  const refs = new Set<string>();
  for (const conversion of input.conversions) {
    const target = plan.target.entity_types.find((t) => t.ref === conversion.type_ref);
    if (refs.has(conversion.type_ref) || !target) {
      throw invalidInput("검토한 모델 안의 자료 종류에만 변환을 지정하세요");
    }
    refs.add(conversion.type_ref);
    const source = plan.source.entity_types.find((t) => t.schema["x-type-id"] === target.schema["x-type-id"]);
    if (!source) throw invalidInput("새 자료 종류에는 기존 값 변환을 지정할 수 없습니다");
    for (const rule of conversion.migration.rules) {
      if (
        rule.op === "remove" &&
        (!Object.hasOwn(source.schema.properties, rule.key) ||
          !plan.remove_keys?.[conversion.type_ref]?.includes(rule.key))
      ) throw invalidInput("검토에서 삭제를 확인한 속성에만 제거를 지정하세요");
    }
    compileMigration({ schema: target.schema }, conversion.migration);
  }
}
