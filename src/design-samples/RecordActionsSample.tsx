import { CardFooter } from "../components/ui/card.tsx";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/card.tsx";
import { FieldGroup } from "../components/ui/field.tsx";
import { EyeIcon } from "lucide-react";
import { NativeSelect, NativeSelectOption } from "../components/ui/native-select.tsx";
import { Button } from "../components/ui/button.tsx";
import { TemplateMemoEditor } from "../features/settings/TemplateMemoEditor.tsx";
import { useState } from "react";
import { Field } from "../components/Field.tsx";

import {
  modelActions,
  type RecordTemplates,
  recordTemplates,
  type TemplateAction,
  templateActionNames,
  templateVariables,
} from "@contracts/record-template.ts";
import { changedTemplateActions, templateFieldTarget } from "../features/settings/record-template-actions.ts";

/** The same action/error meanings as the real editor, with memory-only saving. */
export function RecordActionsSample() {
  const [saved, setSaved] = useState<RecordTemplates>({});
  const [draft, setDraft] = useState<RecordTemplates>({});
  const [action, setAction] = useState<TemplateAction>("create");
  const [message, setMessage] = useState("");
  const changes = changedTemplateActions(draft, saved, "task", "");
  const result = recordTemplates.safeParse(draft);
  const errors = result.success ? [] : result.error.issues.flatMap((issue) => {
    const target = templateFieldTarget(issue.path.join("."));
    return target ? [{ action: target.action, message: issue.message }] : [];
  });
  return (
    <Card role="region" aria-label="액션별 저장 샘플">
      <CardHeader><CardTitle><h2>기록 자동 완성</h2></CardTitle></CardHeader><CardContent>
      <form
        className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:wrap-anywhere"
        onSubmit={(event) => {
          event.preventDefault();
          if (!result.success) return;
          setSaved(structuredClone(draft));
          setMessage("예시 변경을 저장했습니다.");
        }}
      ><FieldGroup>
        <Field pair label="액션">
          {(props) => (
            <NativeSelect
              {...props}
              value={action}
              onChange={(event) => setAction(event.target.value as TemplateAction)}
            >
              {modelActions("task").map((key) => (
                <NativeSelectOption key={key} value={key}>
                  {templateActionNames[key]}
                  {errors.some((error) => error.action === key) ? " · 오류" : changes.includes(key) ? " · 미저장" : ""}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field pair fullWidth label="메모 템플릿" error={errors.find((error) => error.action === action)?.message}>
          {(props) => (
            <TemplateMemoEditor
              key={action}
              {...props}
              variables={templateVariables("task", action).map((value) => ({ value, label: value }))}
              value={draft.task?.[action]?.memo ?? "$대상$ $액션$"}
              onChange={(memo) => {
                setDraft({ task: { ...draft.task, [action]: { memo, tag_ids: [] } } });
                setMessage("");
              }}
            />
          )}
        </Field>
        {errors.filter((error) => error.action !== action).map((error, index) => (
          <p className="text-sm text-destructive" key={index}>
            {templateActionNames[error.action]}: {error.message}{" "}
            <Button variant="ghost" type="button"  onClick={() => setAction(error.action)}><EyeIcon data-icon="inline-start" />오류 항목 보기</Button>
          </p>
        ))}
        {message && <p role="status">{message}</p>}
        <CardFooter className="-mx-4 mt-4 flex-wrap justify-end gap-3">
          {changes.length > 0 && (
            <p className="text-sm text-muted-foreground" aria-label="저장할 변경">
              변경: {changes.map((key) => templateActionNames[key]).join(" · ")}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline"
              type="button"
              disabled={!changes.length}
              onClick={() => {
                setDraft(structuredClone(saved));
                setMessage("");
              }}
            >
              취소
            </Button>
            <Button variant="default"  type="submit" disabled={!changes.length || !result.success}>
              저장
            </Button>
          </div>
        </CardFooter>
      </FieldGroup></form></CardContent>
    </Card>
  );
}
