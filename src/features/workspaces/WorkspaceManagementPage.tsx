import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { useDeferredNavigation } from "../../lib/useDeferredNavigation.ts";
import { usePageNavigationBlocker } from "../details/workspace-context.ts";
import type {
  WorkspaceGrant,
  WorkspaceInvitation,
  WorkspaceMember,
} from "@contracts/workspace.ts";
import { useApi, useRequestScope } from "../../lib/api-context.tsx";
import { useWorkspaceCapabilities } from "./workspace-context.tsx";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
import { Button } from "../../components/ui/button.tsx";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../../components/ui/field.tsx";
import { Input } from "../../components/ui/input.tsx";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../components/ui/toggle-group.tsx";
import { Alert, AlertDescription } from "../../components/ui/alert.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import {
  BusinessCell,
  BusinessRow,
  BusinessTable,
} from "../../components/BusinessTable.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "../../components/ui/empty.tsx";
import { ConfirmDialog, ModalShell } from "../../components/Modal.tsx";
type Target = { id: string; label: string };
type Edit = { kind: "invite" } | { kind: "member"; member: WorkspaceMember };
type Removal = { kind: "member"; member: WorkspaceMember } | {
  kind: "invitation";
  invitation: WorkspaceInvitation;
} | { kind: "leave"; member: WorkspaceMember };
const defaults: WorkspaceGrant[] = [{
  target_kind: "tasks",
  target_id: "*",
  access: "none",
}, { target_kind: "settings", target_id: "*", access: "none" }];
function displayName(
  member: WorkspaceMember,
) {
  return member.display_name?.trim() ?? "";
}
function memberLabel(member: WorkspaceMember, peers: WorkspaceMember[] = []) {
  const name = displayName(member);
  const ambiguous = !name ||
    peers.some((other) =>
      other.user_id !== member.user_id && displayName(other) === name
    );
  return `${name || "이름 없는 참여자"}${
    ambiguous ? ` · ${member.user_id.slice(-6)}` : ""
  }`;
}
function GrantSummary(
  { grants, targets }: { grants: WorkspaceGrant[]; targets: Target[] },
) {
  if (!grants.length) return <span>부여한 권한 없음</span>;
  return (
    <ul className="flex flex-col gap-1">
      {grants.map((grant) => (
        <li key={`${grant.target_kind}:${grant.target_id}`}>
          {grant.target_kind === "tasks"
            ? "할 일"
            : grant.target_kind === "settings"
            ? "설정"
            : targets.find((target) =>
              target.id === grant.target_id
            )?.label ?? `자료 종류 · ${grant.target_id.slice(-6)}`}{" "}
          {grant.access === "write"
            ? "읽기·쓰기"
            : grant.access === "read"
            ? "읽기"
            : "접근 불가"}
        </li>
      ))}
    </ul>
  );
}
function InvitationLink({ invitation, showLink = false }: {
  invitation: WorkspaceInvitation;
  showLink?: boolean;
}) {
  const inputId = useId();
  const [status, setStatus] = useState("");
  const current = useRef(true);
  useEffect(() => {
    current.current = true;
    return () => { current.current = false; };
  }, []);
  const url = new URL(`/invitations/${invitation.id}`, window.location.origin).href;
  const copy = async () => {
    if (
      !current.current || invitation.revoked_at || invitation.accepted_at ||
      Date.parse(invitation.expires_at) <= Date.now()
    ) return;
    if (!navigator.clipboard?.writeText) {
      setStatus("이 브라우저는 링크 복사를 지원하지 않습니다. 아래 링크를 직접 선택해 복사하세요.");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      if (current.current && Date.parse(invitation.expires_at) > Date.now()) {
        setStatus("초대 링크를 복사했습니다.");
      }
    } catch {
      if (current.current && Date.parse(invitation.expires_at) > Date.now()) {
        setStatus("복사하지 못했습니다. 아래 링크를 직접 선택해 복사하세요.");
      }
    }
  };
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <Button variant="outline" onClick={() => { void copy(); }}>
        초대 링크 복사
      </Button>
      {(status || showLink) && (
        <>
          {status && <p role="status" className="break-keep">{status}</p>}
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={inputId}>초대 수락 링크</FieldLabel>
              <Input id={inputId} readOnly value={url} />
            </Field>
          </FieldGroup>
        </>
      )}
    </div>
  );
}
export function WorkspaceManagementPage() {
  const api = useApi(),
    { workspaceId, actorId } = useRequestScope(),
    capability = useWorkspaceCapabilities(),
    navigate = useDeferredNavigation();
  const [now, setNow] = useState(Date.now);
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null),
    [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]),
    [targets, setTargets] = useState<Target[]>([]),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [edit, setEdit] = useState<Edit | null>(null),
    [removal, setRemoval] = useState<Removal | null>(null);
  const [delivery, setDelivery] = useState<
    { path: string; status: string } | null
  >(null);
  const deliveryInvitation = invitations.find((invitation) =>
    invitation.id === delivery?.path.split("/").at(-1) &&
    invitation.workspace_id === workspaceId
  );
  const deliveryStatus = deliveryInvitation?.delivery?.status ?? delivery?.status;
  const {
    attempt: removalAttempt,
    busy: removalBusy,
    uncertain: removalUncertain,
  } = useWriteAttempt();
  const {
    attempt: deliveryAttempt,
    busy: deliveryBusy,
    uncertain: deliveryUncertain,
  } = useWriteAttempt();
  const [pendingDelivery, setPendingDelivery] = useState<
    WorkspaceInvitation | null
  >(null);
  const busy = removalBusy || deliveryBusy;
  usePageNavigationBlocker(false, busy);
  useEffect(() => {
    const nextExpiry = Math.min(...invitations
      .filter((invitation) => !invitation.revoked_at && !invitation.accepted_at)
      .map((invitation) => Date.parse(invitation.expires_at))
      .filter((expiry) => expiry > now));
    if (!Number.isFinite(nextExpiry)) return;
    const timer = window.setTimeout(() => setNow(Date.now()),
      Math.min(Math.max(0, nextExpiry - Date.now()), 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [invitations, now]);
  useEffect(() => {
    const controller = new AbortController();
    if (!capability?.can_manage) return;
    void Promise.all([
      api<{ items: WorkspaceMember[] }>(
        "GET",
        `/workspaces/${workspaceId}/members`,
        undefined,
        controller.signal,
      ),
      api<{ items: WorkspaceInvitation[] }>(
        "GET",
        `/workspaces/${workspaceId}/invitations`,
        undefined,
        controller.signal,
      ),
      api<{ items: Target[] }>(
        "GET",
        `/workspaces/${workspaceId}/grant-targets`,
        undefined,
        controller.signal,
      ),
    ]).then(([people, invites, types]) => {
      if (!controller.signal.aborted) {
        setMembers(people.items);
        setInvitations(invites.items);
        setTargets(types.items);
        setError("");
      }
    }).catch((error) => {
      if (!controller.signal.aborted) setError(writeErrorMessage(error));
    });
    return () => controller.abort();
  }, [api, workspaceId, revision, capability?.can_manage]);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  const retryDelivery = async (invitation: WorkspaceInvitation) => {
    if (busy || pendingDelivery && pendingDelivery.id !== invitation.id) return;
    const selected = pendingDelivery ?? invitation;
    setPendingDelivery(selected);
    try {
      await deliveryAttempt.run(() =>
        api(
          "POST",
          `/workspaces/${workspaceId}/invitations/${selected.id}/delivery`,
          { expected_version: selected.version },
          undefined,
          deliveryAttempt.requestKey(),
        )
      );
      setPendingDelivery(null);
      setRevision((value) => value + 1);
    } catch (error) {
      if (!deliveryAttempt.snapshot().uncertain) setPendingDelivery(null);
      setError(writeErrorMessage(error));
    }
  };
  const remove = async () => {
    if (!removal || busy) return;
    const selected = removal, base = `/workspaces/${workspaceId}`;
    try {
      await removalAttempt.run(() =>
        selected.kind === "leave"
          ? api(
            "POST",
            `${base}/leave`,
            { expected_version: selected.member.version },
            undefined,
            removalAttempt.requestKey(),
          )
          : selected.kind === "member"
          ? api(
            "DELETE",
            `${base}/members/${selected.member.user_id}`,
            { expected_version: selected.member.version },
            undefined,
            removalAttempt.requestKey(),
          )
          : api(
            "DELETE",
            `${base}/invitations/${selected.invitation.id}`,
            { expected_version: selected.invitation.version },
            undefined,
            removalAttempt.requestKey(),
          )
      );
      setRemoval(null);
      if (
        selected.kind === "leave" ||
        selected.kind === "member" && selected.member.user_id === actorId
      ) void navigate("/workspaces");
      else setRevision((value) => value + 1);
    } catch (error) {
      setError(writeErrorMessage(error));
    }
  };
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">공간 관리</h1>
          <p className="break-words text-muted-foreground">
            {capability?.workspace.name}
          </p>
        </div>
        {capability?.can_manage
          ? (
            <Button
              disabled={members === null}
              onClick={() => setEdit({ kind: "invite" })}
            >
              이메일로 초대
            </Button>
          )
          : capability && (
            <Button
              variant="outline"
              onClick={() =>
                setRemoval({
                  kind: "leave",
                  member: {
                    user_id: actorId,
                    display_name: null,
                    version: capability.membership_version,
                    grants: capability.grants,
                  },
                })}
            >
              공간 탈퇴
            </Button>
          )}
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setRevision((value) => value + 1)}
          >
            최신 상태 불러오기
          </Button>
        </Alert>
      )}
      {deliveryUncertain && pendingDelivery && (
        <Alert>
          <AlertDescription className="flex min-w-0 flex-col gap-3">
            <p>
              <span className="break-all">{pendingDelivery.email}</span>{" "}
              이메일 전달 요청의 저장 여부를 확인하지 못했습니다. 같은 요청을
              다시 확인하세요.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy}
                className="max-w-full whitespace-normal"
                onClick={() => {
                  void retryDelivery(pendingDelivery);
                }}
              >
                같은 이메일 전달 요청 다시 확인
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {delivery && (
        <Alert>
          <AlertDescription>
            {deliveryStatus === "sent"
              ? "초대를 이메일 서비스에 전달했습니다. 받은편지함 도착은 보장하지 않습니다."
              : deliveryStatus === "unknown"
              ? "이메일 전달 결과를 확인하지 못했습니다. 초대 목록에서 현재 상태를 확인하세요."
              : deliveryStatus === "pending"
              ? "초대를 만들었습니다. 이메일 전달을 기다리는 중입니다."
              : "초대를 만들었습니다. 아래 링크를 초대받은 사람에게 직접 전달하세요."}
            {capability?.can_manage && deliveryInvitation &&
              !deliveryInvitation.revoked_at && !deliveryInvitation.accepted_at &&
              Date.parse(deliveryInvitation.expires_at) > now && (
              <div className="mt-2">
                <InvitationLink
                  key={`${deliveryInvitation.id}:${deliveryInvitation.version}`}
                  invitation={deliveryInvitation}
                  showLink
                />
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}
      {!capability?.can_manage
        ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>공간 관리 권한이 없습니다</EmptyTitle>
              <EmptyDescription>
                참여자와 초대 관리는 설정 쓰기 권한이 있는 사람이 변경할 수
                있습니다.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
        : (
          <>
            <section
              className="flex flex-col gap-3"
              aria-labelledby="workspace-members"
            >
              <h2 id="workspace-members" className="text-lg font-semibold">
                참여자
              </h2>
              {members === null
                ? (
                  <p role="status" className="flex items-center gap-2">
                    <Spinner />참여자를 불러오는 중…
                  </p>
                )
                : (
                  <BusinessTable
                    columns={["참여자", "권한", "작업"]}
                    label="참여자"
                    disclosureColumn={false}
                  >
                    {members.map((member) => (
                      <BusinessRow key={member.user_id}>
                        <BusinessCell index={0}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{memberLabel(member, members)}</span>
                            {member.user_id === actorId && (
                              <Badge variant="secondary">나</Badge>
                            )}
                          </div>
                        </BusinessCell>
                        <BusinessCell index={1}>
                          <GrantSummary
                            grants={member.grants}
                            targets={targets}
                          />
                        </BusinessCell>
                        <BusinessCell index={2}>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              onClick={() =>
                                setEdit({ kind: "member", member })}
                            >
                              권한 편집
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() =>
                                setRemoval({
                                  kind: member.user_id === actorId
                                    ? "leave"
                                    : "member",
                                  member,
                                })}
                            >
                              {member.user_id === actorId ? "탈퇴" : "제외"}
                            </Button>
                          </div>
                        </BusinessCell>
                      </BusinessRow>
                    ))}
                  </BusinessTable>
                )}
            </section>
            <section
              className="flex flex-col gap-3"
              aria-labelledby="workspace-invitations"
            >
              <h2 id="workspace-invitations" className="text-lg font-semibold">
                초대
              </h2>
              {!invitations.length
                ? <p className="text-muted-foreground">보낸 초대가 없습니다.</p>
                : (
                  <BusinessTable
                    columns={["이메일", "권한", "상태", "작업"]}
                    label="초대"
                    disclosureColumn={false}
                  >
                    {invitations.map((invitation) => (
                      <BusinessRow key={invitation.id}>
                        <BusinessCell index={0}>
                          {invitation.email}
                        </BusinessCell>
                        <BusinessCell index={1}>
                          <GrantSummary
                            grants={invitation.grants}
                            targets={targets}
                          />
                        </BusinessCell>
                        <BusinessCell index={2}>
                          <div className="flex flex-col items-start gap-2">
                            <Badge variant="secondary">
                              {invitation.revoked_at
                                ? "취소됨"
                                : invitation.accepted_at
                                ? "수락됨"
                                : Date.parse(invitation.expires_at) <=
                                    now
                                ? "만료됨"
                                : "수락 대기"}
                            </Badge>
                            {invitation.delivery && (
                              <span>
                                {({
                                  pending: "이메일 전달 대기",
                                  sent: "발송 접수",
                                  failed: "이메일 전달 실패",
                                  unknown: "이메일 전달 결과 불명",
                                  unconfigured: "직접 링크 전달 필요",
                                } as Record<string, string>)[
                                  invitation.delivery.status
                                ]}
                              </span>
                            )}
                          </div>
                        </BusinessCell>
                        <BusinessCell index={3}>
                          <div className="flex flex-wrap gap-2">
                            {invitation.workspace_id === workspaceId &&
                              !invitation.revoked_at && !invitation.accepted_at &&
                              Date.parse(invitation.expires_at) > now && (
                              <InvitationLink
                                key={`${invitation.id}:${invitation.version}`}
                                invitation={invitation}
                              />
                            )}
                            {!invitation.revoked_at &&
                              !invitation.accepted_at &&
                              ["failed", "unknown", "unconfigured"].includes(
                                invitation.delivery?.status ?? "",
                              ) && (
                              <Button
                                variant="outline"
                                disabled={busy ||
                                  deliveryUncertain &&
                                    pendingDelivery?.id !== invitation.id}
                                onClick={() => {
                                  void retryDelivery(invitation);
                                }}
                              >
                                {invitation.delivery?.status === "unknown"
                                  ? "전달 결과 다시 확인"
                                  : "이메일 전달 다시 요청"}
                              </Button>
                            )}
                            {!invitation.revoked_at &&
                              !invitation.accepted_at && (
                              <Button
                                variant="outline"
                                onClick={() =>
                                  setRemoval({
                                    kind: "invitation",
                                    invitation,
                                  })}
                              >
                                초대 취소
                              </Button>
                            )}
                          </div>
                        </BusinessCell>
                      </BusinessRow>
                    ))}
                  </BusinessTable>
                )}
            </section>
          </>
        )}
      {capability?.can_manage && (
        <section className="flex flex-col items-start gap-3" aria-labelledby="workspace-lifecycle">
          <h2 id="workspace-lifecycle" className="text-lg font-semibold">공간 삭제·복원</h2>
          <p className="text-muted-foreground">
            공동 데이터를 보존한 채 공간 접근을 중단하거나, 삭제한 공간을 복원할 수 있습니다.
          </p>
          <Button variant="outline" asChild>
            <Link to="/workspaces">공간 목록 열기</Link>
          </Button>
        </section>
      )}
      {edit && (
        <GrantEditor
          key={edit.kind === "member" ? edit.member.user_id : "invite"}
          edit={edit}
          targets={targets}
          onClose={() => setEdit(null)}
          onSaved={(value) => {
            setEdit(null);
            setRevision((revision) => revision + 1);
            if (value) setDelivery(value);
          }}
        />
      )}
      <ConfirmDialog
        open={!!removal}
        title={removal?.kind === "invitation"
          ? "초대를 취소할까요?"
          : removal?.kind === "leave"
          ? "이 공간에서 탈퇴할까요?"
          : "참여자를 제외할까요?"}
        message={
          <>
            {removal?.kind === "invitation"
              ? removal.invitation.email
              : "참여가 종료되면 이 공간의 업무에 접근할 수 없습니다. 마지막 관리자는 탈퇴하거나 제외할 수 없습니다."}
            {error && <span role="alert" className="block">{error}</span>}
          </>
        }
        confirmLabel={removalUncertain ? "같은 요청 다시 확인" : "확인"}
        onConfirm={() => {
          void remove();
        }}
        onCancel={() => {
          if (!busy) {
            if (removalUncertain) removalAttempt.startNewIntent();
            setRemoval(null);
          }
        }}
        busy={busy}
      />
    </section>
  );
}
function GrantEditor(
  { edit, targets, onClose, onSaved }: {
    edit: Edit;
    targets: Target[];
    onClose: () => void;
    onSaved: (delivery?: { path: string; status: string }) => void;
  },
) {
  const api = useApi(),
    { workspaceId } = useRequestScope(),
    [email, setEmail] = useState(""),
    [grants, setGrants] = useState<WorkspaceGrant[]>(() =>
      edit.kind === "member"
        ? structuredClone(edit.member.grants)
        : structuredClone(defaults)
    ),
    [error, setError] = useState("");
  const { attempt, busy, uncertain } = useWriteAttempt<
    { acceptance_path?: string; delivery?: { status: string } }
  >();
  const allTargets = [
    ...targets,
    ...grants.filter((grant) =>
      grant.target_kind === "entity_type" &&
      !targets.some((target) => target.id === grant.target_id)
    ).map((grant) => ({
      id: grant.target_id,
      label: `자료 종류 ${grant.target_id}`,
    })),
  ];
  const rows: {
    kind: WorkspaceGrant["target_kind"];
    id: string;
    label: string;
  }[] = [
    ...allTargets.map((target) => ({
      kind: "entity_type" as const,
      id: target.id,
      label: target.label,
    })),
    { kind: "tasks", id: "*", label: "할 일" },
    { kind: "settings", id: "*", label: "설정 · 공간 관리" },
  ];
  const dirty = edit.kind === "invite"
    ? !!email || JSON.stringify(grants) !== JSON.stringify(defaults)
    : JSON.stringify(grants) !== JSON.stringify(edit.member.grants);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const result = await attempt.run(() =>
        edit.kind === "invite"
          ? api(
            "POST",
            `/workspaces/${workspaceId}/invitations`,
            { email, grants },
            undefined,
            attempt.requestKey(),
          )
          : api(
            "PATCH",
            `/workspaces/${workspaceId}/members/${edit.member.user_id}`,
            { expected_version: edit.member.version, grants },
            undefined,
            attempt.requestKey(),
          )
      );
      onSaved(
        result?.acceptance_path
          ? {
            path: result.acceptance_path,
            status: result.delivery?.status ?? "unconfigured",
          }
          : undefined,
      );
    } catch (error) {
      setError(writeErrorMessage(error));
    }
  };
  return (
    <ModalShell
      title={edit.kind === "invite" ? "이메일로 초대" : "참여자 권한 편집"}
      description={`${
        edit.kind === "member" ? `${memberLabel(edit.member)}의 ` : ""
      }대상별 권한을 지정합니다. 설정 쓰기는 공간 관리 권한을 포함합니다.`}
      open
      onClose={onClose}
      dirty={dirty || uncertain}
      busy={busy}
      footer={(requestClose) => (
        <>
          <Button variant="outline" disabled={busy} onClick={requestClose}>
            취소
          </Button>
          <Button
            type="submit"
            form="workspace-grants"
            disabled={busy || edit.kind === "invite" && !email.trim()}
          >
            {busy && <Spinner data-icon="inline-start" />}
            {uncertain
              ? "같은 요청 다시 확인"
              : edit.kind === "invite"
              ? "초대 만들기"
              : "권한 저장"}
          </Button>
        </>
      )}
    >
      <form id="workspace-grants" onSubmit={submit}>
        <FieldGroup>
          {edit.kind === "invite" && (
            <Field>
              <FieldLabel htmlFor="invitation-email">초대할 이메일</FieldLabel>
              <Input
                id="invitation-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy || uncertain}
                required
              />
              <FieldDescription>
                해당 이메일의 검증된 Google 계정으로 수락해야 합니다.
              </FieldDescription>
            </Field>
          )}
          {rows.map((row) => (
            <Field key={`${row.kind}:${row.id}`}>
              <FieldLabel id={`grant-${row.kind}-${row.id}`}>
                {row.label}
              </FieldLabel>
              <ToggleGroup
                type="single"
                variant="outline"
                aria-labelledby={`grant-${row.kind}-${row.id}`}
                value={grants.find((grant) =>
                  grant.target_kind === row.kind && grant.target_id === row.id
                )?.access ?? "none"}
                disabled={busy || uncertain}
                onValueChange={(access) => {
                  if (access) {
                    setGrants(
                      (current) => [
                        ...current.filter((grant) =>
                          grant.target_kind !== row.kind ||
                          grant.target_id !== row.id
                        ),
                        {
                          target_kind: row.kind,
                          target_id: row.id,
                          access: access as WorkspaceGrant["access"],
                        },
                      ],
                    );
                  }
                }}
              >
                <ToggleGroupItem value="none">접근 불가</ToggleGroupItem>
                <ToggleGroupItem value="read">읽기</ToggleGroupItem>
                <ToggleGroupItem value="write">읽기·쓰기</ToggleGroupItem>
              </ToggleGroup>
            </Field>
          ))}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </FieldGroup>
      </form>
    </ModalShell>
  );
}
