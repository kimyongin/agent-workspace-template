import { useCreateMode } from "../../components/useCreateMode.ts";
import { TabSearch, TabFilters, resetTabFilters } from "../../components/TabSearch.tsx";
import { TagDictionaryStatus, TagReadProvider, useTagDictionary } from "../tags/TagPicker.tsx";
import { shouldPublishRestoredPage } from "../activity/list-state.ts";
import type { EntityResult } from "@contracts/entity.ts";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { ListExpansionProvider, ListPreviewItem, useRestoreListPosition } from "../relations/ListPreviewItem.tsx";
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
      const maximum = anchor && !result.items.some(item=>item.id===anchor) ? Math.min(250, pages + 1) : pages;
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
  useRestoreListPosition("entities", (dictionary.tags!==null||dictionary.failed)&&!busy&&loaded.current?.context===context&&!!page);
  const set = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete("pages");
    next.delete("open");
    navigate({ pathname: "/entities", search: next.toString(), hash: "" }, { replace: true });
  };
  return (
    <><section className="panel" aria-labelledby="entities-title">
      <div className="panel-head">
        <h1 id="entities-title" className="page-title" tabIndex={-1}>엔터티</h1>
        <TabActions title="엔터티" actions={[{label:"엔터티 등록",run:create.begin},{label:"엔터티 태그 관리",to:"/tags/entity"}]}/>
      </div>
      <TabSearch entity/>
      <TabFilters active={!!(filter.tag_id||filter.prop3_from||filter.prop3_to||filter.prop4||filter.sort!=="updated_at")} attention={dictionary.failed}>
      <TagDictionaryStatus dictionary={dictionary}/>
      <fieldset className="field tag-filter-chips"><legend className="label">엔터티 태그</legend><div className="chips">{dictionary.tags?.map(tag=><button type="button" className="chip" key={tag.id} aria-pressed={filter.tag_id===tag.id} onClick={()=>set("tag_id",filter.tag_id===tag.id?"":tag.id)}>{tag.name}</button>)}</div></fieldset>
      <div className="form" role="group" aria-label="엔터티 필터">
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
      </div></TabFilters>
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
      <ListExpansionProvider><TagReadProvider dictionary={dictionary} enabled={!!page?.items.some(e=>(e as EntityResult & {tag_ids?:string[]}).tag_ids?.length)}><ul className="list disclosure-list panel">
        {page?.items.map((e) => (
          <li className="list-item" key={e.id}>
            <div className="list-item-main">
              <ListPreviewItem kind="entities" id={e.id} title={e.prop1}/>
            </div>
          </li>
        ))}
      </ul></TagReadProvider></ListExpansionProvider>
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
