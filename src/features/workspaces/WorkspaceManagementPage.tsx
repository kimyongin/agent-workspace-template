import { useEffect, useState } from "react";
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
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "../../components/ui/item.tsx";
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
export function WorkspaceManagementPage() {
  const api = useApi(),
    { workspaceId, actorId } = useRequestScope(),
    capability = useWorkspaceCapabilities(),
    navigate = useDeferredNavigation();
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
  const deliveryStatus =
    invitations.find((invitation) =>
      invitation.id === delivery?.path.split("/").at(-1)
    )?.delivery?.status ?? delivery?.status;
  const { attempt, busy, uncertain } = useWriteAttempt();
  usePageNavigationBlocker(false, busy);
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
    try {
      await attempt.run(() =>
        api(
          "POST",
          `/workspaces/${workspaceId}/invitations/${invitation.id}/delivery`,
          { expected_version: invitation.version },
          undefined,
          attempt.requestKey(),
        )
      );
      setRevision((value) => value + 1);
    } catch (error) {
      setError(writeErrorMessage(error));
    }
  };
  const remove = async () => {
    if (!removal) return;
    const selected = removal, base = `/workspaces/${workspaceId}`;
    try {
      await attempt.run(() =>
        selected.kind === "leave"
          ? api(
            "POST",
            `${base}/leave`,
            { expected_version: selected.member.version },
            undefined,
            attempt.requestKey(),
          )
          : selected.kind === "member"
          ? api(
            "DELETE",
            `${base}/members/${selected.member.user_id}`,
            { expected_version: selected.member.version },
            undefined,
            attempt.requestKey(),
          )
          : api(
            "DELETE",
            `${base}/invitations/${selected.invitation.id}`,
            { expected_version: selected.invitation.version },
            undefined,
            attempt.requestKey(),
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
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
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
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <a className="break-all underline" href={delivery.path}>
                {new URL(delivery.path, window.location.origin).href}
              </a>
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(
                    new URL(delivery.path, window.location.origin).href,
                  );
                }}
              >
                초대 링크 복사
              </Button>
            </div>
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
                  <ItemGroup>
                    {members.map((member) => (
                      <Item key={member.user_id} variant="outline">
                        <ItemContent>
                          <ItemTitle className="break-all">
                            {member.user_id}
                            {member.user_id === actorId && (
                              <Badge variant="secondary">나</Badge>
                            )}
                          </ItemTitle>
                          <ItemDescription>
                            {member.grants.length}개 대상 권한
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions>
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
                        </ItemActions>
                      </Item>
                    ))}
                  </ItemGroup>
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
                  <ItemGroup>
                    {invitations.map((invitation) => (
                      <Item key={invitation.id} variant="outline">
                        <ItemContent>
                          <ItemTitle className="break-all">
                            {invitation.email}
                          </ItemTitle>
                          <ItemDescription>
                            <Badge variant="secondary">
                              {invitation.revoked_at
                                ? "취소됨"
                                : invitation.accepted_at
                                ? "수락됨"
                                : Date.parse(invitation.expires_at) <=
                                    Date.now()
                                ? "만료됨"
                                : "수락 대기"}
                            </Badge>
                            {invitation.delivery && (
                              <span>
                                · {({
                                  pending: "이메일 전달 대기",
                                  sent: "이메일 서비스 접수",
                                  failed: "이메일 전달 실패",
                                  unknown: "이메일 전달 결과 불명",
                                  unconfigured: "직접 링크 전달 필요",
                                } as Record<string, string>)[
                                  invitation.delivery.status
                                ]}
                              </span>
                            )}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          {!invitation.revoked_at && !invitation.accepted_at &&
                            ["failed", "unknown", "unconfigured"].includes(
                              invitation.delivery?.status ?? "",
                            ) && (
                            <Button
                              variant="outline"
                              disabled={busy || uncertain}
                              onClick={() => {
                                void retryDelivery(invitation);
                              }}
                            >
                              {invitation.delivery?.status === "unknown"
                                ? "전달 결과 다시 확인"
                                : "이메일 전달 다시 요청"}
                            </Button>
                          )}
                          {!invitation.revoked_at && !invitation.accepted_at &&
                            (
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
                        </ItemActions>
                      </Item>
                    ))}
                  </ItemGroup>
                )}
            </section>
          </>
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
        confirmLabel={uncertain ? "같은 요청 다시 확인" : "확인"}
        onConfirm={() => {
          void remove();
        }}
        onCancel={() => {
          if (!busy) {
            if (uncertain) attempt.startNewIntent();
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
      description="대상별 권한을 명시적으로 지정합니다. 설정 쓰기는 공간 관리 권한을 포함합니다."
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
