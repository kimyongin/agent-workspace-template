import { EyeIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { schemaPresentation } from "../../lib/schema-document.ts";
import { PageHeading } from "../../components/PageHeading.tsx";
import {
  changeEntityListQuery,
  detailListLink,
  readEntityListUrl,
  writeEntityListUrl,
} from "../../lib/entity-list-url.ts";
import { EntityTypeIcon } from "./EntityTypeIcon.tsx";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EntitySchemaResult } from "@contracts/entity-type.ts";
import { displayedProperty, fieldType } from "./property-fields.tsx";
import { TypedEntityFilters, validatePropertyFilters } from "./TypedEntityFilters.tsx";
import { EntityTypePicker } from "./EntityTypePicker.tsx";
import { useEntityTypes } from "./useEntityTypes.ts";
import { typeListSearch } from "../../app/type-navigation.ts";
import { Link } from "react-router";
import { entityPath } from "@contracts/entity-identity.ts";
import {
  CollectionHeading,
  CollectionItem,
  CollectionList,
  useMainCollectionView,
} from "../../components/Collection.tsx";
import { useCreateMode } from "../../components/useCreateMode.ts";
import {
  applyFilterParams,
  pickFilterParams,
  resetTabFilters,
  TabFilters,
  TabSearch,
  useFilterDraft,
} from "../../components/TabSearch.tsx";
import { TagSelection } from "../tags/TagSelection.tsx";
import { TagDictionaryStatus, TagReadProvider, useTagDictionary } from "../tags/TagPicker.tsx";
import { anchorId, requestedPages } from "../activity/list-state.ts";
import { usePagedList } from "../collections/usePagedList.ts";
import type { ListPage } from "../collections/paged-list.ts";
import { entityListQuery, type EntitySummary } from "@contracts/entity.ts";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { ListExpansionProvider, ListPreviewItem, useRestoreListPosition } from "../relations/ListPreviewItem.tsx";
import { Notice } from "../../components/Field.tsx";
import { scrollOwner } from "../../lib/surface-dom.ts";
import { api, ApiError, query } from "../../lib/api.ts";
import { EntityForm } from "./forms.tsx";
import { GuideLink } from "../../components/GuideLink.tsx";
import { TabCreateButton } from "../../components/TabCreateButton.tsx";

export function EntitiesPage() {
  const searchInput = useRef<HTMLInputElement>(null);
  const create = useCreateMode();
  const [view, changeView] = useMainCollectionView();
  const dictionary = useTagDictionary(true, true, "entity");
  const [params] = useSearchParams(),
    { hash } = useLocation(),
    navigate = useNavigate();
  const urlFilters = readEntityListUrl(params, hash);
  useEffect(() => {
    if (urlFilters.error || !params.has("property_filters")) return;
    const normalized = writeEntityListUrl(params, urlFilters.raw, urlFilters.anchor);
    if (normalized.search !== params.toString() || normalized.hash !== hash) {
      void navigate({ pathname: "/entities", ...normalized }, { replace: true, preventScrollReset: true });
    }
  }, [params, hash, urlFilters.raw, urlFilters.error, navigate]);
  const pages = requestedPages(params);
  const filter = {
    keyword: params.get("keyword"),
    tag_id: params.get("tag_id"),
    entity_type_id: params.get("entity_type_id"),
    sort: params.get("sort") ?? "updated_at",
    filters: urlFilters.raw,
  };
  const filterKeys = ["tag_id", "sort", "property_filters", "prop3_from", "prop3_to", "prop4"];
  const applied = pickFilterParams(params, filterKeys);
  if (urlFilters.raw) applied.set("property_filters", urlFilters.raw);
  const editing = useFilterDraft(applied, filter.entity_type_id ?? "");
  const [filterError, setFilterError] = useState("");
  const filterApply = useRef<HTMLButtonElement>(null);
  const [focusRecoveryApply, setFocusRecoveryApply] = useState(false);
  useEffect(() => {
    if (!focusRecoveryApply || params.get("filters") !== "1") return;
    filterApply.current?.focus();
    setFocusRecoveryApply(false);
  }, [focusRecoveryApply, params]);
  const resetFilters = () => {
    editing.reset();
    setFilterError("");
  };
  const applyFilters = () => {
    try {
      const sort = editing.draft.get("sort") ?? "updated_at";
      const parsedSort = entityListQuery.shape.sort.parse(sort.startsWith("{") ? JSON.parse(sort) : sort);
      if (
        typeof parsedSort === "object" &&
        (!schema?.schema.properties[parsedSort.key] || schema.schema.properties[parsedSort.key].deprecated)
      ) throw Error("정렬 속성을 확인하세요.");
      const raw = validatePropertyFilters(editing.draft.get("property_filters"), schema);
      const next = applyFilterParams(params, editing.draft, filterKeys);
      raw ? next.set("property_filters", raw) : next.delete("property_filters");
      editing.commit(pickFilterParams(next, filterKeys));
      setFilterError("");
      navigate({ pathname: "/entities", ...writeEntityListUrl(next, raw || null) }, { replace: true });
    } catch {
      setFilterError("조건 값과 비교를 확인하세요. 빈 숫자는 0으로 처리하지 않습니다.");
    }
  };
  const { types, error: typeError, retry: retryTypes } = useEntityTypes();
  const selectedType = types?.find((type) => type.id === filter.entity_type_id),
    label = selectedType?.label ?? (filter.entity_type_id ? "찾을 수 없는 자료 종류" : "전체 자료");
  const [schema, setSchema] = useState<EntitySchemaResult | null>(null),
    [schemaReadError, setSchemaReadError] = useState(false),
    [schemaRetry, setSchemaRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setSchema(null);
    setSchemaReadError(false);
    if (filter.entity_type_id && selectedType) {
      void api<EntitySchemaResult>("GET", `/entity-types/${filter.entity_type_id}/schema`, undefined, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) {
            setSchema(value);
          }
        }).catch(() => {
          if (!controller.signal.aborted) setSchemaReadError(true);
        });
    }
    return () => controller.abort();
  }, [filter.entity_type_id, selectedType?.schema_version, schemaRetry]);
  const filterSummary: string[] = [];
  if (schema) {
    try {
      const parsed = entityListQuery.safeParse({
        entity_type_id: filter.entity_type_id,
        ...(filter.filters ? { filters: JSON.parse(filter.filters) } : {}),
        sort: filter.sort.startsWith("{") ? JSON.parse(filter.sort) : filter.sort,
      });
      if (parsed.success) {
        const comparison = {
          eq: "",
          contains: " 포함",
          gt: " 초과",
          gte: " 이상",
          lt: " 미만",
          lte: " 이하",
          unset: "",
        };
        for (const condition of parsed.data.filters ?? []) {
          const field = schema.schema.properties[condition.key];
          if (field) {
            filterSummary.push(
              `${field.title ?? condition.key}${comparison[condition.operator]}: ${
                condition.operator === "unset"
                  ? "미지정"
                  : displayedProperty(field, condition.value, schemaPresentation(schema).option_labels[condition.key])
              }`,
            );
          }
        }
        if (typeof parsed.data.sort === "object") {
          const field = schema.schema.properties[parsed.data.sort.key];
          if (field) {
            filterSummary.push(
              `${field.title ?? parsed.data.sort.key}: ${
                parsed.data.sort.direction === "asc" ? "오름차순" : "내림차순"
              }`,
            );
          }
        } else if (parsed.data.sort === "title") filterSummary.push("이름순");
      }
    } catch { /* The list and condition editor report invalid input. */ }
  }
  const selectedTag = dictionary.tags?.find((tag) => tag.id === filter.tag_id);
  if (selectedTag) filterSummary.push(`태그: ${selectedTag.name}`);
  const schemaReady = !filter.entity_type_id || schema?.type_id === filter.entity_type_id;
  const invalidType = !!filter.entity_type_id && types !== null && !selectedType;
  const unsupported = ["prop3_from", "prop3_to", "prop4"].some((key) => params.has(key));
  const key = query(filter),
    context = `${key}|${hash}|${urlFilters.error ?? ""}|${unsupported}|${schema?.schema_version ?? 0}`;
  const hasConditions = !!(filter.keyword || filter.tag_id || filter.filters || filter.sort !== "updated_at");
  const creating = create.open;
  const list = usePagedList<EntitySummary, ListPage<EntitySummary>>({
    scope: `${context}|${
      typeError
        ? "catalog_error"
        : types === null
        ? "catalog_loading"
        : invalidType
        ? "invalid"
        : !schemaReady
        ? "schema_loading"
        : "ready"
    }`,
    pages,
    anchor: anchorId("entities", urlFilters.anchor),
    anchorLookahead: 1,
    restoreRetry: "resume",
    retainOnDecrease: true,
    load: (cursor, signal) =>
      urlFilters.error
        ? Promise.reject(new ApiError(400, "invalid_input", urlFilters.error))
        : invalidType
        ? Promise.reject(
          new ApiError(404, "not_found", "자료 종류를 찾을 수 없습니다. 전체 자료나 다른 종류를 선택하세요."),
        )
        : typeError || types === null
        ? Promise.reject(new Error(typeError ? "자료 종류를 불러오지 못했습니다." : "자료 종류를 확인하는 중…"))
        : !schemaReady
        ? Promise.reject(new Error(schemaReadError ? "속성 정의를 읽지 못했습니다." : "속성 정의를 확인하는 중…"))
        : unsupported
        ? Promise.reject(
          new ApiError(400, "invalid_input", "이전 속성 조건은 더 이상 지원하지 않습니다. 조건을 초기화하세요."),
        )
        : api("GET", `/entities${query({ ...filter, cursor })}`, undefined, signal),
  });
  const { page, busy } = list;
  const pageSchemaVersion = page?.items[0]?.current_schema_version;
  useEffect(() => {
    if (!filter.entity_type_id || !pageSchemaVersion || schema?.schema_version === pageSchemaVersion) return;
    const controller = new AbortController();
    void api<EntitySchemaResult>(
      "GET",
      `/entity-types/${filter.entity_type_id}/schema?schema_version=${pageSchemaVersion}`,
      undefined,
      controller.signal,
    ).then((value) => {
      if (!controller.signal.aborted) setSchema(value);
    }).catch(() => {
      if (!controller.signal.aborted) setSchemaReadError(true);
    });
    return () => controller.abort();
  }, [filter.entity_type_id, pageSchemaVersion, schema?.schema_version]);
  const displaySchema =
    schema && (!page || page.items.every((row) => row.current_schema_version === schema.schema_version))
      ? schema
      : null;
  const error = types === null || !invalidType && !typeError && !schemaReady && !schemaReadError
    ? null
    : list.error
    ? list.error instanceof ApiError ? list.error.message : "자료를 불러오지 못했습니다."
    : null;
  const pageControl = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const control = pageControl.current;
    if (!error || !control || document.activeElement !== control) return;
    const bounds = scrollOwner(control)?.getBoundingClientRect();
    const rect = control.getBoundingClientRect();
    if (rect.top < (bounds?.top ?? 0) || rect.bottom > (bounds?.bottom ?? window.innerHeight)) {
      control.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [error]);
  const readiness = useRestoreListPosition(
    "entities",
    (dictionary.tags !== null || dictionary.failed) && !busy && !!page,
  );
  const set = (name: string, value: string) => {
    const next = name === "entity_type_id" ? typeListSearch(params, value) : new URLSearchParams(params);
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
    navigate({
      pathname: "/entities",
      ...(name === "entity_type_id" ? writeEntityListUrl(next, null) : changeEntityListQuery(next, params, hash)),
    }, { replace: name !== "entity_type_id" });
  };
  return (
    <>
      <section className="flex min-w-0 flex-col gap-5 border-b pb-6" aria-labelledby="entities-title">
        <PageHeading
          title={label}
          id="entities-title"
          tabIndex={-1}
          description="자료를 등록하고, 속성과 연결된 할 일·기록을 관리합니다."
        />
        <div className="@container flex min-w-0 flex-col gap-3">
          <EntityTypePicker
            types={types ?? []}
            value={filter.entity_type_id ?? ""}
            all
            compact
            disabled={types === null}
            catalogState={types === null ? typeError ? "unavailable" : "loading" : "ready"}
            onChange={(value) => set("entity_type_id", value)}
          />
          {!types && !typeError && <p role="status">자료 종류를 확인하는 중…</p>}
          {typeError && (
            <>
              <Notice kind="error">자료 종류를 불러오지 못했습니다.</Notice>
              <Button variant="outline" onClick={retryTypes}>종류 다시 시도</Button>
            </>
          )}
          {schemaReadError && (
            <Notice kind="error">
              속성 정의를 읽지 못했습니다.{" "}
              <Button variant="outline" type="button" onClick={() => setSchemaRetry((value) => value + 1)}>
                속성 정의 다시 시도
              </Button>
            </Notice>
          )}
          {selectedType?.archived && (
            <Notice>보관된 자료 종류입니다. 기존 자료를 읽을 수 있으며 새 자료를 추가하려면 보관을 해제하세요.</Notice>
          )}
          {types?.length === 0 && <p className="text-sm text-muted-foreground">아직 자료 종류가 없습니다.</p>}
          {types && types.length > 0 && types.every((type) => type.archived) && (
            <p className="text-sm text-muted-foreground">모든 자료 종류가 보관되어 있습니다.</p>
          )}
          <div className="grid min-w-0 grid-cols-1 items-end gap-3 @min-[14rem]:grid-cols-[minmax(0,1fr)_auto]">
            <TabSearch entity inputRef={searchInput} />
            <TabFilters
              applyRef={filterApply}
              active={!!(filter.tag_id || filter.sort !== "updated_at" || filter.filters)}
              attention={dictionary.failed}
              summary={filterSummary}
              dirty={editing.dirty}
              onReset={resetFilters}
              onApply={applyFilters}
            >
              <div
                className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4"
                role="group"
                aria-label="자료 필터"
              >
                <TypedEntityFilters
                  schema={schema}
                  raw={editing.draft.get("property_filters")}
                  sort={editing.draft.get("sort") ?? "updated_at"}
                  onChange={(filters, sort) => {
                    editing.setDraft((previous) => {
                      const next = new URLSearchParams(previous);
                      filters ? next.set("property_filters", filters) : next.delete("property_filters");
                      sort !== "updated_at" ? next.set("sort", sort) : next.delete("sort");
                      return next;
                    });
                  }}
                />
              </div>
              <TagSelection
                label="자료 태그"
                tags={dictionary.tags}
                value={editing.draft.get("tag_id") ? [editing.draft.get("tag_id")!] : []}
                maxSelected={1}
                onChange={(ids) => editing.set("tag_id", ids[0] ?? "")}
                status={<TagDictionaryStatus dictionary={dictionary} />}
              />
              {filterError && <Notice kind="error">{filterError}</Notice>}
            </TabFilters>
          </div>
        </div>
      </section>
      <ListExpansionProvider readiness={readiness}>
        <section className="flex min-w-0 flex-col gap-6" aria-label={`${label} 목록`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CollectionHeading
              hideLabel
              label={label}
              count={page?.items.length}
              hasMore={!!page?.next_cursor}
              view={view}
              onChange={changeView}
            />
            {!invalidType && !selectedType?.archived && types?.some((type) => !type.archived)
              ? <TabCreateButton label={`${selectedType?.label ?? "자료"} 추가`} onClick={create.begin} />
              : types && !typeError && !invalidType && (
                <Button asChild variant="ghost">
                  <Link
                    className=""
                    to={selectedType?.archived
                      ? `/settings/entity-types/${selectedType.id}`
                      : types.length
                      ? "/settings/materials"
                      : "/settings/entity-types"}
                  >
                    <>
                      {types.length ? <EyeIcon data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
                      {selectedType?.archived ? "종류 설정" : types.length ? "보관된 종류 관리" : "자료 종류 추가"}
                    </>
                  </Link>
                </Button>
              )}
          </div>
          {error && (
            <>
              <Notice kind="error">{error}</Notice>
              {unsupported && (
                <Button
                  variant="outline"
                  onClick={() => {
                    resetFilters();
                    setFocusRecoveryApply(true);
                    const next = new URLSearchParams(params);
                    next.set("filters", "1");
                    navigate({ pathname: "/entities", search: next.toString(), hash }, {
                      replace: true,
                      preventScrollReset: true,
                    });
                  }}
                >
                  조건 초기화
                </Button>
              )}
              {!page &&
                (
                  <Button variant="outline" onClick={() => void list.retry()}>
                    다시 시도
                  </Button>
                )}
            </>
          )}
          {!page && (busy || types === null && !typeError) && (
            <p role="status" className="text-sm text-muted-foreground">불러오는 중…</p>
          )}
          {page?.items.length === 0 && !error && (
            <>
              <p className="text-sm text-muted-foreground">
                {hasConditions ? "조건에 맞는 자료가 없습니다." : "아직 자료가 없습니다."}
              </p>
              {!hasConditions && <GuideLink />}
              {hasConditions && (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    const next = resetTabFilters(params);
                    next.delete("keyword");
                    navigate(`/entities?${next}`, { replace: true });
                    searchInput.current?.focus();
                  }}
                >
                  <RotateCcwIcon data-icon="inline-start" />
                  검색 조건 해제
                </Button>
              )}
            </>
          )}
          <TagReadProvider
            dictionary={dictionary}
            enabled={!!page?.items.some((e) => (e as EntitySummary & { tag_ids?: string[] }).tag_ids?.length)}
          >
            <CollectionList
              view={view === "calendar" ? "list" : view}
              label={`${label} 목록`}
              numericColumns={displaySchema
                ? schemaPresentation(displaySchema).list_columns.filter((key) =>
                  key !== schemaPresentation(displaySchema).representative
                )
                  .flatMap((key, index) =>
                    ["integer", "number"].includes(fieldType(displaySchema.schema.properties[key]) ?? "")
                      ? [index + 1]
                      : []
                  )
                : []}
              columns={displaySchema
                ? [
                  displaySchema.schema.properties[schemaPresentation(displaySchema).representative].title ??
                    "자료 이름",
                  ...schemaPresentation(displaySchema).list_columns.filter((key) =>
                    key !== schemaPresentation(displaySchema).representative
                  )
                    .map((key) => displaySchema.schema.properties[key].title ?? key),
                ]
                : ["자료 이름", "자료 종류"]}
            >
              {page?.items.map((e) => (
                <CollectionItem className="min-w-0" key={e.id}>
                  <ListPreviewItem
                    kind="entities"
                    id={e.id}
                    title={e.title}
                    cells={displaySchema
                      ? schemaPresentation(displaySchema).list_columns.filter((key) =>
                        key !== schemaPresentation(displaySchema).representative
                      ).map(
                        (key) =>
                          displayedProperty(
                            displaySchema.schema.properties[key],
                            e.display_properties[key],
                            schemaPresentation(displaySchema).option_labels[key],
                          ),
                      )
                      : [
                        <span key="type">
                          <EntityTypeIcon id={e.type.icon_id} /> {e.type.label}
                        </span>,
                      ]}
                  />
                </CollectionItem>
              ))}
            </CollectionList>
          </TagReadProvider>
          {page && (page.next_cursor || page.pages > 1) && (
            <Button
              ref={pageControl}
              variant="ghost"
              type="button"
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
            </Button>
          )}
          {creating && !invalidType && !selectedType?.archived && (
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
                const saved = writeEntityListUrl(p, urlFilters.raw, urlFilters.anchor);
                create.finish(detailListLink(entityPath(e.id), `/entities?${saved.search}${saved.hash}`));
              }}
            />
          )}
        </section>
      </ListExpansionProvider>
    </>
  );
}
