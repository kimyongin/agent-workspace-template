import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Field } from "./Field.tsx";
import "./workspace.css";

export function clearListPosition(params: URLSearchParams) {
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
      maxLength={entity ? 100 : 200} placeholder={entity ? "속성 1 부분 일치" : "제목·본문 검색"}
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
  return new URLSearchParams([...params].filter(([key]) => ["q", "keyword"].includes(key)));
}
export function AppliedConditions(_props: { namesForIds?: Record<string, string>; excluded?: string[] } = {}) { return null; }
