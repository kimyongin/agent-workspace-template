import { useEntityReadAccess } from "./entity-access.ts";
import { useApi } from "../../lib/api-context.tsx";
import { Button } from "../../components/ui/button.tsx";
import { useEffect, useState } from "react";
import { entityReferenceId } from "@contracts/entity-identity.ts";


/** Related-list URL scope uses owner-protected source data, never a URL display name. */
export function EntityScope({ id, onClear }: { id: string; onClear: () => void }) {
  const api = useApi();
  const canReadType = useEntityReadAccess();
  const [name, setName] = useState<{ typeId: string; label: string } | null>(null),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  const valid = entityReferenceId.safeParse(id).success;
  useEffect(() => {
    setName(null);
    setFailed(false);
    if (!valid) return;
    const controller = new AbortController();
    api<{ title: string; entity_type_id: string; type: { label: string } }>(
      "GET",
      `/entities/${encodeURIComponent(id)}`,
      undefined,
      controller.signal,
    ).then((value) => {
      if (!controller.signal.aborted) setName({ typeId: value.entity_type_id, label: `${value.type.label}: ${value.title}` });
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [api, id, valid, retry]);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg bg-muted p-3 text-sm">
      <span role="status">
        {!valid
          ? "자료 범위 ID가 올바르지 않습니다."
          : failed
          ? "연결된 자료를 조회할 수 없습니다."
          : name
          ? canReadType(name.typeId) ? `연결된 자료: ${name.label}` : "연결된 자료를 조회할 수 없습니다."
          : "연결된 자료를 불러오는 중…"}
      </span>
      {valid && failed && (
        <Button variant="outline" type="button"  onClick={() => setRetry((n) => n + 1)}>자료 다시 조회</Button>
      )}
      <Button variant="outline" type="button" className="ml-auto" aria-label="자료 범위 해제" onClick={onClear}>×</Button>
    </div>
  );
}
