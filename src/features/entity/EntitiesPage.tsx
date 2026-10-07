import { useCreateMode } from "../../components/useCreateMode.ts";
import { TabSearch, AppliedConditions, resetTabFilters } from "../../components/TabSearch.tsx";
import { TagDictionaryStatus, TagFilter, TagNames, TagReadProvider, useTagDictionary } from "../tags/TagPicker.tsx";
import { listReturnPath, shouldPublishRestoredPage } from "../activity/list-state.ts";
import type { EntityResult } from "@contracts/entity.ts";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { Field, Notice } from "../../components/Field.tsx";
import { api, ApiError, query } from "../../lib/api.ts";
import { EntityForm } from "./forms.tsx";
import { GuideLink } from "../../components/GuideLink.tsx";
import { TabActions } from "../../components/TabActions.tsx";
type Page = { items: EntityResult[]; next_cursor: string | null; count: number };
export function EntitiesPage() {
  const create=useCreateMode();
  const dictionary=useTagDictionary(true,true,"entity");
  const [params] = useSearchParams(),
    { hash } = useLocation(),
    navigate = useNavigate();
  const requested = Number(params.get("pages") ?? 1);
  const pages = Number.isSafeInteger(requested) && requested > 0 ? Math.min(250, requested) : 1;
  const filter = {
    keyword: params.get("keyword"),
    tag_id: params.get("tag_id"),
    prop3_from: params.get("prop3_from"),
    prop3_to: params.get("prop3_to"),
    prop4: params.get("prop4"),
    sort: params.get("sort") ?? "updated_at",
  };
  const key = query(filter),
    [page, setPage] = useState<Page | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [manualPage, setManualPage] = useState<{ context: string; count: number; epoch: number } | null>(null),
    [retry, setRetry] = useState(0);
  const creating=create.open;
  const context = `${key}|${hash}`;
  const loaded = useRef<{ context: string; page: Page; epoch: number } | null>(null),
    focused = useRef(""),
    epoch = useRef(0);
  // Both the click state and URL navigation describe one target, so they must not restart the same fetch.
  const manualTarget =
    loaded.current?.context === context && manualPage?.context === context && manualPage.epoch === loaded.current.epoch
      ? manualPage.count
      : 0;
  const target = Math.max(pages, manualTarget);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setBusy(true);
    const cachedEntry = loaded.current?.context === context ? loaded.current : null;
    const cached = cachedEntry?.page ?? null, loadEpoch = cachedEntry?.epoch ?? ++epoch.current;
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
          (result.count < target || (anchor && result.count < maximum && !result.items.some((e) => e.id === anchor))))
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
        loaded.current = { context, page: result, epoch: loadEpoch };
        if (shouldPublishRestoredPage(result.count, target)) setPage(result);
        if (!next.next_cursor) break;
      }
      if (!controller.signal.aborted) setPage(result);
    })().catch((e) => {
      if (!controller.signal.aborted) {
        if (loaded.current?.context === context) setPage(loaded.current.page);
        setError(
          e instanceof ApiError ? e.message : "엔터티를 불러오지 못했습니다.",
        );
      }
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, [key, target, retry, hash]);
  useEffect(() => {
    if (
      (dictionary.tags===null&&!dictionary.failed) || busy || error || loaded.current?.context !== context || focused.current === context || !page ||
      !/^#entity-[0-9a-f-]+$/.test(hash)
    ) return;
    const node = document.getElementById(hash.slice(1));
    if (node) {
      node.focus({preventScroll:true});
      const y=Number(params.get("scroll"));if(params.has("scroll")&&Number.isFinite(y)&&y>=0)window.scrollTo(0,y);
      const rect=node.getBoundingClientRect();if(rect.top<0||rect.bottom>innerHeight)node.scrollIntoView({ block: "center" });
    } else document.getElementById("entities-title")?.focus();
    focused.current = context;
  }, [page, busy, error, context, hash,dictionary.tags,dictionary.failed]);
  const set = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete("pages");
    navigate({ pathname: "/entities", search: next.toString(), hash: "" }, { replace: true });
  };
  const rowLink=(id:string,edit=false)=>{
    const p=new URLSearchParams(params);p.delete("create");p.set("pages",String(page?.count??1));const back=listReturnPath("entities",p,id,0);
    return {to:`/entities/${id}?list=${encodeURIComponent(back)}${edit?"&edit=1":""}`,onClick:(event:React.MouseEvent<HTMLAnchorElement>)=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();const at=listReturnPath("entities",p,id,window.scrollY);navigate(at,{replace:true,preventScrollReset:true});navigate(`/entities/${id}?list=${encodeURIComponent(at)}${edit?"&edit=1":""}`);}};
  };
  return (
    <><section className="panel" aria-labelledby="entities-title">
      <div className="panel-head">
        <h1 id="entities-title" className="page-title" tabIndex={-1}>엔터티</h1>
        <TabActions title="엔터티" actions={[{label:"엔터티 등록",run:create.begin},{label:"엔터티 태그 관리",to:"/tags/entity"}]}/>
      </div>
      <TabSearch entity/>
      <TagDictionaryStatus dictionary={dictionary}/>
      <fieldset className="field tag-filter-chips"><legend className="label">엔터티 태그</legend><div className="chips">{dictionary.tags?.map(tag=><button type="button" className="chip" key={tag.id} aria-pressed={filter.tag_id===tag.id} onClick={()=>set("tag_id",filter.tag_id===tag.id?"":tag.id)}>{tag.name}</button>)}</div></fieldset>
      <details className="workspace-additional"><summary>필터</summary><div className="form" role="group" aria-label="엔터티 필터">
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
      </div></details><AppliedConditions namesForIds={Object.fromEntries(dictionary.tags?.map(t=>[t.id,t.name])??[])}/>
    </section><section className="activity-section" aria-label="엔터티 목록">
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
          {key === "?sort=updated_at" && <GuideLink />}
          <button className="btn" onClick={() => navigate(`/entities?${resetTabFilters(params)}`, { replace: true })}>
            필터 해제
          </button>
        </>
      )}
      <TagReadProvider dictionary={dictionary} enabled={!!page?.items.some(e=>(e as EntityResult & {tag_ids?:string[]}).tag_ids?.length)}><ul className="list panel">
        {page?.items.map((e) => (
          <li className="list-item" key={e.id}>
            <div className="list-item-main">
              <div className="activity-item-heading"><Link id={`entity-${e.id}`} className="item-title" {...rowLink(e.id)}>{e.prop1}</Link><span className="activity-item-actions"><Link {...rowLink(e.id,true)} aria-label={`${e.prop1} 편집`}>편집</Link></span></div>
              <dl className="entity-list-properties">
                {e.prop2!==null&&<div><dt>속성 2</dt><dd>{e.prop2}</dd></div>}
                {e.prop3!==null&&<div><dt>속성 3</dt><dd>{e.prop3}</dd></div>}
                <div><dt>속성 4</dt><dd>{e.prop4}</dd></div>
              </dl>
              <TagNames scope="entity" ids={(e as EntityResult & {tag_ids?:string[]}).tag_ids??[]} compact/>
            </div>
          </li>
        ))}
      </ul></TagReadProvider>
      {page && (page.next_cursor || page.count > 1) && (
        <button
          className="btn"
          aria-disabled={busy || !page.next_cursor}
          onClick={() => {
            const current = loaded.current;
            if (busy || !page.next_cursor || current?.context !== context) return;
            if (error) {
              setRetry((n) => n + 1);
              return;
            }
            const next = new URLSearchParams(params);
            setManualPage({ context, count: page.count + 1, epoch: current.epoch });
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
          key={create.key}
          onClose={create.close}
          onRouteDiscard={create.discard}
          onSave={async (value, creationId) => {
            const e = await api<EntityResult>("POST", "/entities", {
              ...value,
              id: creationId(),
            });
            const p=new URLSearchParams(params);p.delete("create");create.finish(`/entities/${e.id}?list=${encodeURIComponent(`/entities?${p}`)}`);
          }}
        />
      )}
    </section></>
  );
}
