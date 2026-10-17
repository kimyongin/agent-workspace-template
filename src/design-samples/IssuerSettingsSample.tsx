import { FieldLabel } from "../components/ui/field.tsx";
import { FieldGroup, FieldSet } from "../components/ui/field.tsx";
import { PlusIcon } from "lucide-react";
import { Checkbox } from "../components/ui/checkbox.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { useEffect, useRef, useState } from "react";

import { ConfirmDialog, ConfirmationSurface } from "../components/ConfirmDialog.tsx";
import { Field } from "../components/Field.tsx";
import { IssuerRow } from "../features/settings/IssuerRow.tsx";

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
    <section className="flex min-w-0 flex-col gap-6" aria-label="번호 출처 설정 샘플">
      <header className="flex min-w-0 flex-col gap-2">
        <Heading className="text-2xl font-semibold tracking-tight wrap-anywhere">번호 설정</Heading>
        <p className="text-sm text-muted-foreground">
          번호 출처는 쿠팡·옥션처럼 구분하고, 번호 종류는 상품 번호·주문 번호처럼 용도를 나눕니다.
        </p>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">번호 출처</h2>
        <Button variant="ghost" type="button"
          disabled={!!numberEdit}
          onClick={() => setEditing({})}
        ><PlusIcon data-icon="inline-start" />
          번호 출처 추가
        </Button>
      </div>
      {message && <p role="status">{message}</p>}
      <div className="flex min-w-0 flex-col gap-4">
        {sources.map((source, index) => (
          <IssuerRow
            key={index}
            label={source.label}
            summary={source.system ? "자동 발급" : undefined}
            open={selected === index}
            disabled={!!numberEdit}
            action={source.system ? undefined : selected !== index ? <span /> : (
              <Button variant="ghost" type="button"
                disabled={!!numberEdit}
                onClick={() => setEditing({ editSource: index })}
              >
                출처 편집
              </Button>
            )}
            onToggle={() => setSelected(selected === index ? null : index)}
          >
            {source.numbers.length === 0 && <p className="text-sm text-muted-foreground">등록된 번호 종류가 없습니다.</p>}
            <div className="flex min-w-0 flex-col gap-4">
              {source.numbers.map((number, numberIndex) => {
                const expanded = numberEdit?.source === index &&
                  numberEdit.number === numberIndex;
                return (
                  <div className="flex min-w-0 flex-col gap-4" key={numberIndex}>
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                      {!expanded && <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4 [&_dd]:min-w-0 min-w-0 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:wrap-anywhere min-w-0 flex-1">
                        <div><dt>번호 종류 이름</dt><dd>{number.label}</dd></div>
                        <div><dt>입력 방식</dt><dd>{source.system ? "자동 생성" : "직접 입력"}</dd></div>
                        <div><dt>사용</dt><dd>{number.active ? "사용 중" : "사용 중지"}</dd></div>
                      </dl>}
                      {!source.system && (
                        <Button variant="ghost" type="button"
                          className="self-start"
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
                        </Button>
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
                <Button variant="ghost" type="button"
                  disabled={!!numberEdit}
                  onClick={() => setEditing({ source: index })}
                ><PlusIcon data-icon="inline-start" />
                  번호 종류 추가
                </Button>
              </div>
            )}
          </IssuerRow>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
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
  const [label, setLabel] = useState(initialLabel ?? "");
  const [discard, setDiscard] = useState(false);
  const close = () => label !== (initialLabel ?? "") ? setDiscard(true) : onClose();
  return (
    <>
      <ConfirmationSurface open title={initialLabel !== undefined ? "번호 출처 편집" : source ? "번호 종류 추가" : "번호 출처 추가"}
        onCancel={close} closeButton footer={<><Button type="button" variant="outline" onClick={close}>{created ? "나중에 추가" : "취소"}</Button><Button type="submit" form="issuer-sample-form" disabled={!label.trim()}>{source || initialLabel !== undefined ? "저장" : "저장하고 번호 추가"}</Button></>}>
        <p className="mb-4 text-sm text-muted-foreground">{source ? "이 번호 출처에서 쓰는 번호 종류의 이름을 정합니다." : "자료 번호를 발급하는 곳의 이름을 정합니다."}</p>
            <form
              className="flex min-w-0 flex-col gap-5"
              id="issuer-sample-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (label.trim()) onSave(label.trim());
              }}
            ><FieldGroup>
              {source && <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4 [&_dd]:min-w-0 min-w-0 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:wrap-anywhere"><div><dt>번호 출처</dt><dd>{source}</dd></div></dl>}
              {created && (
                <p className="text-sm text-muted-foreground" role="status">
                  번호 출처를 저장했습니다.
                </p>
              )}
              <Field
                label={source ? "번호 종류 이름" : "번호 출처 이름"}
                required
              >
                {(props) => (
                  <Input
                    {...props}
                    required
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                )}
              </Field>
            </FieldGroup></form>
      </ConfirmationSurface>
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
      className="flex min-w-0 flex-col gap-4"
      aria-label="번호 종류 편집"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    ><FieldGroup>
      <FieldSet className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:wrap-anywhere">
        <Field label="번호 종류 이름" required>
          {(props) => (
            <Input
              {...props}
              ref={input}
              required
              value={draft.label}
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
            />
          )}
        </Field>
        <dl className="min-w-0 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:wrap-anywhere"><div><dt>입력 방식</dt><dd>직접 입력</dd></div></dl>
        <FieldLabel className="min-h-11 w-full flex-wrap items-center gap-3">
          <Checkbox

            checked={draft.active}
            onCheckedChange={(checked) => setDraft({ ...draft, active: (checked === true) })}
          />{" "}
          사용
        </FieldLabel>
        <p className="text-sm text-muted-foreground">사용을 중지해도 기존 자료의 번호는 유지됩니다.</p>
      </FieldSet>
      <div className="flex min-w-0 flex-col gap-4-actions">
        <Button variant="destructive" type="button"  onClick={() => setConfirm("delete")}>
          번호 종류 삭제
        </Button>
        <div>
          <Button variant="outline"
            type="button"
            onClick={() => dirty ? setConfirm("discard") : onClose()}
          >
            취소
          </Button>
          <Button variant="default"
            disabled={!dirty || !draft.label.trim()}
          >
            저장
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={!!confirm}
        title={confirm === "delete" ? "번호 종류를 삭제할까요?" : "변경을 버릴까요?"}
        message={confirm === "delete" ? <><dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4 [&_dd]:min-w-0 min-w-0 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:wrap-anywhere"><div><dt>대상</dt><dd>{number.label}</dd></div></dl><p>예시 번호 종류를 삭제합니다.</p></> : "저장하지 않은 내용이 사라집니다."}
        confirmLabel={confirm === "delete" ? "삭제" : "변경 버리기"}
        danger={confirm === "delete"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm === "delete" ? onDelete() : onClose()}
      />
    </FieldGroup></form>
  );
}
