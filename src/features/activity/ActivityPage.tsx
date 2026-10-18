import { Badge } from "@/components/ui/badge";
import { useTaskAccess } from "./task-access.ts";
import { NativeSelect } from "@/components/ui/native-select";
import { NativeSelectOption } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Button } from "../../components/ui/button.tsx";
import { RotateCcwIcon } from "lucide-react";
import { PageHeading } from "../../components/PageHeading.tsx";

import {
  CollectionHeading,
  CollectionItem,
  CollectionList,
  useMainCollectionView,
} from "../../components/Collection.tsx";
import { deferView } from "../../components/DeferredView.tsx";
import { StatusBadge } from "./shared.tsx";
import { recordDisplayText } from "@contracts/record-display.ts";
import { SearchMatch } from "../../components/SearchMatch.tsx";
import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "../../lib/workspace-router.tsx";
import type { SearchItem } from "@contracts/search.ts";
import type { TaskResult } from "@contracts/task.ts";
import { taskLabels } from "@contracts/task.ts";
import { TabCreateButton } from "../../components/TabCreateButton.tsx";
import {
  applyFilterParams,
  clearListPosition,
  pickFilterParams,
  resetTabFilters,
  TabFilters,
  TabSearch,
  useFilterDraft,
} from "../../components/TabSearch.tsx";
import { Field, Notice } from "../../components/Field.tsx";
import { useCreateMode } from "../../components/useCreateMode.ts";

import { useDisplayTime } from "../../lib/useDisplayTime.ts";
import { TagSelection } from "../tags/TagSelection.tsx";
import { TagDictionaryStatus, TagReadProvider, useTagDictionary } from "../tags/TagPicker.tsx";
import { recordKindNames } from "./ChangeContext.tsx";
import { emptyTask, TaskFormModal } from "./forms.tsx";
import { type ActivityItem, useActivityList } from "./useActivityList.ts";
import { Timeline } from "./Timeline.tsx";
import { ACTIVITY_TAG_LIMIT, activityTags, periodBounds } from "./activity-filters.ts";
import { activityLocation, type WorkspaceListKind } from "./activity-location.ts";
import { EntityScope } from "../entity/EntityScope.tsx";
import { ListExpansionProvider, ListPreviewItem } from "../relations/ListPreviewItem.tsx";

type CalendarProps = Parameters<typeof import("./RecordCalendar.tsx").RecordCalendar<ActivityItem>>[0];
const RecordCalendar = deferView<CalendarProps>(
  () => import("./RecordCalendar.tsx").then(module => ({ default: module.RecordCalendar })),
  "기록 달력",
);

function ActivitySection(
  { kind, tags, bounds, dictionary, onCreate, onClear }: {
    onClear: () => void;
    onCreate: () => void;
    kind: WorkspaceListKind;
    tags: string[];
    bounds: NonNullable<ReturnType<typeof periodBounds>>;
    dictionary: ReturnType<typeof useTagDictionary>;
  },
) {
  const { canWrite } = useTaskAccess();
  const [view, changeView] = useMainCollectionView(kind === "records");
  const { formatDateTime, timezone } = useDisplayTime();
  const list = useActivityList(kind, { tags, bounds, layoutReady: !!dictionary.tags || dictionary.failed });
  const { metadata, searching: q, filtered } = list;
  const displayText = (item: ActivityItem) =>
    kind === "records" && "body" in item ? recordDisplayText(item.body) : "title" in item ? item.title : "기록";
  const preview = (item: ActivityItem) => {
    const time = "occurred_at" in item ? item.occurred_at : (item as SearchItem).at;
    const cells = kind === "tasks"
      ? [
        "status" in item ? "deleted_at" in item && item.deleted_at ? <Badge variant="secondary">삭제됨</Badge> : <StatusBadge status={item.status} /> : null,
        "status" in item ? taskLabels[item.kind as TaskResult["kind"]] : null,
        "due_on" in item ? item.due_on : null,
      ]
      : [
        "record_kind" in item && item.record_kind ? recordKindNames[item.record_kind as keyof typeof recordKindNames] : null,
        <time dateTime={time} title={formatDateTime(time)}>
          {new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeZone: timezone }).format(new Date(time))}
        </time>,
      ];
    return (
      <ListPreviewItem
        kind={kind}
        id={item.id}
        title={displayText(item)}
        cells={cells}
        metadata={"match" in item ? <SearchMatch item={item} /> : undefined}
      />
    );
  };
  return (
    <ListExpansionProvider readiness={list.readiness}>
      <section
        className="@container flex min-w-0 flex-col gap-4"
        aria-label={`${kind === "tasks" ? "할 일" : "기록"} 목록`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CollectionHeading
            hideLabel
            label={kind === "tasks" ? "할 일" : "기록"}
            count={list.items?.length}
            hasMore={!!list.cursor}
            view={view}
            onChange={changeView}
            calendar={kind === "records"}
          />
          {kind === "tasks" && canWrite && <TabCreateButton label="할 일 등록" onClick={onCreate} />}
        </div>
        {q && (
          <p className="text-sm text-muted-foreground">
            {list.semanticSearching ? "관련도순으로 회수한 검색 결과" : "키워드 검색 결과"}{kind === "records" ? "를 날짜별로 표시합니다." : "입니다."}
          </p>
        )}
        {metadata?.search_state === "keyword_fallback" && (
          <Notice>의미 검색을 사용할 수 없어 키워드 검색 결과를 표시합니다.</Notice>
        )}
        {metadata && metadata.semantic_coverage.pending + metadata.semantic_coverage.excluded > 0 && (
          <p className="text-sm text-muted-foreground">
            의미 색인 대기 {metadata.semantic_coverage.pending}개 · 제외 {metadata.semantic_coverage.excluded}개
          </p>
        )}
        {list.busy && !list.items && <p role="status" className="text-sm text-muted-foreground">불러오는 중…</p>}
        {list.items?.length === 0 && !list.error && (
          <>
            <p className="text-sm text-muted-foreground">
              {filtered
                ? `조건에 맞는 ${kind === "tasks" ? "할 일" : "기록"}이 없습니다.`
                : `아직 ${kind === "tasks" ? "할 일" : "기록"}이 없습니다.`}
            </p>
            {filtered && (
              <Button variant="ghost" type="button" onClick={onClear}>
                <RotateCcwIcon data-icon="inline-start" />검색 조건 해제
              </Button>
            )}
          </>
        )}
        {list.items && (
          <TagReadProvider
            dictionary={dictionary}
            enabled={list.items.some((item) => item.tag_ids.length > 0)}
          >
            {kind === "tasks"
              ? (
                <CollectionList
                  view={view === "calendar" ? "table" : view}
                  label="할 일 목록"
                  columns={["제목", "상태", "종류", "기한"]}
                  numericColumns={[3]}
                >
                  {list.items.map((item) => <CollectionItem key={item.id}>{preview(item)}</CollectionItem>)}
                </CollectionList>
              )
              : view === "calendar"
              ? (
                <RecordCalendar
                  items={list.items}
                  at={(item) => "occurred_at" in item ? item.occurred_at : (item as SearchItem).at}
                  partial={!!list.cursor}
                >
                  {(item) => preview(item)}
                </RecordCalendar>
              )
              : (
                <Timeline
                  items={list.items}
                  kind="기록"
                  view={view}
                  at={(item) => "occurred_at" in item ? item.occurred_at : (item as SearchItem).at}
                >
                  {(item) => preview(item)}
                </Timeline>
              )}
          </TagReadProvider>
        )}
        {list.error && <Notice kind="error">{list.error}</Notice>}
        {list.showMoreControl && (
          <Button
            variant="ghost"
            type="button"
            id={`activity-${kind}-page-control`}
            aria-disabled={list.busy || !list.cursor && !list.error}
            onClick={list.error ? list.retry : list.more}
          >
            {list.busy
              ? "불러오는 중…"
              : list.error
              ? "다시 시도"
              : list.cursor
              ? `${kind === "tasks" ? "할 일" : "기록"} 더 보기`
              : "모두 불러왔습니다"}
          </Button>
        )}
      </section>
    </ListExpansionProvider>
  );
}

export function ActivityPage({ kind }: { kind: WorkspaceListKind }) {
  const searchInput = useRef<HTMLInputElement>(null);
  const { timezone } = useDisplayTime();
  const [params, setParams] = useSearchParams(),
    location = useLocation(),
    { pathname } = location,
    dictionary = useTagDictionary(true, true, kind === "tasks" ? "task" : "record");
  const navigate = useNavigate();
  const label = kind === "tasks" ? "할 일" : "기록";
  const legacy = activityLocation(kind, params, location.hash);
  const allTags = activityTags(params),
    tags = allTags.slice(0, ACTIVITY_TAG_LIMIT),
    from = params.get("from") ?? "",
    to = params.get("to") ?? "";
  const [trimmedTags, setTrimmedTags] = useState(false);
  const checked = periodBounds(from, to, timezone), prior = useRef({ from: "", to: "" });
  if (checked) prior.current = { from, to };
  const bounds = checked ?? periodBounds(prior.current.from, prior.current.to, timezone)!;
  useEffect(() => {
    const overLimit = allTags.length > ACTIVITY_TAG_LIMIT;
    if (!allTags.length) setTrimmedTags(false);
    if (!overLimit) return;
    const next = new URLSearchParams(params);
    if (overLimit) {
      setTrimmedTags(true);
      next.delete("tag_id");
      next.set("tag_ids", tags.join(","));
      clearListPosition(next);
    }
    setParams(next, { replace: true });
  }, [params, setParams]);
  const create = useCreateMode("1");
  const begin = () => {
    const next = new URLSearchParams(params);
    next.set("create", "1");
    setParams(next);
  };
  const filterKeys = ["tag_id", "tag_ids", "entity_id", "kind", "status", "deleted", "record_kind", "from", "to"];
  const editing = useFilterDraft(pickFilterParams(params, filterKeys), kind);
  const draftTags = activityTags(editing.draft).slice(0, ACTIVITY_TAG_LIMIT);
  const [filterError, setFilterError] = useState("");
  const filter = editing.set;
  const setDate = editing.set;
  const applyFilters = () => {
    if (!periodBounds(editing.draft.get("from") ?? "", editing.draft.get("to") ?? "", timezone)) {
      setFilterError("기록 시작일은 종료일보다 늦을 수 없습니다. 이전 유효 기간의 기록을 유지합니다.");
      return;
    }
    setFilterError("");
    editing.commit(editing.draft);
    setParams(applyFilterParams(params, editing.draft, filterKeys), { replace: true });
  };
  const saved = (kind: string, id: string) => {
    const next = new URLSearchParams(params);
    next.delete("create");
    create.finish(`/${kind}s/${id}?list=${encodeURIComponent(`${pathname}?${next}`)}`);
  };
  if (legacy.route !== pathname || legacy.params.toString() !== params.toString()) {
    return <Navigate replace to={`${legacy.route}?${legacy.params}${legacy.hash}`} />;
  }
  return (
    <>
      <section className="@container flex min-w-0 flex-col gap-5" aria-labelledby={`${kind}-title`}>
        <PageHeading
          title={label}
          id={`${kind}-title`}
          tabIndex={-1}
          description={kind === "tasks"
            ? "할 일을 정리하고, 반복 일정과 수행 결과를 관리합니다."
            : "할 일 수행 결과와 업무 변경 내역을 모아 봅니다. 메모와 참고 내용은 자료로 등록하세요."}
        />
        <div className="flex min-w-0 flex-col gap-4">
          {params.has("legacy_activity") && (
            <Notice>
              목록을 나누어 {label} 탭으로 이동했습니다. {kind === "tasks"
                ? "기록과 기록 기간은 기록 탭에서 확인하세요."
                : "할 일과 진행 상태는 할 일 탭에서 확인하세요."}
            </Notice>
          )}
          <div className="grid min-w-0 grid-cols-1 items-end gap-3 @min-[14rem]:grid-cols-[minmax(0,1fr)_auto]">
            <TabSearch inputRef={searchInput} />
            <TabFilters
              dirty={editing.dirty}
              onReset={() => {
                editing.reset();
                setFilterError("");
              }}
              onApply={applyFilters}
              active={!!(tags.length || params.get("entity_id") || params.get("kind") || params.get("status") ||
                params.get("record_kind") || params.get("deleted") || from || to)}
              attention={!checked || dictionary.failed || trimmedTags}
              summary={[
                ...tags.map((id) => `태그: ${dictionary.tags?.find((tag) => tag.id === id)?.name ?? "선택됨"}`),
                params.get("entity_id") ? "선택한 자료" : "",
                params.get("kind") ? `종류: ${params.get("kind") === "once" ? "한 번" : "반복"}` : "",
                params.get("status")
                  ? `상태: ${taskLabels[params.get("status") as keyof typeof taskLabels] ?? params.get("status")}`
                  : "",
                params.get("deleted") ? `삭제 상태: ${params.get("deleted") === "only" ? "삭제된 할 일만" : "삭제된 할 일 포함"}` : "",
                params.get("record_kind")
                  ? `종류: ${
                    recordKindNames[params.get("record_kind") as keyof typeof recordKindNames] ??
                      params.get("record_kind")
                  }`
                  : "",
                from ? `시작: ${from}` : "",
                to ? `종료: ${to}` : "",
              ].filter(Boolean)}
            >
              {editing.draft.get("entity_id") && (
                <EntityScope
                  key={editing.draft.get("entity_id")}
                  id={editing.draft.get("entity_id")!}
                  onClear={() => editing.set("entity_id", "")}
                />
              )}
              <div className="grid min-w-0 gap-4 @min-[32rem]:grid-cols-2">
                {kind === "tasks"
                  ? (
                    <>
                      <Field label="할 일 종류">
                        {(props) => (
                          <NativeSelect
                            {...props}
                            value={editing.draft.get("kind") ?? ""}
                            onChange={(event) => filter("kind", event.target.value)}
                          >
                            <NativeSelectOption value="">전체</NativeSelectOption>
                            <NativeSelectOption value="once">한 번</NativeSelectOption>
                            <NativeSelectOption value="recurring">반복</NativeSelectOption>
                          </NativeSelect>
                        )}
                      </Field>
                      <Field label="할 일 상태">
                        {(props) => (
                          <NativeSelect
                            {...props}
                            value={editing.draft.get("status") ?? ""}
                            onChange={(event) => filter("status", event.target.value)}
                          >
                            <NativeSelectOption value="">전체</NativeSelectOption>
                            {["open", "done", "active", "stopped"].map((status) => (
                              <NativeSelectOption key={status} value={status}>
                                {taskLabels[status as keyof typeof taskLabels] as string}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        )}
                      </Field>
                      <Field label="삭제 상태">
                        {(props) => (
                          <NativeSelect {...props} value={editing.draft.get("deleted") ?? ""} onChange={event => filter("deleted", event.target.value)}>
                            <NativeSelectOption value="">삭제되지 않은 할 일</NativeSelectOption>
                            <NativeSelectOption value="include">삭제된 할 일 포함</NativeSelectOption>
                            <NativeSelectOption value="only">삭제된 할 일만</NativeSelectOption>
                          </NativeSelect>
                        )}
                      </Field>
                    </>
                  )
                  : (
                    <Field label="기록 종류">
                      {(props) => (
                        <NativeSelect
                          {...props}
                          value={editing.draft.get("record_kind") ?? ""}
                          onChange={(event) => filter("record_kind", event.target.value)}
                        >
                          <NativeSelectOption value="">전체</NativeSelectOption>
                          {Object.entries(recordKindNames).map(([value, text]) => (
                            <NativeSelectOption key={value} value={value}>{text}</NativeSelectOption>
                          ))}
                        </NativeSelect>
                      )}
                    </Field>
                  )}
                {kind === "records" && (
                  <>
                    {[["from", "기록 시작일", editing.draft.get("from") ?? ""], [
                      "to",
                      "기록 종료일",
                      editing.draft.get("to") ?? "",
                    ]].map(([name, label, value]) => (
                      <Field key={name} label={label}>
                        {(props) => (
                          <Input
                            {...props}
                            type="date"
                            value={value}
                            aria-invalid={!!filterError || undefined}
                            onChange={(event) => setDate(name, event.target.value)}
                          />
                        )}
                      </Field>
                    ))}
                  </>
                )}
              </div>
              {filterError && <Notice kind="error">{filterError}</Notice>}
              <TagSelection
                label={`${label} 태그`}
                tags={dictionary.tags}
                value={draftTags}
                maxSelected={ACTIVITY_TAG_LIMIT}
                status={<TagDictionaryStatus dictionary={dictionary} />}
                onChange={(ids) => {
                  editing.setDraft((previous) => {
                    const next = new URLSearchParams(previous);
                    next.delete("tag_id");
                    ids.length ? next.set("tag_ids", [...ids].sort().join(",")) : next.delete("tag_ids");
                    return next;
                  });
                }}
              />
              {trimmedTags && (
                <p className="text-sm text-muted-foreground" role="status">
                  태그는 최대 10개입니다. 기존 조건의 앞 10개만 적용했습니다.
                </p>
              )}
            </TabFilters>
          </div>
        </div>
      </section>
      <ActivitySection
        kind={kind}
        tags={tags}
        bounds={bounds}
        dictionary={dictionary}
        onCreate={begin}
        onClear={() => {
          const next = resetTabFilters(params);
          next.delete("q");
          next.delete("keyword");
          void navigate({ pathname, search: next.toString(), hash: "" }, { replace: true });
          searchInput.current?.focus();
        }}
      />
      {create.open && kind === "tasks" && (
          <TaskFormModal
            key={create.key}
            mode="create"
            open
            initial={emptyTask(timezone)}
            onClose={create.close}
            onRouteDiscard={create.discard}
            onSave={async (save) => {
              const task = await save();
              saved("task", task.id);
            }}
          />
        )}
    </>
  );
}
