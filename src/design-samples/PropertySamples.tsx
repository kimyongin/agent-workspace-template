import { DataFields } from "@/components/DataFields";
import { FieldLabel } from "../components/ui/field.tsx";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "../components/ui/collapsible.tsx";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group.tsx";
import { ArrowUpIcon, ArrowDownIcon, ChevronRightIcon, ChevronDownIcon } from "lucide-react";
import { BusinessTable, BusinessRow, BusinessCell, BusinessDisclosureCell, BusinessDetails } from "../components/BusinessTable.tsx";
import { FieldSet, FieldLegend } from "../components/ui/field.tsx";
import { PlusIcon, RotateCcwIcon } from "lucide-react";
import { Checkbox } from "../components/ui/checkbox.tsx";
import { Input } from "../components/ui/input.tsx";
import { Button } from "../components/ui/button.tsx";
import { NativeSelect, NativeSelectOption } from "../components/ui/native-select.tsx";
import { TemplateMemoEditor, type TemplateMemoHandle } from "../features/settings/TemplateMemoEditor.tsx";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";

import { CollectionList } from "../components/Collection.tsx";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { Field } from "../components/Field.tsx";
import { MaterialSettingsSection } from "../features/settings/MaterialSettingsSection.tsx";

import { SchemaDefinitionRead } from "../features/settings/SchemaDefinitionRead.tsx";
import { ENTITY_SCHEMA_DIALECT, type EntityField } from "@contracts/entity-type.ts";

type Property = {
  id: string;
  label: string;
  type: "text" | "number";
  required: boolean;
  listed: boolean;
  representative: boolean;
  maxLength: string;
};
const initialFields: Property[] = [
  { id: "prop_1", label: "상품명", type: "text", required: true, listed: true, representative: true, maxLength: "80" },
  { id: "prop_2", label: "수량", type: "number", required: false, listed: true, representative: false, maxLength: "" },
];
type Plan = {
  id: number;
  version: number;
  status: "reviewed" | "applied" | "discarded";
  before: Property[];
  after: Property[];
};
const equal = (left: Property[], right: Property[]) => JSON.stringify(left) === JSON.stringify(right);

function OrderIcon({ direction }: { direction: "up" | "down" }) {
  const Icon = direction === "up" ? ArrowUpIcon : ArrowDownIcon;
  return <Icon data-icon="inline-start" />;
}

function PropertyList(
  { fields, onChange, errors }: {
    fields: Property[];
    onChange: (fields: Property[]) => void;
    errors: Record<string, string>;
  },
) {
  const [advanced, setAdvanced] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>(["prop_2"]);
  const root = useRef<HTMLDivElement>(null);
  const movement = useRef<{ id: string; direction: number } | null>(null);
  useLayoutEffect(() => {
    const moved = movement.current;
    if (!moved) return;
    movement.current = null;
    const row = root.current?.querySelector(`[data-property-id="${moved.id}"]`);
    const buttons = row?.querySelectorAll<HTMLButtonElement>("[data-property-order]");
    const preferred = buttons?.[moved.direction < 0 ? 0 : 1];
    const other = buttons?.[moved.direction < 0 ? 1 : 0];
    const target = preferred && !preferred.disabled
      ? preferred
      : other && !other.disabled
      ? other
      : row?.querySelector<HTMLButtonElement>("[data-property-disclosure]");
    target?.focus();
  }, [fields]);
  useEffect(() => {
    const ids = Object.keys(errors).map((key) => key.split(".")[0]);
    if (ids.length) { setExpanded(prior => [...new Set([...prior, ...ids])]); setAdvanced(prior => [...new Set([...prior, ...ids])]); }
  }, [errors]);
  useEffect(() => {
    if (Object.keys(errors).length) {
      const invalid = root.current?.querySelector<HTMLElement>("[aria-invalid='true']");
      invalid?.focus();
    }
  }, [errors, expanded, advanced]);
  const edit = (id: string, patch: Partial<Property>) =>
    onChange(fields.map((field) => field.id === id ? { ...field, ...patch } : field));
  const toggle = (id: string) =>
    setExpanded((values) => values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);
  const move = (index: number, delta: number) => {
    movement.current = { id: fields[index].id, direction: delta };
    const next = [...fields];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onChange(next);
  };
  return (
    <RadioGroup ref={root} name="sample-representative" aria-label="자료 이름 항목" value={fields.find(field => field.representative)?.id ?? ""} onValueChange={id => onChange(fields.map(field => ({ ...field, representative: field.id === id })))}>
      <CollectionList label="입력 항목 예시" columns={["입력 항목", "설정", "순서"]}>
        {fields.map((field, index) => {
          const open = expanded.includes(field.id);
          const bodyId = `sample-${field.id}-body`;
          const labelError = errors[`${field.id}.label`];
          const summary = (
            <span className="text-sm text-muted-foreground">
              {[
                field.type === "text" ? "텍스트" : "숫자",
                field.required ? "필수" : null,
                field.representative ? "자료 이름" : null,
              ].filter(Boolean).join(" · ")}
            </span>
          );
          return (
            <Fragment key={field.id}>
              <BusinessRow data-property-id={field.id} data-expanded={open || undefined}>
                <BusinessDisclosureCell>
                  <Button variant="ghost" type="button" size="icon" data-property-disclosure=""
                    aria-label={`${field.label || "새 항목"} ${open ? "접기" : "펼치기"}`}
                    aria-expanded={open} aria-controls={bodyId} onClick={() => toggle(field.id)}>
                    {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
                  </Button>
                </BusinessDisclosureCell>
                <BusinessCell index={0}>
                  <h3 className="min-w-0 wrap-anywhere">
                    <Button variant="link" type="button" className="h-auto min-h-11 max-w-full justify-start px-0 text-left whitespace-normal wrap-anywhere"
                      aria-label={`${field.label || "새 항목"} ${[field.type === "text" ? "텍스트" : "숫자", field.required ? "필수" : null, field.representative ? "자료 이름" : null].filter(Boolean).join(" · ")}`}
                      aria-expanded={open} aria-controls={bodyId} onClick={() => {
                        toggle(field.id);
                        requestAnimationFrame(() => root.current?.querySelector<HTMLInputElement>(`#${bodyId} input`)?.focus({ preventScroll: true }));
                      }}>{field.label || "새 항목"}</Button>
                  </h3>
                </BusinessCell>
                <BusinessCell index={1}>{summary}</BusinessCell>
                <BusinessCell index={2}>                  <div className="flex items-center gap-1">
                    <Button variant="ghost"
                      type="button"
                      size="icon" data-property-order=""
                      aria-label={`${field.label || "새 항목"} 위로 이동`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <OrderIcon direction="up" />
                    </Button>
                    <Button variant="ghost"
                      type="button"
                      size="icon" data-property-order=""
                      aria-label={`${field.label || "새 항목"} 아래로 이동`}
                      disabled={index === fields.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <OrderIcon direction="down" />
                    </Button>
                  </div></BusinessCell>
              </BusinessRow>
              <BusinessDetails hidden={!open} id={bodyId}>
                <Field fullWidth label="항목 이름" required error={labelError}>{props => <Input {...props} required value={field.label} onChange={event => edit(field.id, { label: event.target.value })} />}</Field>
                <FieldSet hidden={!open} className="border-0 p-0 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:wrap-anywhere">
                  <FieldLegend className="sr-only">{field.label || "새 항목"} 편집</FieldLegend>
                  <Field label="데이터 타입">
                    {(props) => (
                      <NativeSelect
                        {...props}
                        value={field.type}
                        onChange={(event) => edit(field.id, { type: event.target.value as Property["type"] })}
                      >
                        <NativeSelectOption value="text">텍스트</NativeSelectOption>
                        <NativeSelectOption value="number">숫자</NativeSelectOption>
                      </NativeSelect>
                    )}
                  </Field>
                  <div className="flex min-w-0 flex-col gap-3">
                    <FieldLabel className="min-h-11 w-full flex-wrap items-center gap-3">
                      <RadioGroupItem value={field.id} aria-label={`${field.label || "새 항목"} 자료 이름으로 사용`} disabled={field.type !== "text" || !field.required} />
                      <span>자료 이름으로 사용</span>
                    </FieldLabel>
                  </div>
                  <Collapsible open={advanced.includes(field.id)} onOpenChange={next => setAdvanced(prior => next ? [...prior, field.id] : prior.filter(id => id !== field.id))} className="flex min-w-0 flex-col gap-4">
                    <CollapsibleTrigger asChild><Button type="button" variant="ghost">추가 설정</Button></CollapsibleTrigger><CollapsibleContent forceMount hidden={!advanced.includes(field.id)}>
                    <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:wrap-anywhere">
                      <FieldLabel className="min-h-11 w-full flex-wrap items-center gap-3">
                        <Checkbox

                          checked={field.required}
                          onCheckedChange={(checked) => edit(field.id, { required: (checked === true) })}
                        />필수 입력
                      </FieldLabel>
                      <FieldLabel className="min-h-11 w-full flex-wrap items-center gap-3">
                        <Checkbox

                          checked={field.listed}
                          onCheckedChange={(checked) => edit(field.id, { listed: (checked === true) })}
                        />목록에 표시
                      </FieldLabel>
                      {field.type === "text" && (
                        <Field label="최대 길이" error={errors[`${field.id}.maxLength`]}>
                          {(props) => (
                            <Input
                              {...props}
                              type="number"
                              min="1"
                              value={field.maxLength}
                              onChange={(event) => edit(field.id, { maxLength: event.target.value })}
                            />
                          )}
                        </Field>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="destructive"
                          type="button"
                          onClick={() => onChange(fields.filter((value) => value.id !== field.id))}
                        >
                          항목 삭제
                        </Button>
                      </div>
                    </div>
                  </CollapsibleContent></Collapsible>
                </FieldSet>
              </BusinessDetails>
            </Fragment>
          );
        })}
      </CollectionList>
    </RadioGroup>
  );
}

function PropertyDefinition({ fields }: { fields: Property[] }) {
  const properties: Record<string, EntityField> = Object.fromEntries(fields.map((field, index) => [field.id, {
    "x-order": (index + 1) * 10,
    "x-representative": field.representative,
    "x-show-in-list": field.listed,
    title: field.label,
    type: field.type === "text" ? "string" : "number",
    ...(field.type === "text" && field.maxLength ? { maxLength: Number(field.maxLength) } : {}),
  }]));
  return (
    <SchemaDefinitionRead
      definition={{
        schema: {
          $schema: ENTITY_SCHEMA_DIALECT,
          "x-type-id": "sample",
          "x-version": 1,
          title: "자료",
          "x-icon": "box",
          type: "object",
          additionalProperties: false,
          properties,
          required: fields.filter((field) => field.required).map((field) => field.id),
        },
      }}
    />
  );
}

function changes(plan: Plan) {
  const result: string[] = [];
  for (const field of plan.after) {
    const prior = plan.before.find((value) => value.id === field.id);
    if (!prior) {
      result.push(`${field.label} 항목 추가`);
      continue;
    }
    if (prior.label !== field.label) result.push(`${prior.label} → ${field.label}`);
    if (prior.type !== field.type) {
      result.push(
        `${field.label} · ${prior.type === "text" ? "텍스트" : "숫자"} → ${field.type === "text" ? "텍스트" : "숫자"}`,
      );
    }
    if (prior.required !== field.required) {
      result.push(`${field.label} · 필수 입력 ${field.required ? "사용" : "해제"}`);
    }
    if (prior.listed !== field.listed) result.push(`${field.label} · 목록 표시 ${field.listed ? "사용" : "해제"}`);
    if (prior.maxLength !== field.maxLength) {
      result.push(`${field.label} · 최대 길이 ${prior.maxLength || "제한 없음"} → ${field.maxLength || "제한 없음"}`);
    }
  }
  for (const prior of plan.before) {
    if (!plan.after.some((value) => value.id === prior.id)) result.push(`${prior.label} 항목 삭제`);
  }
  if (plan.before.map((value) => value.id).join() !== plan.after.map((value) => value.id).join()) {
    result.push(`표시 순서: ${plan.after.map((value) => value.label).join(", ") || "항목 없음"}`);
  }
  return result;
}

export function MaterialWorkspaceSample() {
  const [current, setCurrent] = useState(initialFields);
  const [draft, setDraft] = useState(
    initialFields.map((field) => field.id === "prop_2" ? { ...field, label: "재고 수량" } : field),
  );
  const [version, setVersion] = useState(1);
  const [history, setHistory] = useState<Plan[]>([{
    id: 1,
    version: 1,
    status: "applied",
    before: [],
    after: initialFields,
  }]);
  const nextField = useRef(3), nextPlan = useRef(2);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [advanced, setAdvanced] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<number[]>([]);
  const [action, setAction] = useState<{ kind: "apply" | "discard"; plan: Plan } | null>(null);
  const [message, setMessage] = useState("예: ‘수량’을 ‘재고 수량’으로 바꾼 초안입니다. 변경 검토를 눌러보세요.");
  const [template, setTemplate] = useState("$대상$ $액션$");
  const [savedTemplate, setSavedTemplate] = useState(template);
  const templateInput = useRef<TemplateMemoHandle>(null);
  const [typeName, setTypeName] = useState("상품"), [savedTypeName, setSavedTypeName] = useState("상품");
  const review = () => {
    const invalid: Record<string, string> = {};
    for (const field of draft) {
      if (!field.label.trim()) invalid[`${field.id}.label`] = "항목 이름을 입력하세요.";
      if (
        field.type === "text" && field.maxLength !== "" &&
        (!Number.isInteger(Number(field.maxLength)) || Number(field.maxLength) < 1)
      ) invalid[`${field.id}.maxLength`] = "최대 길이는 1 이상의 정수로 입력하세요.";
    }
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      setMessage("항목 이름과 최대 길이를 확인하세요.");
      return;
    }
    if (equal(current, draft)) {
      setMessage("바뀐 항목이 없습니다. 입력 항목을 수정해보세요.");
      return;
    }
    const plan: Plan = {
      id: nextPlan.current++,
      version: version + 1,
      status: "reviewed",
      before: structuredClone(current),
      after: structuredClone(draft),
    };
    setHistory((prior) => [plan, ...prior]);
    setExpanded((prior) => [...prior, plan.id]);
    setHistoryOpen(true);
    setMessage("변경 이력에 검토할 변경안을 추가했습니다. 입력을 더 수정해도 이 변경안은 유지됩니다.");
  };
  const execute = () => {
    if (!action) return;
    const { kind, plan } = action;
    if (kind === "apply" && plan.version !== version + 1) {
      setMessage("현재 버전이 바뀌었습니다. 입력 항목에서 다시 검토하세요.");
      setAction(null);
      return;
    }
    setHistory((prior) =>
      prior.map((value) =>
        value.id === plan.id ? { ...value, status: kind === "apply" ? "applied" : "discarded" } : value
      )
    );
    if (kind === "apply") {
      setCurrent(structuredClone(plan.after));
      setVersion(plan.version);
    }
    setMessage(
      kind === "apply"
        ? `예시 버전 ${plan.version}을 적용했습니다.`
        : "변경안을 폐기했습니다. 현재 입력 초안과 적용된 버전은 유지됩니다.",
    );
    setAction(null);
  };
  return (
    <div className="grid min-w-0 gap-4">
      <MaterialSettingsSection
        title="기본 정보"
        state={{ dirty: typeName !== savedTypeName, busy: false }}
      >
        <Field label="종류 이름">
          {(props) => (
            <Input
              {...props}
              value={typeName}
              onChange={(event) => setTypeName(event.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" type="button"  aria-label="변경 취소" onClick={() => setTypeName(savedTypeName)}>
              취소
            </Button>
            <Button variant="default"
              type="button"
              onClick={() => {
                setSavedTypeName(typeName);
                setMessage("예시 기본 정보를 저장했습니다.");
              }}
            >
              저장
            </Button>
          </div>
        </div>
      </MaterialSettingsSection>
      <MaterialSettingsSection
        title="입력 항목"
        summary={`${draft.length}개 항목`}
        initialOpen
        state={{ dirty: !equal(current, draft), busy: false }}
      >
        <PropertyList
          fields={draft}
          errors={errors}
          onChange={(fields) => {
            setDraft(fields);
            setErrors({});
          }}
        />
        <div>
          <Button variant="ghost" type="button"
            onClick={() =>
              setDraft([...draft, {
                id: `prop_${nextField.current++}`,
                label: "새 항목",
                type: "text",
                required: false,
                listed: false,
                representative: false,
                maxLength: "",
              }])}
          ><PlusIcon data-icon="inline-start" />
            항목 추가
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" type="button"  onClick={() => setDraft(structuredClone(current))}>변경 취소</Button>
            <Button variant="default" type="button"  onClick={review}>변경 검토</Button>
          </div>
        </div>
      </MaterialSettingsSection>
      <MaterialSettingsSection
        title="기록 자동 완성"
        summary="종류별 문구"
        state={{ dirty: template !== savedTemplate, busy: false }}
      >
        <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:wrap-anywhere">
          <Field label="액션">
            {(props) => (
              <NativeSelect {...props} >
                <NativeSelectOption>수정</NativeSelectOption>
              </NativeSelect>
            )}
          </Field>
          <Field label="변수 삽입">
            {(props) => (
              <NativeSelect
                {...props}
                value=""
                onChange={(event) => {
                  templateInput.current?.insert(event.target.value);
                }}
              >
                <NativeSelectOption value="" disabled>변수를 선택하세요</NativeSelectOption>
                <NativeSelectOption value="대상">대상</NativeSelectOption>
                <NativeSelectOption value="액션">액션</NativeSelectOption>
              </NativeSelect>
            )}
          </Field>
          <Field fullWidth label="메모 템플릿" help="비워두면 기본 문구를 사용합니다. 달러 기호 자체는 $$로 입력하세요.">
            {(props) => (
              <TemplateMemoEditor
                {...props}
                editorRef={templateInput}
                variables={[{ value: "대상", label: "대상" }, { value: "액션", label: "액션" }]}
                value={template}
                onChange={(value) => setTemplate(value.trim() ? value : "$대상$ $액션$")}
              />
            )}
          </Field>
          {template !== "$대상$ $액션$" && (
            <div className="flex min-w-0 flex-col gap-5">
              <Button variant="ghost" type="button"  onClick={() => setTemplate("$대상$ $액션$")}><RotateCcwIcon data-icon="inline-start" />기본 문구로 되돌리기</Button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="default"
              type="button"
              onClick={() => {
                setSavedTemplate(template);
                setMessage("예시 기록 문구를 저장했습니다.");
              }}
            >
              저장
            </Button>
          </div>
        </div>
      </MaterialSettingsSection>
      <MaterialSettingsSection
        title="변경 이력"
        summary={`현재 버전 ${version}`}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      >
        <CollectionList label="변경 이력 예시" columns={["변경", "시각", "상태"]}>
          {history.map((plan) => {
            const open = expanded.includes(plan.id);
            const id = `sample-plan-${plan.id}`;
            return (
              <Fragment key={plan.id}>
                <BusinessRow data-expanded={open || undefined}>
                  <BusinessDisclosureCell><Button variant="ghost" type="button" size="icon" aria-label={`입력 항목 변경 ${plan.version} ${open ? "접기" : "열기"}`} aria-expanded={open} aria-controls={id} onClick={() => setExpanded(prior => open ? prior.filter(value => value !== plan.id) : [...prior, plan.id])}>
                    {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
                  </Button></BusinessDisclosureCell>
                  <BusinessCell index={0}><h3><Button variant="link" type="button" className="h-auto min-h-11 max-w-full justify-start px-0 text-left whitespace-normal wrap-anywhere"
                    aria-label={`입력 항목 변경 시각 2026. 10. 14. 오후 12:51:12 상태 버전 ${plan.version} · ${plan.status === "applied" ? "적용됨" : plan.status === "discarded" ? "폐기됨" : "검토 완료"}`}
                    aria-expanded={open} aria-controls={id} onClick={() => setExpanded(prior => open ? prior.filter(value => value !== plan.id) : [...prior, plan.id])}>입력 항목 변경</Button></h3></BusinessCell>
                  <BusinessCell index={1}><time dateTime="2026-10-14T03:51:12Z">2026. 10. 14. 오후 12:51:12</time></BusinessCell>
                  <BusinessCell index={2}>버전 {plan.version} · {plan.status === "applied" ? "적용됨" : plan.status === "discarded" ? "폐기됨" : "검토 완료"}</BusinessCell>
                </BusinessRow>
                  <BusinessDetails id={id} hidden={!open}>
                    <PropertyDefinition fields={plan.after} />
                    <div className="min-w-0">
                      <h4 className="text-base font-semibold">변경 결과</h4>
                      <DataFields><div><dt>버전</dt><dd>{plan.version - 1} → {plan.version} · {plan.status === "applied" ? "적용 완료" : plan.status === "discarded" ? "폐기됨" : "검토 완료"}</dd></div></DataFields>
                      <BusinessTable label="변경 결과 예시" columns={["변경"]} disclosureColumn={false}>{changes(plan).map((change, index) => <BusinessRow key={index}><BusinessCell index={0}>{change}</BusinessCell></BusinessRow>)}</BusinessTable>
                      <p className="text-sm text-muted-foreground">
                        {plan.status === "applied"
                          ? "예시 입력 항목에 적용했습니다."
                          : plan.status === "discarded"
                          ? "폐기한 변경안입니다. 적용된 버전은 유지됩니다."
                          : "당시 입력 항목의 읽기 전용 사본입니다. 아직 적용하지 않았습니다."}
                      </p>
                    </div>
                    {plan.status === "reviewed" && (
                      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button variant="destructive"
                            type="button"
                            onClick={() => setAction({ kind: "discard", plan })}
                          >
                            폐기
                          </Button>
                          <Button variant="default"
                            type="button"
                            onClick={() => setAction({ kind: "apply", plan })}
                          >
                            변경 적용
                          </Button>
                        </div>
                      </div>
                    )}
                  </BusinessDetails>
              </Fragment>
            );
          })}
        </CollectionList>
      </MaterialSettingsSection>
      <p className="text-sm text-muted-foreground m-0" role="status">{message}</p>
      <ConfirmDialog
        open={!!action}
        title={action?.kind === "discard" ? "변경안을 폐기할까요?" : "변경안을 적용할까요?"}
        message={action?.kind === "discard"
          ? "이 변경안을 더 이상 적용하지 않습니다. 입력 초안과 현재 버전은 유지됩니다."
          : <><DataFields><div><dt>버전</dt><dd>{action?.plan.version}</dd></div></DataFields><p>예시 입력 항목을 적용합니다.</p></>}
        danger={action?.kind === "discard"}
        confirmLabel={action?.kind === "discard" ? "변경안 폐기" : "변경 적용"}
        onCancel={() => setAction(null)}
        onConfirm={execute}
      />
    </div>
  );
}
