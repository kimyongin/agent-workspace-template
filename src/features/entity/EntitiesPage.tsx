import type { EntityResult } from "@contracts/entity.ts";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { Field, Notice } from "../../components/Field.tsx";
import { api, ApiError, query } from "../../lib/api.ts";
import { useRequestId } from "../../lib/useRequestId.ts";
import { EntityForm } from "./forms.tsx";
type Page = { items: EntityResult[]; next_cursor: string | null; count: number };
export function EntitiesPage() {
  const [params] = useSearchParams(),
    { hash } = useLocation(),
    navigate = useNavigate(),
    request = useRequestId();
  const requested = Number(params.get("pages") ?? 1);
  const pages = Number.isSafeInteger(requested) && requested > 0 ? Math.min(250, requested) : 1;
  const filter = {
    keyword: params.get("keyword"),
    prop3_from: params.get("prop3_from"),
    prop3_to: params.get("prop3_to"),
    prop4: params.get("prop4"),
    sort: params.get("sort") ?? "updated_at",
  };
  const key = query(filter),
    [page, setPage] = useState<Page | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0),
    [creating, setCreating] = useState(false);
  const context = `${key}|${hash}`;
  const loaded = useRef<{ context: string; page: Page } | null>(null), focused = useRef("");
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setBusy(true);
    const cached = loaded.current?.context === context ? loaded.current.page : null;
    if (!cached) {
      setPage(null);
      loaded.current = null;
    }
    (async () => {
      let result: Page = cached ?? { items: [], next_cursor: null, count: 0 };
      const anchor = /^#entity-[0-9a-f-]+$/.test(hash) ? hash.slice(8) : null;
      // A concurrent insertion may move the anchor one page. Never scan beyond this finite window.
      const maximum = anchor && focused.current !== context ? Math.min(250, pages + 1) : pages;
      while (
        !result.count || (result.next_cursor &&
          (result.count < pages || (anchor && result.count < maximum && !result.items.some((e) => e.id === anchor))))
      ) {
        const next: Omit<Page, "count"> = await api(
          "GET",
          `/entities${query({ ...filter, cursor: result.next_cursor })}`,
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        result = {
          items: [...result.items, ...next.items],
          next_cursor: next.next_cursor,
          count: result.count + 1,
        };
        loaded.current = { context, page: result };
        setPage(result);
        if (!next.next_cursor) break;
      }
      if (!controller.signal.aborted) setPage(result);
    })().catch((e) => {
      if (!controller.signal.aborted) {
        setError(
          e instanceof ApiError ? e.message : "엔터티를 불러오지 못했습니다.",
        );
      }
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, [key, pages, retry, hash]);
  useEffect(() => {
    if (
      busy || error || loaded.current?.context !== context || focused.current === context || !page ||
      !/^#entity-[0-9a-f-]+$/.test(hash)
    ) return;
    const node = document.getElementById(hash.slice(1));
    if (node) {
      node.focus();
      node.scrollIntoView({ block: "center" });
    } else document.getElementById("entities-title")?.focus();
    focused.current = context;
  }, [page, busy, error, context, hash]);
  const set = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete("pages");
    navigate({ pathname: "/entities", search: next.toString(), hash: "" }, { replace: true });
  };
  return (
    <section className="panel" aria-labelledby="entities-title">
      <div className="panel-head">
        <h1 id="entities-title" className="page-title" tabIndex={-1}>엔터티</h1>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          엔터티 추가
        </button>
      </div>
      <div className="form" role="group" aria-label="엔터티 필터">
        <Field label="속성 1 키워드">
          {(p) => (
            <input
              {...p}
              className="input"
              value={filter.keyword ?? ""}
              onChange={(e) => set("keyword", e.target.value)}
            />
          )}
        </Field>
        <div className="field-row">
          {(["prop3_from", "prop3_to"] as const).map((name) => (
            <Field
              key={name}
              label={name === "prop3_from" ? "속성 3 시작 날짜" : "속성 3 끝 날짜"}
            >
              {(p) => (
                <input
                  {...p}
                  type="date"
                  className="input"
                  value={filter[name] ?? ""}
                  onChange={(e) => set(name, e.target.value)}
                />
              )}
            </Field>
          ))}
        </div>
        <Field label="속성 4 필터">
          {(p) => (
            <select
              {...p}
              className="input"
              value={filter.prop4 ?? ""}
              onChange={(e) => set("prop4", e.target.value)}
            >
              <option value="">전체</option>
              {["a", "b", "c"].map((v) => <option key={v}>{v}</option>)}
            </select>
          )}
        </Field>
        <Field label="정렬">
          {(p) => (
            <select
              {...p}
              className="input"
              value={filter.sort}
              onChange={(e) => set("sort", e.target.value)}
            >
              <option value="updated_at">최근 수정순</option>
              {[1, 2, 3].map((n) => <option key={n} value={`prop${n}`}>속성 {n} 오름차순</option>)}
            </select>
          )}
        </Field>
      </div>
      {error && (
        <>
          <Notice kind="error">{error}</Notice>
          {!page &&
            (
              <button className="btn" onClick={() => setRetry((n) => n + 1)}>
                다시 시도
              </button>
            )}
        </>
      )}
      {!page && busy && <p role="status" className="secondary">불러오는 중…</p>}
      {page?.items.length === 0 && (
        <>
          <p className="secondary">
            {key !== "?sort=updated_at" ? "조건에 맞는 엔터티가 없습니다." : "아직 엔터티가 없습니다."}
          </p>
          <button className="btn" onClick={() => navigate("/entities", { replace: true })}>
            필터 해제
          </button>
        </>
      )}
      <ul className="list">
        {page?.items.map((e) => (
          <li className="list-item" key={e.id}>
            <div className="list-item-main">
              <Link
                id={`entity-${e.id}`}
                className="item-title"
                to={`/entities/${e.id}?${new URLSearchParams({
                  ...Object.fromEntries(params),
                  pages: String(page.count),
                })}`}
              >
                {e.prop1}
              </Link>
              <span className="secondary">
                속성 2: {e.prop2 ?? "미지정"} · 속성 3: {e.prop3 ?? "미지정"} · 속성 4: {e.prop4}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {page && (page.next_cursor || page.count > 1) && (
        <button
          className="btn"
          aria-disabled={busy || !page.next_cursor}
          onClick={() => {
            if (busy || !page.next_cursor) return;
            if (error) {
              setRetry((n) => n + 1);
              return;
            }
            const next = new URLSearchParams(params);
            next.set("pages", String(page.count + 1));
            navigate({ pathname: "/entities", search: next.toString(), hash }, {
              replace: true,
              preventScrollReset: true,
            });
          }}
        >
          {busy ? "불러오는 중…" : error ? "다시 시도" : page.next_cursor ? "더 보기" : "모두 불러왔습니다"}
        </button>
      )}
      {creating && (
        <EntityForm
          onClose={() => setCreating(false)}
          onSave={async (value) => {
            const e = await api<EntityResult>("POST", "/entities", {
              ...value,
              request_id: request.current,
            });
            request.renew();
            setCreating(false);
            navigate(`/entities/${e.id}?${params}`);
          }}
        />
      )}
    </section>
  );
}
