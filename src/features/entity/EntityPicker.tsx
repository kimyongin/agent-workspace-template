import type { EntityResult } from "@contracts/entity.ts";
import { useEffect, useState } from "react";
import { Link } from "react-router";
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
            onClick={() => setRetry((n) => n + 1)}
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
