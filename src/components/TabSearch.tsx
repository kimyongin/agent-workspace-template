import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { Field } from "./Field.tsx";
import { BodyAction } from "./BodyAction.tsx";
import "./workspace.css";

export function clearListPosition(params: URLSearchParams) {
  params.delete("open");
  ["pages", "tasks_pages", "records_pages", "scroll", "collapsed"].forEach(key => params.delete(key));
  return params;
}
/** Debounce only text; concurrent filter changes survive through the latest URL. */
export function TabSearch({ entity = false }: { entity?: boolean }) {
  const [params, setParams] = useSearchParams();
  const name = entity ? "keyword" : "q", applied = params.get(name) ?? "";
  const latest = useRef(params); latest.current = params;
  const [draft, setDraft] = useState(applied), [composing, setComposing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(applied), [applied]);
  useEffect(() => {
    if (composing || draft.trim() === applied) return;
    const timer = setTimeout(() => {
      const next = clearListPosition(new URLSearchParams(latest.current));
      draft.trim() ? next.set(name, draft.trim()) : next.delete(name);
      setParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, composing, applied, name, setParams]);
  return <div className="workspace-search"><Field label={entity ? "속성 1 키워드" : "검색어"}>
    {props => <div className="workspace-search-input"><input {...props} ref={input} className="input" value={draft}
      maxLength={entity ? 100 : 200} placeholder={entity ? "엔터티 제목 검색" : "검색어 입력"}
      onChange={event => setDraft(event.target.value)} onCompositionStart={() => setComposing(true)}
      onCompositionEnd={event => { setDraft(event.currentTarget.value); setComposing(false); }}/>
      {!!draft && <button type="button" className="search-clear" aria-label="검색어 지우기" onClick={() => {
        setDraft(""); setComposing(false); const next = clearListPosition(new URLSearchParams(latest.current)); next.delete(name);
        setParams(next, { replace: true }); input.current?.focus();
      }}>×</button>}
    </div>}
  </Field></div>;
}
export function resetTabFilters(params: URLSearchParams) {
  return new URLSearchParams([...params].filter(([key]) => ["q", "keyword", "filters"].includes(key)));
}
/** URL owns disclosure state; optional conditions remain mounted while hidden. */
export function TabFilters({ active = false, attention = false, children }: { active?: boolean; attention?: boolean; children: ReactNode }) {
  const [params] = useSearchParams(), location = useLocation(), navigate = useNavigate();
  const open = params.get("filters") === "1", controls = useId();
  return <div className="tab-filters">
    <div className="tab-filter-toolbar">
      <BodyAction icon="filter" aria-expanded={open} aria-controls={controls} onClick={() => {
        const next = new URLSearchParams(params);
        open ? next.delete("filters") : next.set("filters", "1");
        void navigate({ pathname: location.pathname, search: next.toString(), hash: location.hash }, { replace: true, preventScrollReset: true });
      }}>필터 {open ? "닫기" : "열기"}{attention ? " · 확인 필요" : active ? " · 적용 중" : ""}</BodyAction>
      {open && <BodyAction icon="reset" className="filter-reset" onClick={() => {
        void navigate({ pathname: location.pathname, search: resetTabFilters(params).toString(), hash: "" }, { replace: true });
      }}>조건 초기화</BodyAction>}
    </div>
    <div className="form" id={controls} hidden={!open}>{children}</div>
  </div>;
}
