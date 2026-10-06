import type { EntityContext } from "@contracts/entity-links.ts";
import type { EntityResult } from "@contracts/entity.ts";
import { useEffect, useState } from "react";
import { DetailLink as Link } from "../../lib/detail-exploration.tsx";
import { Field, Notice } from "../../components/Field.tsx";
import { api, query } from "../../lib/api.ts";
export function EntityPicker(
  { value, onChange, error, label = "엔터티" }: {
    value: string | null | undefined;
    onChange: (id: string | null) => void;
    error?: string;
    label?: string;
  },
) {
  const { items, failed, retry } = useEntities();
  return (
    <div className="form">
      <Field label={label} error={error}>
        {(p) => (
          <select
            {...p}
            className="input"
            value={value ?? ""}
            disabled={!items}
            onChange={(e) => onChange(e.target.value || null)}
          >
            <option value="">{items ? "미지정" : "불러오는 중…"}</option>
            {value && !items?.some((e) => e.id === value) && (
              <option value={value}>현재 연결 ({value})</option>
            )}
            {items?.map((e) => (
              <option key={e.id} value={e.id}>{e.prop1}</option>
            ))}
          </select>
        )}
      </Field>
      {failed && (
        <>
          <Notice kind="error">엔터티를 불러오지 못했습니다.</Notice>
          <button
            className="btn"
            type="button"
            onClick={retry}
          >
            다시 시도
          </button>
        </>
      )}
    </div>
  );
}
export function EntityLink({ id }: { id: string | null | undefined }) {
  return id
    ? (
      <p className="secondary">
        연결 엔터티: <Link to={`/entities/${id}`}>엔터티 편집</Link>
      </p>
    )
    : null;
}

function useEntities() {
  const [items, setItems] = useState<EntityResult[] | null>(null),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    setItems(null);
    (async () => {
      let cursor: string | null = null;
      const all: EntityResult[] = [];
      do {
        const page: { items: EntityResult[]; next_cursor: string | null } =
          await api(
            "GET",
            `/entities${query({ limit: 100, cursor })}`,
            undefined,
            controller.signal,
          );
        all.push(...page.items);
        cursor = page.next_cursor;
      } while (cursor);
      setItems(all);
    })().catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [retry]);
  return { items, failed, retry: () => setRetry((n) => n + 1) };
}

export function EntityMultiPicker({ value, context = [], onChange, error }: {
  value: string[];
  context?: EntityContext[];
  onChange: (ids: string[]) => void;
  error?: string;
}) {
  const { items, failed, retry } = useEntities();
  const options = [...(items ?? []).map((item) => ({ id: item.id, title: item.prop1 })),
    ...value.filter((id) => !items?.some((item) => item.id === id)).map((id) => ({
      id, title: context.find((item) => item.id === id)?.title ?? `현재 연결 (${id})`,
    }))];
  return <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
    <legend className="label">엔터티</legend>

    <div className="chips">
      {options.map((item) => <label key={item.id} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
        <input type="checkbox" checked={value.includes(item.id)} disabled={!items}
          onChange={(e) => onChange(e.target.checked ? [...value, item.id].sort() : value.filter((id) => id !== item.id))}/>
        {item.title}
      </label>)}
    </div>
    {!items && !failed && <p role="status">엔터티를 불러오는 중…</p>}
    {items?.length === 0 && options.length === 0 && <p className="help">연결할 엔터티가 없습니다.</p>}
    {items && value.some((id) => !items.some((item) => item.id === id)) &&
      <p className="help">삭제된 대상은 저장된 이름으로 표시합니다. 선택을 해제하면 연결 문맥을 제거합니다.</p>}
    {error && <p role="alert" className="error-text">{error}</p>}
    {failed && <><Notice kind="error">엔터티를 불러오지 못했습니다.</Notice><button type="button" className="btn" onClick={retry}>다시 시도</button></>}
  </fieldset>;
}

export function EntityLinks({ ids, context = [] }: { ids?: string[]; context?: EntityContext[] }) {
  if (!ids?.length) return null;
  return <section className="read-context" aria-label="연결 엔터티">
    <p className="label">연결 엔터티</p>
    <ul className="related-list">{ids.map((id) => {
      const capture = context.find((item) => item.id === id);
      return <li key={id}><Link className="item-title" to={`/entities/${id}`}>{capture?.title ?? id}</Link>
        {capture && <details className="related-provenance"><summary className="meta">연결 당시 정보</summary><p className="meta">{capture.source === "legacy_backfill" ? "기존 연결 전환 시 이름" : "연결 선택 시 이름"} · {new Date(capture.captured_at).toLocaleString()}</p></details>}
      </li>;
    })}</ul>
  </section>;
}
