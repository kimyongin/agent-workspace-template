import { DataFieldGroup, DataFields } from "@/components/DataFields";
import { Badge } from "../components/ui/badge.tsx";
import { cn } from "../lib/utils.ts";
import { FieldGroup, FieldSet } from "../components/ui/field.tsx";
import { LinkIcon, RotateCcwIcon } from "lucide-react";
import { NativeSelect, NativeSelectOption } from "../components/ui/native-select.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { useEffect, useRef, useState } from "react";

import { ConfirmationSurface, ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { Field, Notice } from "../components/Field.tsx";
import { TagSelection } from "../features/tags/TagSelection.tsx";

type SampleValues = { name: string; quantity: string; sale: boolean; memo: string };
const initialValues: SampleValues = { name: "유리컵", quantity: "0", sale: false, memo: "길고 자세한 예시 메모입니다. 보기와 편집에서 같은 전체 정보를 확인합니다." };
const sampleTags = [{ id: "important", name: "중요" }, { id: "reference", name: "참고" }];

type Outcome = "success" | "failure" | "uncertain";

export function ModalSamples() {
  const [values, setValues] = useState(initialValues);
  const name = values.name;
  const [tags, setTags] = useState<string[]>([]), [tagDraft, setTagDraft] = useState<string[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("success");
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const remove = () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    timer.current = setTimeout(() => {
      setBusy(false);
      pending.current = false;
      setDeleted(true);
      setDeleting(false);
      setMessage("예시 자료를 삭제했습니다. 예시 초기화로 다시 볼 수 있습니다.");
    }, 600);
  };
  return (
    <div className="grid min-w-0 gap-4">
      <Field
        label="샘플 저장 결과"
        help="실패·결과 미확정은 첫 실행에서 발생하며, 다시 시도하거나 결과를 확인하면 완료됩니다."
      >
        {(props) => (
          <NativeSelect
            {...props}
            value={outcome}
            onChange={(event) => setOutcome(event.target.value as Outcome)}
          >
            <NativeSelectOption value="success">성공</NativeSelectOption>
            <NativeSelectOption value="failure">실패 후 재시도</NativeSelectOption>
            <NativeSelectOption value="uncertain">결과 미확정 후 확인</NativeSelectOption>
          </NativeSelect>
        )}
      </Field>
      <div className="grid min-w-0 gap-4">
        <DataFields aria-label="예시 상품 전체 정보">
          <div><dt>상품명</dt><dd>{deleted ? "삭제된 예시 자료" : name}</dd></div>
          <div><dt>자료 번호</dt><dd>SAMPLE-001</dd></div>
          <div><dt>수량</dt><dd>{values.quantity}</dd></div>
          <div><dt>판매 중</dt><dd>{values.sale ? "예" : "아니요"}</dd></div>
          <div className="col-span-full"><dt>메모</dt><dd>{values.memo || "미입력"}</dd></div>
          <div className="col-span-full"><dt>태그</dt><dd>
            {tags.length ? <span className="flex flex-wrap items-center gap-2">{sampleTags.filter(tag => tags.includes(tag.id)).map(tag => <Badge variant="secondary"  key={tag.id}>{tag.name}</Badge>)}</span> : "연결된 태그 없음"}
            <Button variant="ghost" type="button"  disabled={deleted} onClick={() => setTagDraft([...tags])}><LinkIcon data-icon="inline-start" />태그 연결</Button>
          </dd></div>
        </DataFields>
        {tagDraft !== null && <section aria-label="예시 자료 태그 연결" className="flex min-w-0 flex-col gap-5">
          <TagSelection label="자료 태그" tags={sampleTags} value={tagDraft} onChange={setTagDraft} />
          <div className="flex flex-wrap items-center gap-2"><Button variant="outline"  onClick={() => setTagDraft(null)}>취소</Button><Button variant="default"  onClick={() => { setTags([...tagDraft]); setTagDraft(null); setMessage("예시 태그 연결만 적용했습니다. 상품 편집과는 별도 작업입니다."); }}>연결 적용</Button></div>
        </section>}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="destructive" type="button"  disabled={deleted || tagDraft !== null} onClick={() => setDeleting(true)}>
            예시 자료 삭제
          </Button>
          <Button variant="outline" type="button"  disabled={deleted || tagDraft !== null} onClick={() => setEditing(true)}>
            편집 모달 열기
          </Button>
        </div>
      </div>
      <div>
        <Button variant="ghost" type="button"
          onClick={() => {
            setValues(initialValues);
            setTags([]);
            setTagDraft(null);
            setDeleted(false);
            setMessage("예시 자료를 되돌렸습니다.");
          }}
        ><RotateCcwIcon data-icon="inline-start" />
          예시 자료 초기화
        </Button>
      </div>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      {editing && (
        <EditDialog
          initial={values}
          tags={tags}
          outcome={outcome}
          onClose={() => setEditing(false)}
          onSave={(value) => {
            setValues(value);
            setEditing(false);
            setMessage("예시 자료를 저장했습니다.");
          }}
        />
      )}
      <ConfirmDialog
        open={deleting}
        busy={busy}
        title="예시 자료를 삭제할까요?"
        message={<><DataFields><div className="col-span-full"><dt>대상</dt><dd>{name}</dd></div></DataFields><p>예시 자료를 삭제합니다. 실제 앱의 자료에는 영향이 없습니다.</p></>}
        danger
        confirmLabel="예시 자료 삭제"
        onCancel={() => {
          if (!pending.current) setDeleting(false);
        }}
        onConfirm={remove}
      />
    </div>
  );
}

/** The sample owns only draft/simulation state and consumes the shared official dialog compositions. */
function EditDialog(
  { initial, tags, outcome, onClose, onSave }: {
    initial: SampleValues;
    tags: string[];
    outcome: Outcome;
    onClose: () => void;
    onSave: (value: SampleValues) => void;
  },
) {
  const [draft, setDraft] = useState(initial);
  const [note, setNote] = useState("상품명 변경");
  const [recordTags, setRecordTags] = useState<string[]>([]);
  const [stage, setStage] = useState<"edit" | "review" | "discard">("edit");
  const [error, setError] = useState("");
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef(false), attempted = useRef(false);
  const snapshot = useRef<{ values: SampleValues; note: string; recordTags: string[] } | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const dismiss = () => {
    if (pending.current || uncertain) return;
    if (stage !== "edit") {
      setStage("edit");
      return;
    }
    if (JSON.stringify(draft) !== JSON.stringify(initial)) {
      setStage("discard");
    } else onClose();
  };
  const review = () => {
    if (!draft.name.trim()) {
      setError("상품명을 입력하세요.");
      nameInput.current?.focus();
      return;
    }
    setError("");
    setFailure("");
    setStage("review");
  };
  const execute = () => {
    if (pending.current) return;
    if (!uncertain) snapshot.current = { values: { ...draft }, note, recordTags: [...recordTags] };
    const submitted = snapshot.current!;
    const first = !attempted.current;
    attempted.current = true;
    pending.current = true;
    setBusy(true);
    setFailure("");
    timer.current = setTimeout(() => {
      pending.current = false;
      setBusy(false);
      if (first && outcome === "failure") {
        setFailure("저장하지 못했습니다. 입력과 기록 메모를 유지했습니다. 다시 시도하세요.");
        return;
      }
      if (first && outcome === "uncertain") {
        setUncertain(true);
        setFailure(
          "응답을 확인하지 못했습니다. 제출한 내용을 유지합니다. 결과 확인을 눌러 같은 실행의 완료 여부를 확인하세요.",
        );
        return;
      }
      onSave(submitted.values);
    }, 600);
  };
  return <>
    <ConfirmationSurface open title="상품 편집" busy={busy || uncertain} onCancel={dismiss} closeButton
      footer={<><Button type="button" variant="outline" disabled={busy || uncertain} onClick={dismiss}>취소</Button><Button type="submit" form="sample-edit-form" disabled={busy || uncertain}>저장</Button></>}>
      <p className="mb-4 text-sm text-muted-foreground">같은 전체 정보를 유지하며 수정 가능한 값만 바꿉니다. 번호와 태그는 읽기 전용입니다.</p>
            <form
              id="sample-edit-form"
              className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:wrap-anywhere"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                review();
              }}
            ><DataFieldGroup>
              <Field label="상품명" required error={error}>
                {(props) => (
                  <Input
                    {...props}
                    ref={nameInput}
                    required
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    disabled={uncertain}
                  />
                )}
              </Field>
              <DataFields><div><dt>자료 번호</dt><dd>SAMPLE-001</dd></div></DataFields>
              <Field label="수량">{props => <Input {...props}  inputMode="decimal" value={draft.quantity} onChange={e => setDraft({ ...draft, quantity: e.target.value })} readOnly={uncertain} />}</Field>
              <Field label="판매 중">{props => <NativeSelect {...props}  value={String(draft.sale)} onChange={e => setDraft({ ...draft, sale: e.target.value === "true" })} disabled={uncertain}><NativeSelectOption value="false">아니요</NativeSelectOption><NativeSelectOption value="true">예</NativeSelectOption></NativeSelect>}</Field>
              <Field fullWidth label="메모">{props => <Textarea {...props}  rows={3} value={draft.memo} onChange={e => setDraft({ ...draft, memo: e.target.value })} readOnly={uncertain} />}</Field>
              <DataFields><div><dt>태그</dt><dd>{tags.length ? <span className="flex flex-wrap items-center gap-2">{sampleTags.filter(tag => tags.includes(tag.id)).map(tag => <Badge variant="secondary" key={tag.id} >{tag.name}</Badge>)}</span> : "연결된 태그 없음"}</dd></div></DataFields>
              <p className="text-sm text-muted-foreground">취소하면 같은 보기로 돌아갑니다. 변경한 입력은 폐기 확인을 거쳐 버립니다.</p>
            </DataFieldGroup></form>
    </ConfirmationSurface>
    <ConfirmDialog open={stage === "discard"} title="변경을 버릴까요?" message="저장하지 않은 상품명 변경을 버립니다. 취소하면 입력한 내용과 편집 위치를 유지합니다."
      confirmLabel="변경 버리기" danger onCancel={() => setStage("edit")} onConfirm={onClose} />
    <ConfirmationSurface open={stage === "review"} title="변경을 저장할까요?" busy={busy || uncertain} onCancel={() => setStage("edit")} closeButton
      footer={<><Button type="button" variant="outline" disabled={busy || uncertain} onClick={() => setStage("edit")}>취소</Button><Button type="button" disabled={busy} onClick={execute}>{busy ? "처리 중…" : uncertain ? "결과 확인" : "저장"}</Button></>}>
              <FieldGroup className="flex min-w-0 flex-col gap-5">
                <DataFields>
                  {([["name", "상품명"], ["quantity", "수량"], ["sale", "판매 중"], ["memo", "메모"]] as const).map(([key, label]) => {
                    const after = snapshot.current && uncertain ? snapshot.current.values : draft;
                    const text = (value: string | boolean) => typeof value === "boolean" ? value ? "예" : "아니요" : value || "미입력";
                    return <div className={cn(key === "memo" ? "col-span-full" : undefined)} key={key}><dt>{label}</dt><dd>{text(initial[key])} → {text(after[key])}</dd></div>;
                  })}
                </DataFields>
                <Field fullWidth label="기록 메모">
                  {(props) => (
                    <Textarea
                      {...props}
                      rows={3}
                      value={note}
                      disabled={busy || uncertain}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  )}
                </Field>
                <FieldSet className="min-w-0 border-0 p-0" disabled={busy || uncertain}>
                  <TagSelection disabled={busy || uncertain} label="기록 태그" tags={sampleTags} value={recordTags} onChange={setRecordTags} />
                </FieldSet>
                {failure && <Notice kind="error">{failure}</Notice>}
                {busy && (
                  <p className="text-sm text-muted-foreground" role="status">{uncertain ? "같은 실행의 결과 확인 중…" : "예시 저장 중…"}</p>
                )}
              </FieldGroup>
    </ConfirmationSurface>
  </>;
}
