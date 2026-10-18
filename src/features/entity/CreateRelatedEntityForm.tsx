import { useApi } from "../../lib/api-context.tsx";
import { Button } from "../../components/ui/button.tsx";
import { useEffect, useRef, useState } from "react";
import type { EntityDetail, EntitySummary, EntityValues } from "@contracts/entity.ts";
import type { EntityRelationDefinition } from "@contracts/entity-relation.ts";
import type { RelationMutationResult } from "@contracts/entity-relation-links.ts";
import { entityPath } from "@contracts/entity-identity.ts";
import { ApiError } from "../../lib/api.ts";
import { FormModal } from "../../components/ContentForm.tsx";
import { Notice } from "../../components/Field.tsx";

import { EntityForm } from "./forms.tsx";
interface Context {
  origin: EntityDetail;
  definition: EntityRelationDefinition;
  previous: EntitySummary | null;
}
export function CreateRelatedEntityForm(
  { originId, definitionId, side, onClose, onRouteDiscard, onSaved }: {
    originId: string;
    definitionId: string;
    side: 0 | 1;
    onClose: () => void;
    onRouteDiscard: () => void;
    onSaved: (result: { entity: EntityValues; relation: RelationMutationResult }) => void;
  },
) {
  const api = useApi();
  const [context, setContext] = useState<Context | null>(null),
    [error, setError] = useState(""),
    [reading, setReading] = useState(false),
    [contextChanged, setContextChanged] = useState(false);
  const request = useRef<AbortController | null>(null),
    base = `/entity-relations/${definitionId}/${side}/${encodeURIComponent(originId)}`;
  const read = async () => {
    request.current?.abort();
    const c = new AbortController();
    request.current = c;
    setReading(true);
    setError("");
    try {
      const [origin, page] = await Promise.all([
        api<EntityDetail>("GET", entityPath(originId), undefined, c.signal),
        api<{ definition: EntityRelationDefinition; items: EntitySummary[] }>(
          "GET",
          `${base}/links`,
          undefined,
          c.signal,
        ),
      ]);
      if (!c.signal.aborted) {
        setContext({
          origin,
          definition: page.definition,
          previous: page.definition.ends[side].cardinality === "one" ? page.items[0] ?? null : null,
        });
        setContextChanged(false);
      }
    } catch (e) {
      if (!c.signal.aborted) setError(e instanceof Error ? e.message : "관계 문맥을 읽지 못했습니다.");
    } finally {
      if (!c.signal.aborted) setReading(false);
    }
  };
  useEffect(() => {
    void read();
    return () => request.current?.abort();
  }, [originId, definitionId, side]);
  if (!context) {
    return (
      <FormModal
        open
        title="자료 작성해서 연결"
        submitLabel="작성하고 연결"
        submitDisabled
        dirty={false}
        onClose={onClose}
        onRouteDiscard={onRouteDiscard}
        validate={() => null}
        onSubmit={async () => {}}
      >
        {() =>
          reading ? <p role="status">관계와 현재 자료를 확인하는 중…</p> : (
            <Notice kind="error">
              {error}
              <Button variant="ghost" type="button" onClick={() => void read()}>다시 조회</Button>
            </Notice>
          )}
      </FormModal>
    );
  }
  const typeId = context.definition.ends[side === 0 ? 1 : 0].type_id;
  const notice = (
    <section className="flex min-w-0 flex-col gap-4">
      <h2 className="text-base font-semibold">작성 후 연결</h2>
      <p>{context.origin.title} → {context.definition.ends[side].label}</p>
      {context.previous && (
        <p className="text-sm text-muted-foreground">
          기존 연결: {context.previous.title}
          {context.previous.deleted_at ? " · 삭제됨" : ""}. 저장하면 새로 작성한 자료로 교체합니다.
        </p>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {contextChanged && (
        <Notice kind="error">
          관계 또는 원점이 변경되었습니다. 작성한 입력은 유지했습니다.<Button variant="ghost" type="button"
            disabled={reading}
            onClick={() => void read()}
          >
            현재 관계 다시 확인
          </Button>
        </Notice>
      )}
      {reading && <p role="status">현재 관계 확인 중…</p>}
    </section>
  );
  return (
    <EntityForm
      initialTypeId={typeId}
      fixedType
      context={notice}
      submitLabel="작성하고 연결"
      onClose={onClose}
      onRouteDiscard={onRouteDiscard}
      onSave={async (entity, key) => {
        if (reading || contextChanged) {
          throw new ApiError(
            409,
            "conflict",
            "현재 관계를 확인한 뒤 다시 저장하세요.",
            [],
            false,
          );
        }
        if (entity.entity_type_id !== typeId) {
          throw new ApiError(
            409,
            "conflict",
            "상대 자료 종류가 바뀌었습니다. 초안을 확인한 뒤 새 작성으로 시작하세요.",
            [],
            false,
          );
        }
        try {
          const result = await api<{ entity: EntityValues; relation: RelationMutationResult }>(
            "POST",
            `${base}/create-and-link`,
            {
              expected_definition_version: context.definition.version,
              expected_version: context.origin.version,
              previous_other_id: context.previous?.id ?? null,
              expected_previous_version: context.previous?.version ?? null,
              entity,
            },
            undefined,
            key(),
          );
          onSaved(result);
        } catch (e) {
          if (e instanceof ApiError) {
            const nested = e.fields.some((f) => f.path === "entity" || f.path.startsWith("entity."));
            if (!nested && (e.code === "settings_changed" || e.code === "conflict")) setContextChanged(true);
            throw new ApiError(
              e.status,
              !nested && e.code === "settings_changed" ? "conflict" : e.code,
              e.message,
              e.fields.map((f) => ({ ...f, path: f.path.startsWith("entity.") ? f.path.slice(7) : f.path })),
              e.retryable,
              e.current,
            );
          }
          throw e;
        }
      }}
    />
  );
}
