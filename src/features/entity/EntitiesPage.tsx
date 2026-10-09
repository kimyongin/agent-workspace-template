import { entityPath } from "@contracts/entity-identity.ts";
import { CollectionHeading, CollectionList, useMainCollectionView } from "../../components/Collection.tsx";
import { useCreateMode } from "../../components/useCreateMode.ts";
import { TabSearch, TabFilters, resetTabFilters } from "../../components/TabSearch.tsx";
import { TagDictionaryStatus, TagReadProvider, useTagDictionary } from "../tags/TagPicker.tsx";
import { anchorId, requestedPages } from "../activity/list-state.ts";
import { usePagedList } from "../collections/usePagedList.ts";
import type { ListPage } from "../collections/paged-list.ts";
import type { EntityResult } from "@contracts/entity.ts";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { ListExpansionProvider, ListPreviewItem, useRestoreListPosition } from "../relations/ListPreviewItem.tsx";
import { Field, Notice } from "../../components/Field.tsx";
import { api, ApiError, query } from "../../lib/api.ts";
import { EntityForm } from "./forms.tsx";
import { GuideLink } from "../../components/GuideLink.tsx";
import { TabCreateButton } from "../../components/TabCreateButton.tsx";

export function EntitiesPage() {
  const create=useCreateMode();
  const [view,changeView]=useMainCollectionView();
  const dictionary=useTagDictionary(true,true,"entity");
  const [params] = useSearchParams(),
    { hash } = useLocation(),
    navigate = useNavigate();
  const pages = requestedPages(params);
  const filter = {
    keyword: params.get("keyword"),
    tag_id: params.get("tag_id"),
    prop3_from: params.get("prop3_from"),
    prop3_to: params.get("prop3_to"),
    prop4: params.get("prop4"),
    sort: params.get("sort") ?? "updated_at",
  };
  const key = query(filter), context = `${key}|${hash}`;
  const creating=create.open;
  const list = usePagedList<EntityResult, ListPage<EntityResult>>({
    scope: context, pages, anchor: anchorId("entities", hash), anchorLookahead: 1,
    restoreRetry: "resume", retainOnDecrease: true,
    load: (cursor, signal) => api("GET", `/entities${query({ ...filter, cursor })}`, undefined, signal),
  });
  const { page, busy } = list;
  const error = list.error ? list.error instanceof ApiError ? list.error.message : "엔터티를 불러오지 못했습니다." : null;
  const readiness = useRestoreListPosition("entities", (dictionary.tags!==null||dictionary.failed)&&!busy&&!!page);
  const set = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete("pages");
    next.delete("open");
    navigate({ pathname: "/entities", search: next.toString(), hash: "" }, { replace: true });
  };
  return (
    <><section className="panel main-tab-header" aria-labelledby="entities-title">
      <div className="panel-head">
        <h1 id="entities-title" className="page-title" tabIndex={-1}>엔터티</h1>
      </div>
      <div className="query-bar"><TabSearch entity/>
      <TabFilters active={!!(filter.tag_id||filter.prop3_from||filter.prop3_to||filter.prop4||filter.sort!=="updated_at")} attention={dictionary.failed}>
      <div className="filter-grid" role="group" aria-label="엔터티 필터">
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
      <TagDictionaryStatus dictionary={dictionary}/>
      <fieldset className="field tag-filter-chips"><legend className="label">엔터티 태그</legend><div className="chips">{dictionary.tags?.map(tag=><button type="button" className="chip" key={tag.id} aria-pressed={filter.tag_id===tag.id} onClick={()=>set("tag_id",filter.tag_id===tag.id?"":tag.id)}>{tag.name}</button>)}</div></fieldset>
      </TabFilters></div>
    </section><ListExpansionProvider readiness={readiness}><section className="activity-section" aria-label="엔터티 목록">
      <div className="detail-section-head"><CollectionHeading label="엔터티" count={page?.items.length} hasMore={!!page?.next_cursor} view={view} onChange={changeView}/><TabCreateButton label="엔터티 등록" onClick={create.begin}/></div>
      {error && (
        <>
          <Notice kind="error">{error}</Notice>
          {!page &&
            (
              <button className="btn" onClick={() => void list.retry()}>
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
      <TagReadProvider dictionary={dictionary} enabled={!!page?.items.some(e=>(e as EntityResult & {tag_ids?:string[]}).tag_ids?.length)}><CollectionList view={view==="calendar"?"list":view} label="엔터티 목록" columns={["엔터티","속성 2","속성 3"]} numericColumns={[1,2]}>
        {page?.items.map((e) => (
          <li className="list-item" key={e.id}>
            <div className="list-item-main">
              <ListPreviewItem kind="entities" id={e.id} title={e.prop1} cells={[e.prop2,e.prop3]}/>
            </div>
          </li>
        ))}
      </CollectionList></TagReadProvider>
      {page && (page.next_cursor || page.pages > 1) && (
        <button
          className="btn"
          aria-disabled={busy || !page.next_cursor}
          onClick={() => {
            if (busy || !page.next_cursor) return;
            if (error) { void list.retry(); return; }
            const target = list.more();
            if (!target) return;
            const next = new URLSearchParams(params);
            next.set("pages", String(target));
            navigate({ pathname: "/entities", search: next.toString(), hash }, {
              replace: true, preventScrollReset: true,
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
          onSave={async (value) => {
            const e = await api<EntityResult>("POST", "/entities", {
              ...value,

            });
            const p=new URLSearchParams(params);p.delete("create");create.finish(`${entityPath(e.id)}?list=${encodeURIComponent(`/entities?${p}`)}`);
          }}
        />
      )}
    </section></ListExpansionProvider></>
  );
}
