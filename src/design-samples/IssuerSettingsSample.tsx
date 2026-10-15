import { useEffect, useRef, useState } from "react";
import { BodyAction } from "../components/BodyAction.tsx";
import { ConfirmDialog, useSurfaceViewport } from "../components/ConfirmDialog.tsx";
import { Field } from "../components/Field.tsx";
import { IssuerRow } from "../features/settings/IssuerRow.tsx";
import "../features/settings/settings.css";

type Source = { label: string; numbers: string[]; system?: boolean };

/** Layout and staged creation example. Persistence and recovery belong to the real app. */
export function IssuerSettingsSample({ standalone = false }: { standalone?: boolean }) {
  const Heading = standalone ? "h1" : "h2";
  const [sources, setSources] = useState<Source[]>([
    { label: "앱", numbers: ["자동 발급"], system: true },
    { label: "쿠팡", numbers: ["상품 ID", "주문 번호"] },
    { label: "네이버", numbers: ["상품 ID"] },
  ]);
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ source?: number; created?: boolean } | null>(null);
  const [message, setMessage] = useState("");
  return (
    <section className="settings" aria-label="발급처 설정 샘플">
      <header className="page-heading">
        <Heading className="page-title">발급처 설정</Heading>
        <p className="page-description">자료 번호의 발급처와 번호 종류를 관리합니다.</p>
      </header>
      <div>
        <BodyAction icon="create" onClick={() => setEditing({})}>발급처 추가</BodyAction>
      </div>
      {message && <p role="status">{message}</p>}
      <div className="issuer-registry-list">
        {sources.map((source, index) => (
          <IssuerRow
            key={index}
            label={source.label}
            summary={source.system ? "자동 발급" : undefined}
            open={selected === index}
            onToggle={() => setSelected(selected === index ? null : index)}
          >
            <div className="settings-source-heading">
              <h3 className="label">번호 종류</h3>
              {!source.system && (
                <BodyAction icon="create" onClick={() => setEditing({ source: index })}>번호 종류 추가</BodyAction>
              )}
            </div>
            {source.numbers.length === 0 && <p className="secondary">등록된 번호 종류가 없습니다.</p>}
            <div className="issuer-rule-list">
              {source.numbers.map((number) => (
                <div className="issuer-rule-row" key={number}>
                  <div>
                    <span className="item-title">{number}</span>
                    {!source.system && <span className="secondary">직접 입력</span>}
                  </div>
                </div>
              ))}
            </div>
          </IssuerRow>
        ))}
      </div>
      {editing && (
        <SampleCreation
          key={editing.source ?? "new"}
          source={editing.source === undefined ? undefined : sources[editing.source].label}
          created={editing.created}
          onClose={() => setEditing(null)}
          onSave={(label) => {
            if (editing.source === undefined) {
              const index = sources.length;
              setSources([...sources, { label, numbers: [] }]);
              setSelected(index);
              setMessage("발급처를 저장했습니다.");
              setEditing({ source: index, created: true });
            } else {
              setSources(
                sources.map((source, index) =>
                  index === editing.source ? { ...source, numbers: [...source.numbers, label] } : source
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

function SampleCreation({ source, created, onClose, onSave }: {
  source?: string;
  created?: boolean;
  onClose: () => void;
  onSave: (label: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [label, setLabel] = useState("");
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
  const close = () => label ? setDiscard(true) : onClose();
  return (
    <>
      <dialog
        ref={dialog}
        className="modal"
        aria-labelledby="issuer-sample-title"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <div className="modal-inner">
          <header className="modal-head">
            <h2 id="issuer-sample-title" className="dialog-title">{source ? "번호 종류 추가" : "발급처 추가"}</h2>
            <button type="button" className="btn btn-text modal-icon" aria-label="닫기" onClick={close}>×</button>
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
              {created && <p className="secondary" role="status">발급처를 저장했습니다.</p>}
              <Field label={source ? "번호 종류 이름" : "발급처 이름"} required>
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
            <button type="button" className="btn" onClick={close}>{created ? "나중에 추가" : "취소"}</button>
            <button type="submit" form="issuer-sample-form" className="btn btn-primary" disabled={!label.trim()}>
              {source ? "저장" : "저장하고 번호 추가"}
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
