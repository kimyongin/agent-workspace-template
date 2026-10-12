import { z } from "zod";
import { codePointLength, TEXT_LIMITS } from "./common.ts";
import { tagIds } from "./tag.ts";

export const TEMPLATE_MODELS = ["entity", "task", "principle"] as const;
export const TEMPLATE_ACTIONS = ["create", "update", "delete", "restore", "stop", "resume"] as const;
export type TemplateModel = typeof TEMPLATE_MODELS[number];
export type TemplateAction = typeof TEMPLATE_ACTIONS[number];
export const templateModelNames = { entity: "엔터티", task: "할일", principle: "원칙" };
export const templateActionNames: Record<TemplateAction, string> = {
  create: "등록",
  update: "수정",
  delete: "삭제",
  restore: "복원",
  stop: "중단",
  resume: "재개",
};
export const templateFields: Record<TemplateModel, Record<string, string>> = {
  entity: {
    제목: "title",
    태그: "tag_ids",
    발급처: "source",
    식별자: "external_id",
  },
  task: {
    제목: "title",
    본문: "body",
    상태: "status",
    종류: "kind",
    기한: "due_on",
    반복규칙: "recurrence",
    시간대: "timezone",
    태그: "tag_ids",
    엔터티: "entity_ids",
    중단기간: "pauses",
  },
  principle: { 제목: "title", 본문: "body" },
};
export function modelActions(model: TemplateModel): TemplateAction[] {
  return model === "entity"
    ? ["create", "update", "delete", "restore"]
    : model === "task"
    ? ["create", "update", "delete", "stop", "resume"]
    : ["create", "update", "delete"];
}
export function templateVariables(model: TemplateModel, action: TemplateAction): string[] {
  return [
    "대상",
    "액션",
    "변경내용",
    ...(action === "update" ? ["변경항목"] : []),
    ...["이전", "이후"].filter((phase) => action !== (phase === "이전" ? "create" : "delete")).flatMap((phase) =>
      Object.keys(templateFields[model]).map((field) => `${templateModelNames[model]}.${phase}.${field}`)
    ),
  ];
}
export interface TemplateIssue {
  position: number;
  reason: string;
}
export function templateIssues(memo: string, model: TemplateModel, action: TemplateAction): TemplateIssue[] {
  const allowed = new Set(templateVariables(model, action));
  const issues: TemplateIssue[] = [];
  let position = 0;
  while (position < memo.length) {
    const open = memo.indexOf("$", position);
    if (open < 0) break;
    if (memo.startsWith("$$", open)) {
      position = open + 2;
      continue;
    }
    const legacy = memo.startsWith("${", open);
    const start = open + (legacy ? 2 : 1);
    const end = memo.indexOf(legacy ? "$}" : "$", start);
    if (end < 0) {
      issues.push({ position: open + 1, reason: "닫는 구분자 $가 없습니다" });
      break;
    }
    const variable = memo.slice(start, end);
    const dynamicProperty = model === "entity" && /^엔터티\.(이전|이후)\.prop_[1-9][0-9]*$/.test(variable) &&
      !(action === "create" && variable.includes(".이전.")) && !(action === "delete" && variable.includes(".이후."));
    if (!allowed.has(variable) && !dynamicProperty) {
      issues.push({
        position: open + 1,
        reason: `사용할 수 없는 변수: ${variable || "(빈 변수)"}. 모델·속성·이전/이후를 확인하세요`,
      });
    }
    position = end + (legacy ? 2 : 1);
  }
  return issues;
}
const template = z.strictObject({
  memo: z.string().refine((value) => codePointLength(value) <= TEXT_LIMITS.body.max, {
    message: `메모는 ${TEXT_LIMITS.body.max}자 이하입니다`,
  }),
  tag_ids: tagIds.default([]),
});
const actions = z.strictObject({
  create: template.optional(),
  update: template.optional(),
  delete: template.optional(),
  restore: template.optional(),
  stop: template.optional(),
  resume: template.optional(),
});
export const recordTemplates = z.strictObject({
  entity: actions.optional(),
  task: actions.optional(),
  principle: actions.optional(),
}).superRefine((settings, context) => {
  for (const model of TEMPLATE_MODELS) {
    for (const action of TEMPLATE_ACTIONS) {
      const value = settings[model]?.[action];
      if (!value) continue;
      if (!modelActions(model).includes(action)) {
        context.addIssue({ code: "custom", path: [model, action], message: "이 모델에서 사용할 수 없는 액션입니다" });
      }
      for (const issue of templateIssues(value.memo, model, action)) {
        context.addIssue({
          code: "custom",
          path: [model, action, "memo"],
          message: `${issue.position}번째 문자: ${issue.reason}`,
        });
      }
    }
  }
});
export type RecordTemplates = z.infer<typeof recordTemplates>;
/** The same visible template is used by settings and business record preparation. */
export const DEFAULT_RECORD_MEMO_TEMPLATES: Record<TemplateAction, string> = {
  create: "$대상$ $액션$",
  update: "$대상$ $액션$ ($변경항목$)",
  delete: "$대상$ $액션$",
  restore: "$대상$ $액션$",
  stop: "$대상$ $액션$",
  resume: "$대상$ $액션$",
};
/** Saved legacy templates remain readable; settings edits use the simpler notation. */
export function simplifyTemplateSyntax(memo: string): string {
  return memo.replace(/\$\{([^$]*?)\$\}/g, (_match, variable: string) => `$${variable}$`);
}
export function effectiveRecordTemplate(
  templates: RecordTemplates | undefined,
  model: TemplateModel,
  action: TemplateAction,
) {
  const value = templates?.[model]?.[action];
  return {
    memo: value?.memo.trim() ? simplifyTemplateSyntax(value.memo) : DEFAULT_RECORD_MEMO_TEMPLATES[action],
    tag_ids: value?.tag_ids ?? [],
  };
}
/** Keep unset overrides unset; only display legacy empty memos as the default. */
export function editableRecordTemplates(templates: RecordTemplates = {}): RecordTemplates {
  const result = { ...templates };
  for (const model of TEMPLATE_MODELS) {
    const group = templates[model];
    if (!group) continue;
    result[model] = { ...group };
    for (const action of modelActions(model)) {
      if (group[action]) result[model]![action] = effectiveRecordTemplate(templates, model, action);
    }
  }
  return result;
}
export interface TemplateContext {
  target: string;
  action: TemplateAction;
  model: TemplateModel;
  changes: string;
  changed_fields?: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}
function display(value: unknown): string {
  if (value === undefined || value === null) return "미지정";
  if (value === "" || (Array.isArray(value) && !value.length)) return "없음";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
export function renderTemplate(memo: string, context: TemplateContext): string {
  return memo.replace(
    /\$\{([^$]*?)\$\}|\$\$|\$([^$]*?)\$/g,
    (match, legacy: string | undefined, current: string | undefined) => {
      if (match === "$$") return "$";
      const variable = legacy ?? current!;
      if (variable === "대상") return context.target;
      if (variable === "액션") return templateActionNames[context.action];
      if (variable === "변경내용") return context.changes;
      if (variable === "변경항목") return context.changed_fields?.join(", ") || "변경 없음";
      const [, phase, name] = variable.split(".");
      if (context.model === "entity" && /^prop_[1-9][0-9]*$/.test(name)) {
        const facts = phase === "이전" ? context.before : context.after;
        return display((facts?.properties as Record<string, unknown> | undefined)?.[name]);
      }
      return display((phase === "이전" ? context.before : context.after)?.[templateFields[context.model][name]]);
    },
  );
}
