import { useSettingsAccess } from "./workspace-settings-access.tsx";
import { useApi } from "../../lib/api-context.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FieldSet } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Button } from "../../components/ui/button.tsx";
import { useEffect, useRef, useState } from "react";
import type { EntityRelationDefinition, EntityRelationEnd } from "@contracts/entity-relation.ts";
import { relationDefinitionCreate } from "@contracts/entity-relation.ts";
import type { EntityType } from "@contracts/entity-type.ts";
import { ApiError } from "../../lib/api.ts";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
import { Field } from "../../components/Field.tsx";
import { ConfirmDialog } from "../../components/Modal.tsx";

export function RelationDefinitionForm(
  { original, types, onClose, onSaved, onState }: {
    original?: EntityRelationDefinition;
    types: EntityType[];
    onClose: () => void;
    onSaved: () => void;
    onState: (s: { dirty: boolean; busy: boolean }) => void;
  },
) {
  const { canWrite } = useSettingsAccess();
  const api = useApi();
  const [baseline, setBaseline] = useState(original),
    [ends, setEnds] = useState<EntityRelationDefinition["ends"]>(() =>
      original?.ends ??
        [{ type_id: "", label: "", cardinality: "many" }, { type_id: "", label: "", cardinality: "many" }]
    ),
    [archived, setArchived] = useState(original?.archived ?? false);
  const [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [latest, setLatest] = useState<EntityRelationDefinition | null>(null),
    [reading, setReading] = useState(false),
    [confirm, setConfirm] = useState<"cancel" | "delete" | null>(null);
  const writing = useWriteAttempt(), [operation, setOperation] = useState("save");
  const dirty = JSON.stringify(ends) !==
      JSON.stringify(
        baseline?.ends ??
          [{ type_id: "", label: "", cardinality: "many" }, { type_id: "", label: "", cardinality: "many" }],
      ) || archived !== (baseline?.archived ?? false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.querySelector<HTMLSelectElement>("select")?.focus();
  }, []);
  useEffect(() => {
    onState({ dirty: dirty || writing.uncertain, busy: writing.busy || writing.uncertain || reading });
  }, [dirty, writing.uncertain, writing.busy, reading, onState]);
  useEffect(() => () => onState({ dirty: false, busy: false }), [onState]);
  const fail = (e: unknown) => {
    setConflict(e instanceof ApiError && e.code === "settings_changed");
    setError(writeErrorMessage(e));
  };
  const save = async () => {
    if (!canWrite || writing.busy || reading || conflict) return;
    if (!writing.uncertain && !relationDefinitionCreate.safeParse({ ends }).success) {
      setError("양쪽 자료 종류와 연결 이름을 입력하세요.");
      return;
    }
    setError("");
    setOperation("save");
    try {
      await writing.attempt.run(async () => {
        await api(
          baseline ? "PATCH" : "POST",
          `/entity-relation-definitions${baseline ? `/${baseline.id}` : ""}`,
          baseline ? { ends, archived, expected_version: baseline.version } : { ends },
          undefined,
          writing.attempt.requestKey(),
        );
        onSaved();
      });
    } catch (e) {
      fail(e);
    }
  };
  const remove = async () => {
    if (!canWrite || !baseline) return;
    setConfirm(null);
    setError("");
    setOperation("delete");
    try {
      await writing.attempt.run(async () => {
        await api(
          "DELETE",
          `/entity-relation-definitions/${baseline.id}`,
          { expected_version: baseline.version },
          undefined,
          writing.attempt.requestKey(),
        );
        onSaved();
      });
    } catch (e) {
      fail(e);
    }
  };
  const change = (side: number, patch: Partial<EntityRelationEnd>) =>
    setEnds((old) => old.map((end, n) => n === side ? { ...end, ...patch } : end) as EntityRelationDefinition["ends"]);
  return (
    <form
      className="flex min-w-0 flex-col gap-5"
      ref={form}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="text-sm text-muted-foreground">
        자료는 연결 없이도 작성할 수 있습니다.
      </p>
      <FieldSet disabled={!canWrite || writing.busy || writing.uncertain || reading} className="grid min-w-0 gap-6 lg:grid-cols-2">
        {ends.map((end, n) => {
          const prefix = n === 0 ? "첫 번째" : "두 번째";
          return (
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]" key={n}>
              <h3>{types.find((type) => type.id === end.type_id)?.label ?? `${prefix} 자료`}에서 보이는 연결</h3>
              <Field label="자료 종류" required>
                {(props) => (
                  <NativeSelect

                    {...props}
                    aria-label={`${prefix} 자료 종류`}
                    value={end.type_id}
                    onChange={(e) => change(n, { type_id: e.target.value })}
                  >
                    <NativeSelectOption value="">종류 선택</NativeSelectOption>
                    {types.filter((t) => !t.archived || t.id === end.type_id).map((t) => (
                      <NativeSelectOption key={t.id} value={t.id}>{t.label}{t.archived ? " (보관)" : ""}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label="연결 이름" required help="이 자료에서 상대를 부르는 이름입니다.">
                {(props) => (
                  <Input

                    {...props}
                    aria-label={`${prefix} 연결 이름`}
                    value={end.label}
                    maxLength={100}
                    onChange={(e) => change(n, { label: e.target.value })}
                  />
                )}
              </Field>
              <Field label="연결 개수" help="몇 개까지 연결할 수 있는지 정합니다.">
                {(props) => (
                  <NativeSelect

                    {...props}
                    aria-label={`${prefix} 연결 개수`}
                    value={end.cardinality}
                    onChange={(e) => change(n, { cardinality: e.target.value as "one" | "many" })}
                  >
                    <NativeSelectOption value="one">하나만</NativeSelectOption>
                    <NativeSelectOption value="many">여러 개</NativeSelectOption>
                  </NativeSelect>
                )}
              </Field>
            </div>
          );
        })}
      </FieldSet>
      {baseline && (
        <Field label="보관" help="기존 연결을 유지하고 새 연결을 중단합니다.">
          {(props) => (
            <Checkbox
              {...props}

              checked={archived}
              disabled={writing.busy || writing.uncertain || reading}
              onCheckedChange={(checked) => setArchived(checked === true)}
            />
          )}
        </Field>
      )}
      {error && (
        <Alert variant="destructive" role="alert"><AlertDescription>
          {error}
          {conflict && baseline && (
            <Button variant="ghost" type="button"
              disabled={reading}
              onClick={async () => {
                setReading(true);
                try {
                  setLatest(await api("GET", `/entity-relation-definitions/${baseline.id}`));
                } catch (e) {
                  fail(e);
                } finally {
                  setReading(false);
                }
              }}
            >
              최신 버전 확인
            </Button>
          )}
        </AlertDescription></Alert>
      )}
      {latest && (
        <div>
          <p>
            최신 버전 {latest.version}: {latest.ends.map((e) => e.label).join(" ↔ ")}
            {latest.archived ? " · 보관" : ""}. 내 입력은 유지됩니다.
          </p>
          <Button variant="ghost" type="button"
            onClick={() => {
              setBaseline(latest);
              setLatest(null);
              setConflict(false);
              setError("");
            }}
          >
            내 입력으로 다시 검토
          </Button>
          <Button variant="ghost" type="button"
            onClick={() => {
              setBaseline(latest);
              setEnds(latest.ends);
              setArchived(latest.archived);
              setLatest(null);
              setConflict(false);
              setError("");
            }}
          >
            최신 값 사용
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {baseline && (
          <Button variant="destructive"

            type="button"
            disabled={!canWrite || writing.busy || reading || conflict || writing.uncertain && operation !== "delete"}
            onClick={() => writing.uncertain ? void remove() : setConfirm("delete")}
          >
            {writing.uncertain && operation === "delete" ? "같은 삭제 다시 확인" : "삭제"}
          </Button>
        )}
        <Button variant="outline"

          type="button"
          disabled={writing.busy || writing.uncertain || reading}
          onClick={() => dirty ? setConfirm("cancel") : onClose()}
        >
          취소
        </Button>
        <Button variant="default"

          type="submit"
          disabled={!canWrite || writing.busy || reading || conflict || writing.uncertain && operation !== "save" ||
            !!baseline && !dirty && !writing.uncertain}
        >
          {writing.busy ? "처리 중…" : writing.uncertain ? "같은 저장 다시 확인" : baseline ? "저장" : "추가"}
        </Button>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "delete" ? "연결 설정을 삭제할까요?" : "변경을 버릴까요?"}
        message={confirm === "delete"
          ? <><dl className="grid min-w-0 gap-4 sm:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere] gap-3"><div className="col-span-full"><dt>대상</dt><dd>{ends.map(end => end.label).join(" ↔ ")}</dd></div></dl><p>자료 연결이 있는 설정은 삭제할 수 없습니다. 기존 연결을 유지하려면 보관하세요.</p></>
          : "저장하지 않은 연결 설정이 사라집니다."}
        confirmLabel={confirm === "delete" ? "삭제" : "버리기"}
        onConfirm={() => confirm === "delete" ? void remove() : onClose()}
        onCancel={() => setConfirm(null)}
      />
    </form>
  );
}
