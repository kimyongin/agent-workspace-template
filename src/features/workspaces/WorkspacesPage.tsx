import { useDeferredNavigation } from "../../lib/useDeferredNavigation.ts";
import { usePageNavigationBlocker } from "../details/workspace-context.ts";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { Workspace } from "@contracts/workspace.ts";
import { useApi } from "../../lib/api-context.tsx";
import { workspacePath } from "../../lib/workspace-route.tsx";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
import { Button } from "../../components/ui/button.tsx";
import { Field, FieldGroup, FieldLabel } from "../../components/ui/field.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Alert, AlertDescription } from "../../components/ui/alert.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "../../components/ui/empty.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from "../../components/ui/item.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { ModalShell } from "../../components/Modal.tsx";
export function WorkspacesPage() {
  const api = useApi(), navigate = useDeferredNavigation();
  const [items, setItems] = useState<Workspace[] | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [creating, setCreating] = useState(false),
    [name, setName] = useState("");
  const { attempt, busy, uncertain } = useWriteAttempt<
    { workspace: Workspace }
  >();
  useEffect(() => {
    const controller = new AbortController();
    void api<{ items: Workspace[] }>(
      "GET",
      "/workspaces",
      undefined,
      controller.signal,
    ).then((value) => {
      if (!controller.signal.aborted) {
        setItems(value.items);
        setError("");
      }
    }).catch((error) => {
      if (!controller.signal.aborted) setError(writeErrorMessage(error));
    });
    return () => controller.abort();
  }, [api, revision]);
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const result = await attempt.run(() =>
        api(
          "POST",
          "/workspaces",
          { name: name.trim() },
          undefined,
          attempt.requestKey(),
        )
      );
      if (result) {
        setCreating(false);
        void navigate(workspacePath(result.workspace.id));
      }
    } catch (error) {
      setError(writeErrorMessage(error));
    }
  };
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">내 공간</h1>
        <Button onClick={() => setCreating(true)}>새 공간 만들기</Button>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
          <Button
            variant="outline"
            onClick={() => setRevision((value) => value + 1)}
          >
            다시 불러오기
          </Button>
        </Alert>
      )}
      {items === null
        ? (
          <p role="status" className="flex items-center gap-2">
            <Spinner />공간을 불러오는 중…
          </p>
        )
        : items.length
        ? (
          <ItemGroup>
            {items.map((item) => (
              <Item key={item.id} variant="outline">
                <ItemContent>
                  <ItemTitle>{item.name}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <Button asChild variant="outline">
                    <Link to={workspacePath(item.id)}>열기</Link>
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )
        : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>참여 중인 공간이 없습니다</EmptyTitle>
              <EmptyDescription>
                새 공간을 만들거나 전달받은 초대 링크를 열어 참여하세요.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      <ModalShell
        title="새 공간 만들기"
        open={creating}
        onClose={() => setCreating(false)}
        dirty={!!name || uncertain}
        busy={busy}
        footer={(requestClose) => (
          <>
            <Button variant="outline" disabled={busy} onClick={requestClose}>
              취소
            </Button>
            <Button
              type="submit"
              form="create-workspace"
              disabled={busy || !name.trim()}
            >
              {busy && <Spinner data-icon="inline-start" />}
              {uncertain ? "같은 요청 다시 확인" : "공간 만들기"}
            </Button>
          </>
        )}
      >
        <form id="create-workspace" onSubmit={create}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="workspace-name">공간 이름</FieldLabel>
              <Input
                id="workspace-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                required
                disabled={busy || uncertain}
              />
            </Field>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </FieldGroup>
        </form>
      </ModalShell>
    </section>
  );
}
export function InvitationPage() {
  const api = useApi(),
    navigate = useDeferredNavigation(),
    { invitationId } = useParams();
  const { attempt, busy, uncertain } = useWriteAttempt<
      { workspace: Workspace }
    >(),
    [error, setError] = useState("");
  usePageNavigationBlocker(false, busy);
  const accept = async () => {
    setError("");
    try {
      const result = await attempt.run(() =>
        api(
          "POST",
          `/invitations/${invitationId}/accept`,
          {},
          undefined,
          attempt.requestKey(),
        )
      );
      if (result) void navigate(workspacePath(result.workspace.id));
    } catch (error) {
      setError(writeErrorMessage(error));
    }
  };
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-5 p-6">
      <h1 className="text-2xl font-semibold">공간 초대</h1>
      <p>
        초대받은 이메일의 Google 계정으로 로그인한 뒤 참여하세요. 초대의
        유효성과 계정을 서버에서 확인합니다.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button onClick={accept} disabled={busy}>
        {busy && <Spinner data-icon="inline-start" />}
        {uncertain ? "같은 요청 다시 확인" : "초대 수락"}
      </Button>
      <Button variant="outline" asChild>
        <Link to="/workspaces">내 공간으로 돌아가기</Link>
      </Button>
    </section>
  );
}
