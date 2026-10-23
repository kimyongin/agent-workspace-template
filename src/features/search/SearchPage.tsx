import { BusinessCell, BusinessDisclosureCell, BusinessRow, BusinessTable } from "../../components/BusinessTable.tsx";
import { CollectionEmpty } from "../../components/CollectionEmpty.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { FieldGroup } from "../../components/ui/field.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Button } from "../../components/ui/button.tsx";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx";
import { applyFilterParams, pickFilterParams, TabFilters, useFilterDraft } from "../../components/TabSearch.tsx";
import { workspaceSearchScope } from "./search-scope.ts";
import { PageHeading } from "../../components/PageHeading.tsx";

import { DetailLink as Link, useDetailExploration } from "../../lib/detail-exploration.tsx";
import { SearchMatch } from "../../components/SearchMatch.tsx";
import { useEffect, useRef, useState } from "react";
import { Link as PageLink, useSearchParams } from "../../lib/workspace-router.tsx";
import { Field, Notice } from "../../components/Field.tsx";
import { useDisplayTime } from "../../lib/useDisplayTime.ts";
import { TagFilter, TagNames, TagReadProvider, useTagDictionary } from "../tags/TagPicker.tsx";
import { EntityPicker } from "../entity/EntityPicker.tsx";
import { useSearchRead } from "./useSearchRead.ts";
import { activityTags } from "../activity/activity-filters.ts";
const kinds = { entity: "자료", task: "할 일", record: "기록" } as const;
export function SearchPage() {
  const { formatDateTime } = useDisplayTime();
  useDetailExploration();
  const composing = useRef(false);
  const [params, setParams] = useSearchParams(), [draft, setDraft] = useState(params.get("q") ?? "");
  const [retry, setRetry] = useState(0);
  const q = params.get("q") ?? "";
  const { result, error, busy, more } = useSearchRead(params, retry);
  useEffect(() => setDraft(q), [q]);
  const filterKeys = [
    "kind",
    "mode",
    "tag_id",
    "tag_ids",
    "entity_id",
    "from",
    "to",
    "status",
    "principle_view",
    "record_kind",
    "task_kind",
    "task_status",
  ];
  const editing = useFilterDraft(pickFilterParams(params, filterKeys));
  const [filterError, setFilterError] = useState("");
  const selectedKind = editing.draft.get("kind");
  const selectedTag = editing.draft.get("tag_id") ?? "";
  const applyFilters = () => {
    const next = applyFilterParams(params, editing.draft, filterKeys);
    try {
      const validation = new URLSearchParams(next);
      if (!validation.get("q")) validation.set("q", "검사");
      workspaceSearchScope(validation);
      const from = next.get("from"), to = next.get("to");
      if (from && to && new Date(from) > new Date(to)) throw Error();
      editing.commit(editing.draft);
      setFilterError("");
      setParams(next, { replace: true });
    } catch {
      setFilterError("검색 조건과 기간을 확인하세요. 시작은 끝보다 늦을 수 없습니다.");
    }
  };
  const changeFilter = (name: string, value: string) =>
    editing.setDraft((previous) => {
      const next = new URLSearchParams(previous);
      if (name === "kind") {
        next.delete("tag_id");
        next.delete("tag_ids");
      }
      value ? next.set(name, value) : next.delete(name);
      return next;
    });
  const entities = useTagDictionary(!selectedKind || selectedKind === "entity", false, "entity"),
    tasks = useTagDictionary(!selectedKind || selectedKind === "task", false, "task"),
    records = useTagDictionary(!selectedKind || selectedKind === "record", false, "record");
  const dictionary = selectedKind === "entity" ? entities : selectedKind === "task" ? tasks : selectedKind === "record" ? records : {
    scope: "mixed" as const,
    pending: entities.pending || tasks.pending || records.pending,
    tags: entities.tags && tasks.tags && records.tags
      ? [
        ...entities.tags.map((tag) => ({ ...tag, name: `자료: ${tag.name}` })),
        ...tasks.tags.map((tag) => ({ ...tag, name: `할 일: ${tag.name}` })),
        ...records.tags.map((tag) => ({ ...tag, name: `기록: ${tag.name}` })),
      ]
      : null,
    failed: entities.failed || tasks.failed || records.failed,
    retry: () => {
      entities.retry();
      tasks.retry();
      records.retry();
    },
  };
  const change = (name: string, value: string) => {
    const p = new URLSearchParams(params);
    p.delete("pages");
    p.delete("scroll");
    if (name === "kind") {
      p.delete("tag_id");
      p.delete("tag_ids");
    }
    value ? p.set(name, value) : p.delete(name);
    setParams(p);
  };
  const clearTags = () =>
    editing.setDraft((previous) => {
      const next = new URLSearchParams(previous);
      next.delete("tag_id");
      next.delete("tag_ids");
      return next;
    });
  return (
    <section data-page-ready={!busy && (!!result || !!error || !q) ? "" : undefined} className="@container flex min-w-0 flex-col gap-5" aria-labelledby="search-title">
      <PageHeading
        title="검색"
        id="search-title"
        tabIndex={-1}
        description="자료·기록은 키워드나 의미로, 할 일은 키워드로 찾아봅니다."
      />
      <div className="grid min-w-0 grid-cols-1 items-end gap-3 @min-[14rem]:grid-cols-[minmax(0,1fr)_auto]">
        <form
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (composing.current) return;
            const value = draft.trim();
            if (value === q) setRetry((n) => n + 1);
            else change("q", value);
          }}
        ><FieldGroup className="grid min-w-0 grid-cols-1 items-end gap-3 @min-[18rem]:grid-cols-[minmax(0,1fr)_auto]">
          <Field label="검색어" required>
            {(p) => (
              <Input
                {...p}

                placeholder="검색어 입력"
                value={draft}
                onCompositionStart={() => {
                  composing.current = true;
                }}
                onCompositionEnd={() => {
                  composing.current = false;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault();
                }}
                onChange={(e) => setDraft(e.target.value)}
                required
              />
            )}
          </Field>
          <Button variant="default"  type="submit" disabled={busy}>검색</Button>
        </FieldGroup></form>
        {(params.has("status") || params.has("principle_view")) && (
          <Notice kind="error">
            이 링크에는 지원하지 않는 검색 조건이 있습니다. 조건을 지운 뒤 자료·할 일·기록을 검색하세요.{" "}
            <Button variant="outline"
              type="button"

              onClick={() => {
                const next = new URLSearchParams(params);
                for (const key of ["status", "principle_view", "pages", "scroll"]) next.delete(key);
                setParams(next);
              }}
            >
              지원하지 않는 검색 조건 지우기
            </Button>
          </Notice>
        )}
        <TabFilters
          active={filterKeys.some((key) => params.has(key))}
          dirty={editing.dirty}
          onReset={() => {
            editing.reset();
            setFilterError("");
          }}
          onApply={applyFilters}
        >
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex min-w-0 flex-col gap-4">
              <Field label="검색 대상">
                {(p) => (
                  <NativeSelect
                    {...p}

                    value={editing.draft.get("kind") ?? ""}
                    onChange={(e) => changeFilter("kind", e.target.value)}
                  >
                    <NativeSelectOption value="">전체</NativeSelectOption>
                    {Object.entries(kinds).map(([k, v]) => <NativeSelectOption key={k} value={k}>{v}</NativeSelectOption>)}
                  </NativeSelect>
                )}
              </Field>
              <Field label="검색 방식">
                {(p) => (
                  <NativeSelect
                    {...p}

                    value={editing.draft.get("mode") ?? "auto"}
                    onChange={(e) => changeFilter("mode", e.target.value)}
                  >
                    <NativeSelectOption value="auto">자동</NativeSelectOption>
                    <NativeSelectOption value="keyword">키워드</NativeSelectOption>
                  </NativeSelect>
                )}
              </Field>
            </div>
            <p className="text-sm text-muted-foreground">
              자료는 종류에서 검색하도록 선택한 텍스트를, 기록은 당시 본문을 검색합니다. 결과 제목을 누르면 현재 권한으로 원문을 확인합니다.
            </p>
            {editing.draft.has("tag_ids") && (
              <FieldGroup className="flex min-w-0 flex-col gap-5">
                <TagReadProvider dictionary={dictionary}>
                  <TagNames scope={selectedKind === "entity" ? "entity" : selectedKind === "task" ? "task" : "record"} ids={activityTags(editing.draft)} />
                </TagReadProvider>
                <Button variant="outline" type="button"  onClick={clearTags}>저장된 태그 조건 해제</Button>
              </FieldGroup>
            )}
            {
              <TagFilter
                dictionary={dictionary}
                value={selectedTag}
                onChange={(id) => {
                  editing.setDraft((previous) => {
                    const next = new URLSearchParams(previous);
                    next.delete("tag_ids");
                    id ? next.set("tag_id", id) : next.delete("tag_id");
                    return next;
                  });
                }}
              />
            }
            <EntityPicker
              value={editing.draft.get("entity_id") ?? ""}
              onChange={(id) => changeFilter("entity_id", id ?? "")}
            />
            <div className="flex min-w-0 flex-col gap-4">
              {["from", "to"].map((name) => (
                <Field key={name} label={name === "from" ? "기간 시작" : "기간 끝"}>
                  {(p) => (
                    <Input
                      {...p}
                      type="datetime-local"

                      value={editing.draft.get(name) ?? ""}
                      onChange={(e) => changeFilter(name, e.target.value)}
                    />
                  )}
                </Field>
              ))}
            </div>
            {filterError && <Notice kind="error">{filterError}</Notice>}
          </div>
        </TabFilters>
      </div>
      {error && (
        <>
          <Notice kind="error">{error}</Notice>
          <Button variant="outline"  type="button" onClick={() => setRetry((n) => n + 1)}>다시 시도</Button>
        </>
      )}
      {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />검색 중…</p>}
      {result && (
        <>
          {result.search_state === "keyword_fallback" && (
            <Notice>현재 키워드 검색 결과를 표시합니다. 자료와 기록의 의미 검색을 사용할 수 없습니다.</Notice>
          )}
          {!!(result.semantic_coverage.pending + result.semantic_coverage.excluded) && (
            <p className="text-sm text-muted-foreground">
              의미 색인 대기 {result.semantic_coverage.pending}개 · 제외 {result.semantic_coverage.excluded}개
            </p>
          )}
          {!!result.semantic_coverage.failed && (
            <Notice>
              의미 색인 확인 필요 {result.semantic_coverage.failed}개 · <PageLink to="/status">상태에서 문제 확인</PageLink>
            </Notice>
          )}
          {!!result.semantic_coverage.pending && (
            <p className="text-sm text-muted-foreground">
              색인 대기 중인 자료와 기록은 의미 검색 결과에 빠질 수 있습니다.{" "}
              <PageLink to="/status">상태에서 오래 갱신되지 않은 대기 확인</PageLink>{" "}
              후에도 계속되면 관리자에게 색인 서비스 점검을 요청하세요. 처리 실패로 확정된 상태는 아닙니다.
            </p>
          )}
          {!result.items.length && <CollectionEmpty title="검색 결과가 없습니다." description="검색어나 필터를 바꿔 다시 검색하세요." />}
          {!!result.items.length && (<BusinessTable disclosureColumn={false} label="검색 결과" columns={["제목 / 본문 대표 문구", "종류", "시각", "일치 구간", "검색 상태"]}>
            {result.items.map((r) => (
              <BusinessRow key={`${r.kind}:${r.id}`}>
                <BusinessDisclosureCell />
                <BusinessCell index={0}>
                  <Button asChild variant="link" className="h-auto min-h-[max(2.75rem,44px)] max-w-full justify-start px-0 text-left whitespace-normal wrap-anywhere">
                    <Link data-list-anchor="" id={`search-${r.kind}-${r.id}`} to={r.path}>
                      <span className="wrap-anywhere">{r.title}</span>
                    </Link>
                  </Button>
                </BusinessCell>
                <BusinessCell index={1}>{kinds[r.kind]}</BusinessCell>
                <BusinessCell index={2}>{formatDateTime(r.at)}</BusinessCell>
                <BusinessCell index={3}>
                  <div className="flex min-w-0 flex-col gap-1">
                    {r.kind === "entity" && r.source_fields?.some((field) => field.start < r.snippet_end && field.end > r.snippet_start) && (
                      <span className="text-sm text-muted-foreground">
                        {r.source_fields.filter((field) => field.start < r.snippet_end && field.end > r.snippet_start).map((field) => field.label).join(" · ")}
                      </span>
                    )}
                    <span className="whitespace-pre-wrap wrap-anywhere">{r.snippet !== r.title ? r.snippet : "—"}</span>
                  </div>
                </BusinessCell>
                <BusinessCell index={4}><SearchMatch item={r} /></BusinessCell>
              </BusinessRow>
            ))}
          </BusinessTable>)}
          {result.next_cursor && <Button variant="ghost" type="button" disabled={busy} onClick={() => more?.()}>더 보기</Button>}
        </>
      )}
    </section>
  );
}
