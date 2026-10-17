import { useDetailViewState } from "../lib/detail-exploration.tsx";
import { changeEntityListQuery } from "../lib/entity-list-url.ts";
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { Field } from "./Field.tsx";
import { Button } from "./ui/button.tsx";
import { InputGroup, InputGroupInput, InputGroupAddon, InputGroupButton } from "./ui/input-group.tsx";
import { FieldGroup } from "./ui/field.tsx";
import { Card, CardHeader, CardTitle, CardAction, CardContent, CardFooter } from "./ui/card.tsx";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./ui/collapsible.tsx";
import { SearchIcon, XIcon, SlidersHorizontalIcon, RotateCcwIcon } from "lucide-react";


export function clearListPosition(params: URLSearchParams) {
  params.delete("open");
  ["pages", "tasks_pages", "records_pages", "scroll", "collapsed"].forEach((key) => params.delete(key));
  return params;
}
/** Debounce only text; concurrent filter changes survive through the latest URL. */
export function TabSearch({ entity = false }: { entity?: boolean }) {
  const [params, originalSetParams] = useSearchParams(), location = useLocation(), navigate = useNavigate();
  const latestLocation = useRef(location);
  latestLocation.current = location;
  const setParams = useCallback((next: URLSearchParams, options: { replace: boolean }) => {
    if (!entity) return originalSetParams(next, options);
    const current = latestLocation.current;
    return navigate(
      { pathname: current.pathname, ...changeEntityListQuery(next, latest.current, current.hash) },
      options,
    );
  }, [entity, originalSetParams, navigate]);
  const name = entity ? "keyword" : "q", applied = params.get(name) ?? "";
  const latest = useRef(params);
  latest.current = params;
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
  return <Field label={entity ? "자료 제목 검색" : "검색어"}>
    {(props) => <InputGroup>
      <InputGroupAddon><SearchIcon aria-hidden="true" /></InputGroupAddon>
      <InputGroupInput {...props} ref={input} value={draft} maxLength={entity ? 100 : 200}
        placeholder={entity ? "자료 이름 검색" : "검색어 입력"}
        onChange={event => setDraft(event.target.value)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={event => { setDraft(event.currentTarget.value); setComposing(false); }} />
      {!!draft && <InputGroupAddon align="inline-end"><InputGroupButton size="icon-sm" aria-label="검색어 지우기"
        onClick={() => {
          setDraft(""); setComposing(false);
          const next = clearListPosition(new URLSearchParams(latest.current)); next.delete(name);
          setParams(next, { replace: true }); input.current?.focus();
        }}><XIcon /></InputGroupButton></InputGroupAddon>}
    </InputGroup>}
  </Field>;
}

export function resetTabFilters(params: URLSearchParams) {
  return new URLSearchParams(
    [...params].filter(([key]) => ["q", "keyword", "filters", "view", "entity_type_id"].includes(key)),
  );
}
/** URL owns disclosure state; optional conditions remain mounted while hidden. */
export function TabFilters(
  { active = false, attention = false, summary = [], children, dirty = false, onReset, onApply }: {
    active?: boolean;
    attention?: boolean;
    summary?: string[];
    children: ReactNode;
    dirty?: boolean;
    onReset: () => void;
    onApply: () => void;
  },
) {
  const [params] = useSearchParams(), location = useLocation(), navigate = useNavigate();
  const open = params.get("filters") === "1", controls = useId();
  const label = `필터 ${open ? "닫기" : "열기"}${attention ? " · 확인 필요" : active ? " · 적용 중" : ""}`;
  const changeOpen = (value: boolean) => {
    const next = new URLSearchParams(params);
    value ? next.set("filters", "1") : next.delete("filters");
    void navigate({ pathname: location.pathname, search: next.toString(), hash: location.hash }, {
      replace: true, preventScrollReset: true,
    });
  };
  return <Collapsible open={open} onOpenChange={changeOpen} className="flex flex-col gap-3">
    <div className="flex flex-wrap items-center justify-end gap-3">
      {!open && (summary.length > 0 || attention) && <p className="mr-auto text-sm text-muted-foreground" aria-label="적용된 필터">
        {summary.join(" · ")}{attention && `${summary.length ? " · " : ""}조건 확인 필요`}
      </p>}
      <CollapsibleTrigger asChild><Button variant="outline" aria-label={label} title={label}>
        <SlidersHorizontalIcon data-icon="inline-start" />필터
      </Button></CollapsibleTrigger>
    </div>
    <CollapsibleContent id={controls} forceMount hidden={!open}>
      <FilterPanel dirty={dirty} onReset={onReset} onApply={onApply}>{children}</FilterPanel>
    </CollapsibleContent>
  </Collapsible>;
}

export function FilterPanel({ children, dirty = false, onReset, onApply, id, hidden }: {
  children: ReactNode; dirty?: boolean; onReset: () => void; onApply: () => void; id?: string; hidden?: boolean;
}) {
  return <Card id={id} hidden={hidden}>
    <CardHeader><CardTitle>필터</CardTitle><CardAction>
      <Button type="button" variant="ghost" onClick={onReset}><RotateCcwIcon data-icon="inline-start" />조건 초기화</Button>
    </CardAction></CardHeader>
    <CardContent><FieldGroup>{children}</FieldGroup></CardContent>
    <CardFooter className="flex-wrap justify-end gap-3">
      {dirty && <span className="mr-auto text-sm text-muted-foreground" role="status">변경사항 적용 대기</span>}
      <Button type="button" onClick={onApply}>필터 적용</Button>
    </CardFooter>
  </Card>;
}

/** Applied optional conditions synchronize independently of text/disclosure/list position. */
export function useFilterDraft(applied: URLSearchParams, context = "") {
  const location = useLocation();
  const normalized = new URLSearchParams(applied);
  normalized.sort();
  const signature = normalized.toString();
  const source = `${context}|${signature}`;
  const [state, setState] = useDetailViewState<{ source: string; draft: URLSearchParams; expected?: string }>(
    `filter-draft:${location.pathname}`,
    { source, draft: new URLSearchParams(signature) },
  );
  const latest = useRef({ source, signature });
  latest.current = { source, signature };
  useEffect(() => {
    const moved = () =>
      setState({ source: latest.current.source, draft: new URLSearchParams(latest.current.signature) });
    window.addEventListener("popstate", moved);
    return () => window.removeEventListener("popstate", moved);
  }, [setState]);
  // Retained list locations acknowledge navigation after the browser URL updates.
  // Keep any new edits while acknowledging our own apply, and reset on external changes.
  const accepted = state.expected === signature;
  const draft = state.source === source || accepted ? state.draft : new URLSearchParams(signature);
  if (state.source !== source) setState({ source, draft });
  const setDraft: Dispatch<SetStateAction<URLSearchParams>> = (change) =>
    setState((previous) => ({
      ...previous,
      source,
      draft: typeof change === "function"
        ? change(previous.source === source ? previous.draft : new URLSearchParams(signature))
        : change,
    }));
  return {
    draft,
    dirty: (() => {
      const ordered = new URLSearchParams(draft);
      ordered.sort();
      return ordered.toString() !== signature;
    })(),
    commit: (value: URLSearchParams) => {
      const ordered = new URLSearchParams(value);
      ordered.sort();
      setState({ source, expected: ordered.toString(), draft: new URLSearchParams(value) });
    },
    setDraft,
    set: (name: string, value: string) =>
      setDraft((previous) => {
        const next = new URLSearchParams(previous);
        value ? next.set(name, value) : next.delete(name);
        return next;
      }),
    reset: () => setDraft(new URLSearchParams()),
  };
}

export function pickFilterParams(params: URLSearchParams, keys: readonly string[]) {
  return new URLSearchParams([...params].filter(([key]) => keys.includes(key)));
}
export function applyFilterParams(params: URLSearchParams, draft: URLSearchParams, keys: readonly string[]) {
  const next = clearListPosition(new URLSearchParams(params));
  for (const key of keys) next.delete(key);
  for (const [key, value] of draft) next.set(key, value);
  return next;
}
