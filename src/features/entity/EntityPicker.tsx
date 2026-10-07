import { RelatedItem, RelatedSection } from "../../components/RelatedItems.tsx";
import type { EntityContext } from "@contracts/entity-links.ts";
import type { EntityResult } from "@contracts/entity.ts";
import { useEffect, useRef, useState } from "react";
import { DetailLink as Link } from "../../lib/detail-exploration.tsx";
import { Field, Notice } from "../../components/Field.tsx";
import { api, query } from "../../lib/api.ts";
import "./entity.css";
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

type EntityCandidates = {
  keyword: string;
  items: EntityResult[];
  next_cursor: string | null;
};

export function EntityMultiPicker({ value, context = [], onChange, error }: {
  value: string[];
  context?: EntityContext[];
  onChange: (ids: string[]) => void;
  error?: string;
}) {
  const [draft, setDraft] = useState(""),
    [composing, setComposing] = useState(false);
  const [result, setResult] = useState<EntityCandidates | null>(null),
    [pending, setPending] = useState(false),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  const [names, setNames] = useState(() =>
    new Map(context.map((item) => [item.id, item.title]))
  );
  const request = useRef<AbortController | null>(null);
  const picker = useRef<HTMLFieldSetElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const nextFocus = useRef<string | null>(null);
  const searchImmediately = useRef(false);
  const keyword = draft.trim();
  // Resolve only unknown selected IDs; a saved name remains usable even if the target is unavailable.
  const selectionKey = value.join(",");
  useEffect(() => {
    const id = nextFocus.current;
    if (id === null) return;
    nextFocus.current = null;
    const selected = Array.from(
      picker.current?.querySelectorAll<HTMLInputElement>(
        "input[data-entity-id]",
      ) ?? [],
    )
      .find((input) => input.dataset.entityId === id);
    (selected ?? searchInput.current)?.focus();
  }, [selectionKey]);
  useEffect(() => {
    const controller = new AbortController();
    for (const id of value.filter((id) => !names.has(id))) {
      void api<EntityResult>(
        "GET",
        `/entities/${id}`,
        undefined,
        controller.signal,
      ).then((item) => {
        if (!controller.signal.aborted) {
          setNames((current) => new Map(current).set(id, item.prop1));
        }
      }).catch(() => {});
    }
    return () => controller.abort();
  }, [selectionKey]);
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    setResult(null);
    setFailed(false);
    setPending(!!keyword && !composing);
    if (!keyword || composing) return () => controller.abort();
    const delay = searchImmediately.current ? 0 : 300;
    searchImmediately.current = false;
    const timer = setTimeout(() => {
      void api<{ items: EntityResult[]; next_cursor: string | null }>(
        "GET",
        `/entities${query({ keyword, limit: 20, sort: "prop1" })}`,
        undefined,
        controller.signal,
      ).then((page) => {
        if (!controller.signal.aborted) setResult({ keyword, ...page });
      }).catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      }).finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [keyword, composing, retry]);
  const current = result?.keyword === keyword && !composing ? result : null;
  const loadMore = async () => {
    const controller = request.current;
    if (!controller || !current?.next_cursor || pending) return;
    setPending(true);
    setFailed(false);
    try {
      const page = await api<
        { items: EntityResult[]; next_cursor: string | null }
      >(
        "GET",
        `/entities${
          query({
            keyword,
            limit: 20,
            sort: "prop1",
            cursor: current.next_cursor,
          })
        }`,
        undefined,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setResult((previous) =>
          previous && previous.keyword === keyword
            ? {
              keyword,
              items: [
                ...previous.items,
                ...page.items.filter((item) =>
                  !previous.items.some((old) => old.id === item.id)
                ),
              ],
              next_cursor: page.next_cursor,
            }
            : previous
        );
      }
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  };
  const select = (item: EntityResult) => {
    nextFocus.current = item.id;
    setNames((current) => new Map(current).set(item.id, item.prop1));
    onChange([...value, item.id].sort());
  };
  const remove = (id: string) => {
    nextFocus.current = "";
    onChange(value.filter((item) => item !== id));
  };
  return (
    <fieldset
      ref={picker}
      className="field entity-picker"
      style={{ border: 0, padding: 0, margin: 0 }}
    >
      <legend className="visually-hidden">엔터티 연결</legend>
      <Field label="엔터티 제목 검색" error={error}>
        {(p) => (
          <input
            {...p}
            ref={searchInput}
            type="search"
            className="input"
            value={draft}
            maxLength={100}
            placeholder="제목을 입력해 연결할 엔터티 찾기"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (composing || event.nativeEvent.isComposing || event.keyCode === 229) return;
              searchImmediately.current = true;
              setRetry((value) => value + 1);
            }}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => {
              setDraft(event.currentTarget.value);
              setComposing(false);
            }}
          />
        )}
      </Field>
      {pending && <p className="secondary" role="status">검색 중…</p>}
      {failed && (
        <>
          <Notice kind="error">엔터티를 검색하지 못했습니다.</Notice>
          <button
            type="button"
            className="btn"
            disabled={pending}
            onClick={() => {
              if (current?.next_cursor) void loadMore();
              else setRetry((value) => value + 1);
            }}
          >
            검색 다시 시도
          </button>
        </>
      )}
      {current && (
        <div
          role="group"
          aria-label="엔터티 검색 결과"
          className="entity-candidates"
        >
          {current.items.filter((item) => !value.includes(item.id)).map(
            (item) => (
              <label key={item.id} className="related-item entity-choice">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => select(item)}
                />
                <span className="item-title">{item.prop1}</span>
              </label>
            ),
          )}
          {!current.items.length && !pending && (
            <p className="secondary">검색 결과가 없습니다.</p>
          )}
          {current.next_cursor && (
            <button
              type="button"
              className="btn btn-text"
              disabled={pending}
              onClick={loadMore}
            >
              검색 결과 더 보기
            </button>
          )}
        </div>
      )}
      {!!value.length && (
        <RelatedSection title="연결된 엔터티" count={value.length}>
        <div className="entity-candidates" role="group" aria-label="연결된 엔터티">
          {value.map((id) => (
            <label key={id} className="related-item entity-choice">
              <input
                data-entity-id={id}
                type="checkbox"
                checked
                onChange={() => remove(id)}
              />
              <span className="item-title">{names.get(id) ?? `현재 연결 (${id})`}</span>
            </label>
          ))}
        </div>
        </RelatedSection>
      )}
    </fieldset>
  );
}

export function EntityLinks(
  { ids, context = [] }: { ids?: string[]; context?: EntityContext[] },
) {
  if (!ids?.length) return null;
  return (
    <RelatedSection title="연결된 엔터티" count={ids.length}>
      <ul className="related-items">
        {ids.map((id) => {
          return (
            <li key={id}>
              <EntityLinkItem id={id} context={context}/>
            </li>
          );
        })}
      </ul>
    </RelatedSection>
  );
}

export function EntityLinkItem({id,context=[]}: {id:string;context?:EntityContext[]}) {
  const capture=context.find(item=>item.id===id);
  return <RelatedItem to={`/entities/${id}`} title={capture?.title??"연결된 엔터티"} restoreKey={`linked-entity-${id}`}/>;
}
