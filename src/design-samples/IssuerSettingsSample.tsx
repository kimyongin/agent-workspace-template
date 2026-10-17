import { useEffect, useRef, useState } from "react";
import { BodyAction } from "../components/BodyAction.tsx";
import { ConfirmDialog, useSurfaceViewport } from "../components/ConfirmDialog.tsx";
import { Field } from "../components/Field.tsx";
import { IssuerRow } from "../features/settings/IssuerRow.tsx";
import "../features/settings/settings.css";

type NumberKind = { label: string; active: boolean };
type Source = { label: string; numbers: NumberKind[]; system?: boolean };

/** Layout and staged creation example. Persistence and recovery belong to the real app. */
export function IssuerSettingsSample(
  { standalone = false }: { standalone?: boolean },
) {
  const Heading = standalone ? "h1" : "h2";
  const [sources, setSources] = useState<Source[]>([
    {
      label: "앱",
      numbers: [{ label: "자동 발급", active: true }],
      system: true,
    },
    {
      label: "쿠팡",
      numbers: [{ label: "상품 번호", active: true }, {
        label: "주문 번호",
        active: true,
      }],
    },
    { label: "네이버", numbers: [{ label: "상품 번호", active: true }] },
  ]);
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<
    { source?: number; created?: boolean; editSource?: number } | null
  >(null);
  const [numberEdit, setNumberEdit] = useState<
    { source: number; number: number } | null
  >(null);
  const [message, setMessage] = useState("");
  return (
    <section className="settings" aria-label="번호 출처 설정 샘플">
      <header className="page-heading">
        <Heading className="page-title">번호 설정</Heading>
        <p className="page-description">
          번호 출처는 쿠팡·옥션처럼 구분하고, 번호 종류는 상품 번호·주문 번호처럼 용도를 나눕니다.
        </p>
      </header>
      <div className="material-number-heading">
        <h2 className="section-title">번호 출처</h2>
        <BodyAction
          icon="create"
          disabled={!!numberEdit}
          onClick={() => setEditing({})}
        >
          번호 출처 추가
        </BodyAction>
      </div>
      {message && <p role="status">{message}</p>}
      <div className="issuer-registry-list">
        {sources.map((source, index) => (
          <IssuerRow
            key={index}
            label={source.label}
            summary={source.system ? "자동 발급" : undefined}
            open={selected === index}
            disabled={!!numberEdit}
            action={source.system ? undefined : selected !== index ? <span /> : (
              <BodyAction
                disabled={!!numberEdit}
                onClick={() => setEditing({ editSource: index })}
              >
                출처 편집
              </BodyAction>
            )}
            onToggle={() => setSelected(selected === index ? null : index)}
          >
            {source.numbers.length === 0 && <p className="secondary">등록된 번호 종류가 없습니다.</p>}
            <div className="issuer-rule-list">
              {source.numbers.map((number, numberIndex) => {
                const expanded = numberEdit?.source === index &&
                  numberEdit.number === numberIndex;
                return (
                  <div className="issuer-number-entry" key={numberIndex}>
                    <div className="issuer-rule-row issuer-rule-summary">
                      <div>
                        <span className="item-title">{number.label}</span>
                        <span className="secondary">
                          {source.system ? "자동 생성" : "직접 입력"}
                          {!number.active && " · 사용 중지"}
                        </span>
                      </div>
                      {!source.system && (
                        <BodyAction
                          className="issuer-rule-toggle"
                          aria-label={`${number.label} 편집`}
                          aria-expanded={expanded}
                          disabled={!!numberEdit}
                          onClick={() =>
                            setNumberEdit({
                              source: index,
                              number: numberIndex,
                            })}
                        >
                          편집
                        </BodyAction>
                      )}
                    </div>
                    {expanded && (
                      <SampleNumberEditor
                        number={number}
                        onClose={() => setNumberEdit(null)}
                        onSave={(value) => {
                          setSources((rows) =>
                            rows.map((row, i) =>
                              i === index
                                ? {
                                  ...row,
                                  numbers: row.numbers.map((old, n) => n === numberIndex ? value : old),
                                }
                                : row
                            )
                          );
                          setNumberEdit(null);
                        }}
                        onDelete={() => {
                          setSources((rows) =>
                            rows.map((row, i) =>
                              i === index
                                ? {
                                  ...row,
                                  numbers: row.numbers.filter((_, n) => n !== numberIndex),
                                }
                                : row
                            )
                          );
                          setNumberEdit(null);
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {!source.system && (
              <div>
                <BodyAction
                  icon="create"
                  disabled={!!numberEdit}
                  onClick={() => setEditing({ source: index })}
                >
                  번호 종류 추가
                </BodyAction>
              </div>
            )}
          </IssuerRow>
        ))}
      </div>
      <p className="secondary">
        실제 상품 번호·주문 번호 값은 각 자료에 입력합니다.
      </p>
      {editing && (
        <SampleCreation
          key={editing.source ?? "new"}
          initialLabel={editing.editSource === undefined ? undefined : sources[editing.editSource].label}
          source={editing.source === undefined ? undefined : sources[editing.source].label}
          created={editing.created}
          onClose={() => setEditing(null)}
          onSave={(label) => {
            if (editing.editSource !== undefined) {
              setSources(
                sources.map((source, index) => index === editing.editSource ? { ...source, label } : source),
              );
              setEditing(null);
            } else if (editing.source === undefined) {
              const index = sources.length;
              setSources([...sources, { label, numbers: [] }]);
              setSelected(index);
              setMessage("번호 출처를 저장했습니다.");
              setEditing({ source: index, created: true });
            } else {
              setSources(
                sources.map((source, index) =>
                  index === editing.source
                    ? {
                      ...source,
                      numbers: [...source.numbers, { label, active: true }],
                    }
                    : source
                ),
              );
              setMessage("번호 종류를 저장했습니다.");
              setEditing(null);
            }
          }}
        />
      )}
    </section>
  );
}

function SampleCreation({ source, created, initialLabel, onClose, onSave }: {
  source?: string;
  created?: boolean;
  initialLabel?: string;
  onClose: () => void;
  onSave: (label: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [label, setLabel] = useState(initialLabel ?? "");
  const [discard, setDiscard] = useState(false);
  useSurfaceViewport(dialog);
  useEffect(() => {
    const entry = document.activeElement as HTMLElement, node = dialog.current;
    node?.showModal();
    node?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      node?.close();
      if (entry?.isConnected) entry.focus();
    };
  }, []);
  const close = () => label !== (initialLabel ?? "") ? setDiscard(true) : onClose();
  return (
    <>
      <dialog
        ref={dialog}
        className="modal"
        aria-labelledby="issuer-sample-title"
        aria-describedby="issuer-sample-description"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <div className="modal-inner">
          <header className="modal-head">
            <h2 id="issuer-sample-title" className="dialog-title">
              {initialLabel !== undefined ? "번호 출처 편집" : source ? "번호 종류 추가" : "번호 출처 추가"}
            </h2>
            <button
              type="button"
              className="btn btn-text modal-icon"
              aria-label="닫기"
              onClick={close}
            >
              ×
            </button>
            <p id="issuer-sample-description" className="page-description">
              {source
                ? "이 번호 출처에서 쓰는 번호 종류의 이름을 정합니다."
                : "자료 번호를 발급하는 곳의 이름을 정합니다."}
            </p>
          </header>
          <div className="modal-body">
            <form
              className="form"
              id="issuer-sample-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (label.trim()) onSave(label.trim());
              }}
            >
              {source && <p className="item-title">{source}</p>}
              {created && (
                <p className="secondary" role="status">
                  번호 출처를 저장했습니다.
                </p>
              )}
              <Field
                label={source ? "번호 종류 이름" : "번호 출처 이름"}
                required
              >
                {(props) => (
                  <input
                    {...props}
                    className="input"
                    required
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                )}
              </Field>
            </form>
          </div>
          <footer className="modal-foot">
            <button type="button" className="btn" onClick={close}>
              {created ? "나중에 추가" : "취소"}
            </button>
            <button
              type="submit"
              form="issuer-sample-form"
              className="btn btn-primary"
              disabled={!label.trim()}
            >
              {source || initialLabel !== undefined ? "저장" : "저장하고 번호 추가"}
            </button>
          </footer>
        </div>
      </dialog>
      <ConfirmDialog
        open={discard}
        title="변경을 버릴까요?"
        message="입력한 내용을 버립니다."
        confirmLabel="변경 버리기"
        onCancel={() => setDiscard(false)}
        onConfirm={onClose}
      />
    </>
  );
}

function SampleNumberEditor(
  { number, onClose, onSave, onDelete }: {
    number: NumberKind;
    onClose: () => void;
    onSave: (value: NumberKind) => void;
    onDelete: () => void;
  },
) {
  const [draft, setDraft] = useState(number),
    [confirm, setConfirm] = useState<"discard" | "delete" | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const dirty = draft.label !== number.label || draft.active !== number.active;
  useEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <form
      className="issuer-rule-editor"
      aria-label="번호 종류 편집"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <fieldset className="settings-fields">
        <Field label="번호 종류 이름" required>
          {(props) => (
            <input
              {...props}
              ref={input}
              className="input"
              required
              value={draft.label}
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
            />
          )}
        </Field>
        <div className="issuer-input-method">
          <span className="label">입력 방식</span>
          <span>직접 입력</span>
        </div>
        <label className="issuer-status-choice">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
          />{" "}
          사용
        </label>
        <p className="help">사용을 중지해도 기존 자료의 번호는 유지됩니다.</p>
      </fieldset>
      <div className="issuer-rule-editor-actions">
        <BodyAction danger onClick={() => setConfirm("delete")}>
          번호 종류 삭제
        </BodyAction>
        <div>
          <button
            className="btn"
            type="button"
            onClick={() => dirty ? setConfirm("discard") : onClose()}
          >
            취소
          </button>
          <button
            className="btn btn-primary"
            disabled={!dirty || !draft.label.trim()}
          >
            저장
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={!!confirm}
        title={confirm === "delete" ? "번호 종류를 삭제할까요?" : "변경을 버릴까요?"}
        message={confirm === "delete" ? `${number.label}을 삭제합니다.` : "저장하지 않은 내용이 사라집니다."}
        confirmLabel={confirm === "delete" ? "삭제" : "변경 버리기"}
        danger={confirm === "delete"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm === "delete" ? onDelete() : onClose()}
      />
    </form>
  );
}
