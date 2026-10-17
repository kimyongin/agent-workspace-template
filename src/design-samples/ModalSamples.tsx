import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BodyAction } from "../components/BodyAction.tsx";
import { ConfirmationSurface, ConfirmDialog, useSurfaceViewport } from "../components/ConfirmDialog.tsx";
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
    <div className="samples-stack">
      <Field
        pair
        label="샘플 저장 결과"
        help="실패·결과 미확정은 첫 실행에서 발생하며, 다시 시도하거나 결과를 확인하면 완료됩니다."
      >
        {(props) => (
          <select
            {...props}
            className="input"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value as Outcome)}
          >
            <option value="success">성공</option>
            <option value="failure">실패 후 재시도</option>
            <option value="uncertain">결과 미확정 후 확인</option>
          </select>
        )}
      </Field>
      <div className="samples-read">
        <dl className="key-value-grid key-value-static samples-values" aria-label="예시 상품 전체 정보">
          <div><dt>상품명</dt><dd>{deleted ? "삭제된 예시 자료" : name}</dd></div>
          <div><dt>자료 번호</dt><dd>SAMPLE-001</dd></div>
          <div><dt>수량</dt><dd>{values.quantity}</dd></div>
          <div><dt>판매 중</dt><dd>{values.sale ? "예" : "아니요"}</dd></div>
          <div className="key-value-full"><dt>메모</dt><dd>{values.memo || "미입력"}</dd></div>
          <div className="key-value-full"><dt>태그</dt><dd>
            {tags.length ? <span className="chips">{sampleTags.filter(tag => tags.includes(tag.id)).map(tag => <span className="chip" key={tag.id}>{tag.name}</span>)}</span> : "연결된 태그 없음"}
            <BodyAction icon="link" disabled={deleted} onClick={() => setTagDraft([...tags])}>태그 연결</BodyAction>
          </dd></div>
        </dl>
        {tagDraft !== null && <section aria-label="예시 자료 태그 연결" className="form">
          <TagSelection label="자료 태그" tags={sampleTags} value={tagDraft} onChange={setTagDraft} />
          <div className="actions"><button className="btn" onClick={() => setTagDraft(null)}>취소</button><button className="btn btn-primary" onClick={() => { setTags([...tagDraft]); setTagDraft(null); setMessage("예시 태그 연결만 적용했습니다. 상품 편집과는 별도 작업입니다."); }}>연결 적용</button></div>
        </section>}
        <div className="actions schema-actions">
          <button type="button" className="btn btn-danger" disabled={deleted || tagDraft !== null} onClick={() => setDeleting(true)}>
            예시 자료 삭제
          </button>
          <button type="button" className="btn" disabled={deleted || tagDraft !== null} onClick={() => setEditing(true)}>
            편집 모달 열기
          </button>
        </div>
      </div>
      <div>
        <BodyAction
          icon="reset"
          onClick={() => {
            setValues(initialValues);
            setTags([]);
            setTagDraft(null);
            setDeleted(false);
            setMessage("예시 자료를 되돌렸습니다.");
          }}
        >
          예시 자료 초기화
        </BodyAction>
      </div>
      {message && <p role="status" className="secondary">{message}</p>}
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
        message={<><dl className="key-value-grid key-value-static"><div className="key-value-full"><dt>대상</dt><dd>{name}</dd></div></dl><p>예시 자료를 삭제합니다. 실제 앱의 자료에는 영향이 없습니다.</p></>}
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

/** The sample owns draft/simulation state; native dialog and app classes provide the visual shell. */
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
  const dialog = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entry = useRef<HTMLElement | null>(null);
  useSurfaceViewport(dialog);
  useEffect(() => {
    entry.current = document.activeElement as HTMLElement;
    const node = dialog.current;
    node?.showModal();
    node?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      node?.close();
      if (entry.current?.isConnected) entry.current.focus();
    };
  }, []);
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
      dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
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
  return createPortal(
    <>
      <dialog
        ref={dialog}
        className="modal"
        aria-labelledby="sample-editor-title"
        aria-describedby="sample-editor-description"
        onCancel={(event) => {
          event.preventDefault();
          dismiss();
        }}
      >
        <div className="modal-inner">
          <header className="modal-head">
            <h2 id="sample-editor-title" className="dialog-title">상품 편집</h2>
            <button
              type="button"
              className="btn btn-text modal-icon"
              aria-label="닫기"
              disabled={busy || uncertain}
              onClick={dismiss}
            >
              <span aria-hidden="true">×</span>
            </button>
            <p id="sample-editor-description" className="page-description">같은 전체 정보를 유지하며 수정 가능한 값만 바꿉니다. 번호와 태그는 읽기 전용입니다.</p>
          </header>
          <div className="modal-body">
            <form
              id="sample-edit-form"
              className="key-value-grid"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                review();
              }}
            >
              <Field pair label="상품명" required error={error}>
                {(props) => (
                  <input
                    {...props}
                    className="input"
                    required
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    disabled={uncertain}
                  />
                )}
              </Field>
              <dl className="key-value-static"><div><dt>자료 번호</dt><dd>SAMPLE-001</dd></div></dl>
              <Field pair label="수량">{props => <input {...props} className="input" inputMode="decimal" value={draft.quantity} onChange={e => setDraft({ ...draft, quantity: e.target.value })} readOnly={uncertain} />}</Field>
              <Field pair label="판매 중">{props => <select {...props} className="input" value={String(draft.sale)} onChange={e => setDraft({ ...draft, sale: e.target.value === "true" })} disabled={uncertain}><option value="false">아니요</option><option value="true">예</option></select>}</Field>
              <Field pair fullWidth label="메모">{props => <textarea {...props} className="input" rows={3} value={draft.memo} onChange={e => setDraft({ ...draft, memo: e.target.value })} readOnly={uncertain} />}</Field>
              <dl className="key-value-static key-value-full"><div><dt>태그</dt><dd>{tags.length ? <span className="chips">{sampleTags.filter(tag => tags.includes(tag.id)).map(tag => <span key={tag.id} className="chip">{tag.name}</span>)}</span> : "연결된 태그 없음"}</dd></div></dl>
              <p className="secondary">취소하면 같은 보기로 돌아갑니다. 변경한 입력은 폐기 확인을 거쳐 버립니다.</p>
            </form>
          </div>
          <footer className="modal-foot">
            <button type="button" className="btn" onClick={dismiss}>취소</button>
            <button type="submit" form="sample-edit-form" className="btn btn-primary">저장</button>
          </footer>
        </div>
      </dialog>
      {stage !== "edit" && (
        <ConfirmationSurface
          open
          title={stage === "discard" ? "변경을 버릴까요?" : "변경을 저장할까요?"}
          busy={busy || uncertain}
          onCancel={() => setStage("edit")}
          closeButton
          footer={stage === "discard"
            ? (
              <>
                <button type="button" className="btn" onClick={() => setStage("edit")}>계속 편집</button>
                <button type="button" className="btn btn-danger" onClick={onClose}>변경 버리기</button>
              </>
            )
            : (
              <>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || uncertain}
                  onClick={() => setStage("edit")}
                >
                  취소
                </button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={execute}>
                  {busy ? "처리 중…" : uncertain ? "결과 확인" : "저장"}
                </button>
              </>
            )}
        >
          {stage === "discard"
            ? <p>저장하지 않은 상품명 변경을 버립니다. 취소하면 입력한 내용과 편집 위치를 유지합니다.</p>
            : (
              <div className="form">
                <dl className="key-value-grid key-value-static samples-values">
                  {([["name", "상품명"], ["quantity", "수량"], ["sale", "판매 중"], ["memo", "메모"]] as const).map(([key, label]) => {
                    const after = snapshot.current && uncertain ? snapshot.current.values : draft;
                    const text = (value: string | boolean) => typeof value === "boolean" ? value ? "예" : "아니요" : value || "미입력";
                    return <div className={key === "memo" ? "key-value-full" : undefined} key={key}><dt>{label}</dt><dd>{text(initial[key])} → {text(after[key])}</dd></div>;
                  })}
                </dl>
                <Field pair fullWidth label="기록 메모">
                  {(props) => (
                    <textarea
                      {...props}
                      className="input"
                      rows={3}
                      value={note}
                      disabled={busy || uncertain}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  )}
                </Field>
                <fieldset className="plain-fieldset" disabled={busy || uncertain}>
                  <TagSelection label="기록 태그" tags={sampleTags} value={recordTags} onChange={setRecordTags} />
                </fieldset>
                {failure && <Notice kind="error">{failure}</Notice>}
                {busy && (
                  <p className="secondary" role="status">{uncertain ? "같은 실행의 결과 확인 중…" : "예시 저장 중…"}</p>
                )}
              </div>
            )}
        </ConfirmationSurface>
      )}
    </>,
    document.body,
  );
}
