import { BusinessTable, BusinessRow, BusinessCell } from "../../components/BusinessTable.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FieldGroup, FieldSet, FieldLabel } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  type EntityIssuer,
  type IdentifierRule,
  type IdentityDefaultType,
  identityDefaultTypeField,
} from "@contracts/entity-issuer.ts";

import { DefaultIssuerRepair } from "./DefaultIssuerRepair.tsx";
import { Field } from "../../components/Field.tsx";
import { ConfirmDialog, ModalShell } from "../../components/Modal.tsx";
import { ApiError } from "../../lib/api.ts";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
import { useIssuerRegistry } from "./issuer-registry-api.ts";
import type { MaterialSectionState } from "./MaterialSettingsSection.tsx";
export type RegistryEditTarget = { kind: "issuer"; issuer?: EntityIssuer } | {
  kind: "rule";
  source: string;
  sourceLabel: string;
  createdIssuer?: boolean;
  rule?: IdentifierRule;
};
export function IssuerRegistryEditor(
  { target, onClose, onSaved, onState, onDeleted, inline = false }: {
    target: RegistryEditTarget;
    /** The owning list protects close, switches and navigation for inline edits. */
    inline?: boolean;
    onClose: () => void;
    onDeleted?: () => void;
    onSaved: (value: EntityIssuer | IdentifierRule) => void;
    onState?: (state: MaterialSectionState) => void;
  },
) {
  const issuerRegistry = useIssuerRegistry();
  const form = useRef<HTMLFormElement>(null);
  const formId = useId();
  useEffect(() => {
    if (inline) form.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [inline]);
  const original = target.kind === "issuer" ? target.issuer : target.rule;
  const [baseline, setBaseline] = useState(original),
    [label, setLabel] = useState(original?.label ?? ""),
    [active, setActive] = useState(original?.active ?? true);
  const [code] = useState(() => `issuer_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`);
  const [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [latest, setLatest] = useState<EntityIssuer | IdentifierRule | null>(null),
    [reading, setReading] = useState(false),
    [confirmDisable, setConfirmDisable] = useState(false);
  const saving = useWriteAttempt(), deleting = useWriteAttempt();
  const { attempt } = saving;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [blockedTypes, setBlockedTypes] = useState<IdentityDefaultType[]>([]);
  const [repairing, setRepairing] = useState<IdentityDefaultType | null>(null);
  const [repairState, setRepairState] = useState({
    busy: false,
    uncertain: false,
  });
  const reportRepair = useCallback(
    (busy: boolean, uncertain: boolean) => setRepairState({ busy, uncertain }),
    [],
  );
  const busy = saving.busy || deleting.busy || repairState.busy;
  const uncertain = saving.uncertain || deleting.uncertain ||
    repairState.uncertain;
  const showFailure = (e: unknown) => {
    const changed = e instanceof ApiError && e.code === "settings_changed";
    setConflict(changed);
    setError(
      changed ? `${e.message} 입력을 유지했습니다. 최신 저장값을 확인하세요.` : writeErrorMessage(e),
    );
    setBlockedTypes(
      e instanceof ApiError
        ? e.fields.filter((f) => f.path.startsWith(identityDefaultTypeField))
          .map((f) => ({
            type_id: f.path.slice(identityDefaultTypeField.length),
            label: f.message,
          }))
        : [],
    );
  };
  const remove = async () => {
    if (!baseline || busy || reading || conflict || !onDeleted) return;
    setConfirmDelete(false);
    setError("");
    try {
      await deleting.attempt.run(async () => {
        if (target.kind === "issuer") {
          await issuerRegistry.remove(
            (baseline as EntityIssuer).code,
            baseline.version,
            deleting.attempt.requestKey(),
          );
        } else {
          await issuerRegistry.removeRule(
            (baseline as IdentifierRule).id,
            baseline.version,
            deleting.attempt.requestKey(),
          );
        }
        if (mounted.current) onDeleted();
      });
    } catch (e) {
      if (mounted.current) showFailure(e);
    }
  };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const dirty = label !== (baseline?.label ?? "") ||
    active !== (baseline?.active ?? true);
  useEffect(() => {
    onState?.({
      dirty: dirty || conflict,
      busy: busy || reading,
      uncertain,
      error: !!error,
    });
  }, [dirty, conflict, busy, reading, uncertain, error, onState]);
  useEffect(
    () => () => onState?.({ dirty: false, busy: false, uncertain: false }),
    [onState],
  );
  const save = async (confirmed = false) => {
    if (busy || reading || conflict || (!dirty && !uncertain)) return;
    if (!label.trim()) {
      setError("이름을 입력하세요.");
      return;
    }
    if (baseline?.active && !active && !confirmed && !uncertain) {
      setConfirmDisable(true);
      return;
    }
    setConfirmDisable(false);
    setError("");
    try {
      await attempt.run(async () => {
        const saved = target.kind === "issuer"
          ? baseline
            ? await issuerRegistry.update((baseline as EntityIssuer).code, {
              label,
              active,
              expected_version: baseline.version,
            }, attempt.requestKey())
            : await issuerRegistry.create({ code, label }, attempt.requestKey())
          : baseline
          ? await issuerRegistry.updateRule((baseline as IdentifierRule).id, {
            label,
            active,
            expected_version: baseline.version,
          }, attempt.requestKey())
          : await issuerRegistry.createRule(target.source, {
            label,
            meaning: label,
          }, attempt.requestKey());
        if (mounted.current) onSaved(saved);
      });
    } catch (e) {
      if (!mounted.current) return;
      showFailure(e);
    }
  };
  const readLatest = async () => {
    if (!baseline || busy || uncertain || reading) return;
    setReading(true);
    setError("");
    try {
      const rows = target.kind === "issuer"
        ? (await issuerRegistry.list()).items
        : (await issuerRegistry.rules(target.source)).items;
      const row = rows.find((r) =>
        "code" in r ? r.code === (baseline as EntityIssuer).code : r.id === (baseline as IdentifierRule).id
      );
      if (!row) throw new Error("최신 설정을 찾을 수 없습니다.");
      if (mounted.current) setLatest(row);
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : "조회하지 못했습니다.");
      }
    } finally {
      if (mounted.current) setReading(false);
    }
  };
  const deleteAction = baseline && onDeleted && (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button variant="destructive" type="button"

        disabled={busy || reading || conflict || saving.uncertain ||
          repairState.uncertain}
        onClick={() => deleting.uncertain ? void remove() : setConfirmDelete(true)}
      >
        {deleting.uncertain ? "삭제 결과 다시 확인" : target.kind === "issuer" ? "번호 출처 삭제" : "번호 종류 삭제"}
      </Button>
    </div>
  );
  const footer = (requestClose: () => void) => (
    <>
      <Button variant="outline"

        type="button"
        disabled={busy || reading || uncertain}
        onClick={requestClose}
      >
        {target.kind === "rule" && target.createdIssuer ? "나중에 추가" : "취소"}
      </Button>
      <Button variant="default"

        type="submit"
        form={formId}
        disabled={busy || reading || conflict || deleting.uncertain ||
          repairState.uncertain ||
          (!dirty && !uncertain)}
      >
        {saving.busy
          ? "저장 중…"
          : saving.uncertain
          ? "같은 요청 다시 확인"
          : target.kind === "issuer" && !baseline
          ? "저장하고 번호 추가"
          : "저장"}
      </Button>
    </>
  );
  const blockedChoices = blockedTypes.filter(type => type.type_id !== repairing?.type_id);
  const content = (
    <>
      <form
        id={formId}
        ref={form}
        className="flex min-w-0 flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {target.kind === "rule" && !inline && <p className="min-w-0 [overflow-wrap:anywhere]">{target.sourceLabel}</p>}
        {target.kind === "rule" && target.createdIssuer && (
          <Alert role="status" className="text-sm text-muted-foreground"><AlertDescription>번호 출처를 저장했습니다.</AlertDescription></Alert>
        )}
        {error && <Alert variant="destructive" className="text-sm text-destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        {blockedTypes.length > 0 && (
          <FieldGroup className="min-w-0">
            {blockedChoices.length > 0 && <BusinessTable label="기본 출처 변경이 필요한 자료 종류" columns={["자료 종류", "조작"]} disclosureColumn={false}>
              {blockedChoices.map(type => <BusinessRow key={type.type_id}>
                <BusinessCell index={0}>{type.label}</BusinessCell>
                <BusinessCell index={1}><Button variant="ghost" type="button" aria-label={`${type.label} 기본 번호 출처 변경`} disabled={busy || uncertain} onClick={() => setRepairing(type)}>기본 번호 출처 변경</Button></BusinessCell>
              </BusinessRow>)}
            </BusinessTable>}
            {repairing && (
              <DefaultIssuerRepair
                key={repairing.type_id}
                type={repairing}
                blockedSource={target.kind === "issuer" ? (baseline as EntityIssuer).code : target.source}
                blockedRule={target.kind === "rule" ? target.rule?.id : undefined}
                onState={reportRepair}
                onSaved={() => {
                  setBlockedTypes((current) => current.filter((t) => t.type_id !== repairing.type_id));
                  setRepairing(null);
                  setRepairState({ busy: false, uncertain: false });
                  setError("");
                  requestAnimationFrame(() =>
                    form.current?.querySelector<HTMLInputElement>("input")
                      ?.focus()
                  );
                }}
              />
            )}
          </FieldGroup>
        )}
        {conflict && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline"
              type="button"

              disabled={busy || uncertain || reading}
              onClick={() => void readLatest()}
            >
              {reading ? "확인 중…" : "최신 저장값 확인"}
            </Button>
            {latest && (
              <>
                <p className="text-sm text-muted-foreground">
                  최신 저장값: {latest.label} · {latest.active ? "사용 중" : "중지"}
                </p>
                <Button variant="outline"

                  type="button"
                  onClick={() => {
                    setBaseline(latest);
                    setLatest(null);
                    setConflict(false);
                    setError("");
                    attempt.reset();
                    deleting.attempt.reset();
                  }}
                >
                  입력 유지하고 최신 버전 사용
                </Button>
              </>
            )}
          </div>
        )}
        <FieldSet
          className="min-w-0 grid gap-4 sm:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]"
          disabled={busy || reading || uncertain}
        >
          <Field
            label={target.kind === "issuer" ? "번호 출처 이름" : "번호 종류 이름"}
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
          {inline && target.kind === "rule" && baseline && (
            <dl className="grid min-w-0 gap-3 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]">
              <div>
                <dt>입력 방식</dt>
                <dd>
                  {target.rule?.generation === "automatic" ? "자동 생성" : "직접 입력"}
                </dd>
              </div>
            </dl>
          )}
          {baseline && (
            <FieldLabel className="flex min-h-11 cursor-pointer items-center gap-3">
              <Checkbox

                checked={active}
                onCheckedChange={(checked) => setActive(checked === true)}
              />{" "}
              사용
            </FieldLabel>
          )}
          {inline && (
            <p className="text-sm text-muted-foreground">
              사용을 중지해도 기존 자료의 번호는 유지됩니다.
            </p>
          )}
        </FieldSet>

        {!inline && deleteAction}
      </form>
      <ConfirmDialog
        open={confirmDelete}
        danger
        title={target.kind === "issuer" ? "번호 출처를 삭제할까요?" : "번호 종류를 삭제할까요?"}
        message={<><dl className="grid min-w-0 gap-4 sm:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere] gap-3"><div className="col-span-full"><dt>대상</dt><dd>{baseline?.label ?? "항목"}</dd></div></dl><p>영구 삭제합니다. 연결되거나 사용된 항목은 삭제할 수 없습니다.</p></>}
        confirmLabel="삭제"
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
      <ConfirmDialog
        open={confirmDisable}
        title="사용을 중지할까요?"
        message="새 자료 등록에 이 번호 출처·번호 종류를 사용하지 않게 됩니다."
        confirmLabel="중지하고 저장"
        busy={busy}
        onConfirm={() => void save(true)}
        onCancel={() => setConfirmDisable(false)}
      />
    </>
  );
  if (inline) {
    return (
      <section className="flex min-w-0 flex-col gap-4 py-4" aria-label="번호 종류 편집">
        {content}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {deleteAction}
          <div>{footer(onClose)}</div>
        </div>
      </section>
    );
  }
  return (
    <ModalShell
      open
      description={target.kind === "issuer"
        ? "자료 번호의 번호 출처 이름과 사용 상태를 관리합니다."
        : "번호 출처에서 쓰는 번호 종류의 이름과 사용 상태를 관리합니다."}
      title={target.kind === "issuer"
        ? baseline ? "번호 출처 편집" : "번호 출처 추가"
        : baseline
        ? "번호 종류 편집"
        : "번호 종류 추가"}
      dirty={dirty || conflict || uncertain}
      busy={busy || reading || uncertain}
      onClose={onClose}
      footer={footer}
    >
      {content}
    </ModalShell>
  );
}
