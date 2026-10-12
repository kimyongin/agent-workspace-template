import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { EntityType } from "@contracts/entity-type.ts";
import { entityPath } from "@contracts/entity-identity.ts";
import { CollectionHeading, CollectionList, useMainCollectionView } from "../../components/Collection.tsx";
import { useCreateMode } from "../../components/useCreateMode.ts";
import { resetTabFilters, TabFilters, TabSearch } from "../../components/TabSearch.tsx";
import { TagDictionaryStatus, TagReadProvider, useTagDictionary } from "../tags/TagPicker.tsx";
import { anchorId, requestedPages } from "../activity/list-state.ts";
import { usePagedList } from "../collections/usePagedList.ts";
import type { ListPage } from "../collections/paged-list.ts";
import type { EntitySummary } from "@contracts/entity.ts";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { ListExpansionProvider, ListPreviewItem, useRestoreListPosition } from "../relations/ListPreviewItem.tsx";
import { Field, Notice } from "../../components/Field.tsx";
import { api, ApiError, query } from "../../lib/api.ts";
import { EntityForm } from "./forms.tsx";
import { GuideLink } from "../../components/GuideLink.tsx";
import { TabCreateButton } from "../../components/TabCreateButton.tsx";

export function EntitiesPage() {
  const create = useCreateMode();
  const [view, changeView] = useMainCollectionView();
  const dictionary = useTagDictionary(true, true, "entity");
  const [params] = useSearchParams(),
    { hash } = useLocation(),
    navigate = useNavigate();
  const pages = requestedPages(params);
  const filter = {
    keyword: params.get("keyword"),
    tag_id: params.get("tag_id"),
    entity_type_id: params.get("entity_type_id"),
    sort: params.get("sort") ?? "updated_at",
  };
  const [types, setTypes] = useState<EntityType[] | null>(null), [typeError, setTypeError] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    void api<{ items: EntityType[] }>("GET", "/entity-types?include_archived=true&limit=100", undefined, c.signal).then(
      (value) => {
        if (!c.signal.aborted) setTypes(value.items);
      },
    ).catch(() => {
      if (!c.signal.aborted) setTypeError(true);
    });
    return () => c.abort();
  }, []);
  const selectedType = types?.find((type) => type.id === filter.entity_type_id),
    label = selectedType?.label ?? "전체 자료";
  const unsupported = ["prop3_from", "prop3_to", "prop4"].some((key) => params.has(key));
  const key = query(filter), context = `${key}|${hash}|${unsupported}`;
  const creating = create.open;
  const list = usePagedList<EntitySummary, ListPage<EntitySummary>>({
    scope: context,
    pages,
    anchor: anchorId("entities", hash),
    anchorLookahead: 1,
    restoreRetry: "resume",
    retainOnDecrease: true,
    load: (cursor, signal) =>
      unsupported
        ? Promise.reject(
          new ApiError(400, "invalid_input", "이전 속성 조건은 더 이상 지원하지 않습니다. 조건을 초기화하세요."),
        )
        : api("GET", `/entities${query({ ...filter, cursor })}`, undefined, signal),
  });
  const { page, busy } = list;
  const error = list.error ? list.error instanceof ApiError ? list.error.message : "자료를 불러오지 못했습니다." : null;
  const readiness = useRestoreListPosition(
    "entities",
    (dictionary.tags !== null || dictionary.failed) && !busy && !!page,
  );
  const set = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name === "entity_type_id") {
      next.delete("sort");
      next.delete("prop3_from");
      next.delete("prop3_to");
      next.delete("prop4");
    }
    next.delete("pages");
    next.delete("open");
    navigate({ pathname: "/entities", search: next.toString(), hash: "" }, { replace: true });
  };
  return (
    <>
      <section className="panel main-tab-header" aria-labelledby="entities-title">
        <div className="panel-head">
          <h1 id="entities-title" className="page-title" tabIndex={-1}>{label}</h1>
        </div>
        <div className="query-bar">
          <TabSearch entity />
          <Field label="자료 종류">
            {(p) => (
              <select
                {...p}
                className="input"
                value={filter.entity_type_id ?? ""}
                onChange={(e) => set("entity_type_id", e.target.value)}
              >
                <option value="">전체 자료</option>
                {types?.map((type) => (
                  <option key={type.id} value={type.id}>{type.label}{type.archived ? " · 보관" : ""}</option>
                ))}
              </select>
            )}
          </Field>
          {typeError && <Notice kind="error">자료 종류를 불러오지 못했습니다.</Notice>}
          <Link to={selectedType ? `/settings/entity-types/${selectedType.id}` : "/settings/entity-types"}>
            자료 종류·속성 관리
          </Link>
          <TabFilters
            active={!!(filter.tag_id || filter.sort !== "updated_at")}
            attention={dictionary.failed}
            summary={[]}
          >
            <div className="filter-grid" role="group" aria-label="자료 필터">
              <Field label="정렬">
                {(p) => (
                  <select
                    {...p}
                    className="input"
                    value={filter.sort}
                    onChange={(e) => set("sort", e.target.value)}
                  >
                    <option value="updated_at">최근 수정순</option>
                    <option value="title">이름순</option>
                  </select>
                )}
              </Field>
            </div>
            <TagDictionaryStatus dictionary={dictionary} />
            <fieldset className="field tag-filter-chips">
              <legend className="label">자료 태그</legend>
              <div className="chips">
                {dictionary.tags?.map((tag) => (
                  <button
                    type="button"
                    className="chip"
                    key={tag.id}
                    aria-pressed={filter.tag_id === tag.id}
                    onClick={() => set("tag_id", filter.tag_id === tag.id ? "" : tag.id)}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            </fieldset>
          </TabFilters>
        </div>
      </section>
      <ListExpansionProvider readiness={readiness}>
        <section className="activity-section" aria-label={`${label} 목록`}>
          <div className="detail-section-head">
            <CollectionHeading
              label={label}
              count={page?.items.length}
              hasMore={!!page?.next_cursor}
              view={view}
              onChange={changeView}
            />
            {types?.some((type) => !type.archived)
              ? <TabCreateButton label={`${selectedType?.label ?? "자료"} 추가`} onClick={create.begin} />
              : <Link to="/settings/entity-types">자료 종류 만들기·보관 관리</Link>}
          </div>
          {error && (
            <>
              <Notice kind="error">{error}</Notice>
              {unsupported && (
                <button
                  className="btn"
                  onClick={() => navigate(`/entities?${resetTabFilters(params)}`, { replace: true })}
                >
                  조건 초기화
                </button>
              )}
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
                {key !== "?sort=updated_at" ? "조건에 맞는 자료가 없습니다." : "아직 자료가 없습니다."}
              </p>
              {key === "?sort=updated_at" && <GuideLink />}
              <button
                className="btn"
                onClick={() => navigate(`/entities?${resetTabFilters(params)}`, { replace: true })}
              >
                필터 해제
              </button>
            </>
          )}
          <TagReadProvider
            dictionary={dictionary}
            enabled={!!page?.items.some((e) => (e as EntitySummary & { tag_ids?: string[] }).tag_ids?.length)}
          >
            <CollectionList
              view={view === "calendar" ? "list" : view}
              label={`${label} 목록`}
              columns={["자료", "자료 종류"]}
            >
              {page?.items.map((e) => (
                <li className="list-item" key={e.id}>
                  <div className="list-item-main">
                    <ListPreviewItem kind="entities" id={e.id} title={e.title} cells={[e.type.label]} />
                  </div>
                </li>
              ))}
            </CollectionList>
          </TagReadProvider>
          {page && (page.next_cursor || page.pages > 1) && (
            <button
              className="btn"
              aria-disabled={busy || !page.next_cursor}
              onClick={() => {
                if (busy || !page.next_cursor) return;
                if (error) {
                  void list.retry();
                  return;
                }
                const target = list.more();
                if (!target) return;
                const next = new URLSearchParams(params);
                next.set("pages", String(target));
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
              initialTypeId={filter.entity_type_id ?? undefined}
              initialTypeLabel={selectedType?.label}
              onClose={create.close}
              onRouteDiscard={create.discard}
              onSave={async (value, requestKey) => {
                const e = await api<EntitySummary>(
                  "POST",
                  "/entities",
                  {
                    ...value,
                  },
                  undefined,
                  requestKey(),
                );
                const p = new URLSearchParams(params);
                p.delete("create");
                create.finish(`${entityPath(e.id)}?list=${encodeURIComponent(`/entities?${p}`)}`);
              }}
            />
          )}
        </section>
      </ListExpansionProvider>
    </>
  );
}
