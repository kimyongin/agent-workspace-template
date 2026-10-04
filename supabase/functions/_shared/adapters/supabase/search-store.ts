import type postgres from "postgres";
import type { SearchInput, SearchItem } from "../../contracts/search.ts";
import type { Actor } from "../../core/shared/actor.ts";
import type { SearchPosition, SearchRow, SearchStore } from "../../core/search/application.ts";
import { runAsActor } from "./sql-context.ts";
import { tagIdsColumn } from "./tag-links.ts";
import { SEARCH_PIPELINE } from "../../core/search/config.ts";
class SqlSearchStore implements SearchStore {
  constructor(private readonly tx: postgres.TransactionSql) {}
  sources() {
    const tx = this.tx;
    const originals =
      tx`select owner_id,'task'::text as kind,id,title,summary,body,updated_at as at,status,entity_id,kind as task_kind,null::text as record_kind,null::boolean as is_current,${
        tagIdsColumn(tx, "task")
      } from app.tasks
      union all select owner_id,'record',id,title,summary,body,occurred_at,null::text,entity_id,null::text,record_kind,null::boolean,${
        tagIdsColumn(tx, "record")
      } from app.records
      union all select owner_id,'principle',id,title,summary,body,saved_at,status,null::uuid,null::text,null::text,is_current,'[]'::jsonb from app.principles`;
    return tx`select s.*,i.embedding,case
      when s.summary is null or btrim(s.summary)='' then 'excluded'
      when i.input_hash=encode(extensions.digest(s.title||E'\n'||s.summary,'sha256'),'hex') and i.pipeline=${SEARCH_PIPELINE}
        and (i.state='excluded' or (i.state='indexed' and i.embedding is not null)) then i.state else 'pending' end as index_state
      from (${originals}) s left join app.search_index_state i on (i.owner_id,i.kind,i.id)=(s.owner_id,s.kind,s.id)`;
  }
  filters(q: SearchInput) {
    const tx = this.tx;
    const view = q.principle_view;
    return tx`kind in ${tx(q.kinds)}
      ${
      view === "current"
        ? tx`and (kind<>'principle' or is_current)`
        : view === "history"
        ? tx`and (kind<>'principle' or not is_current)`
        : tx``
    }
      ${q.task_kind ? tx`and (kind<>'task' or task_kind=${q.task_kind})` : tx``}
      ${q.task_status ? tx`and (kind<>'task' or status=${q.task_status})` : tx``}
      ${q.record_kind ? tx`and (kind<>'record' or record_kind=${q.record_kind})` : tx``}
      ${q.tag_id ? tx`and tag_ids ? ${q.tag_id}` : tx``}
      ${q.entity_id ? tx`and entity_id=${q.entity_id}::uuid` : tx``}
      ${q.from ? tx`and at>=${q.from}::timestamptz` : tx``} ${q.to ? tx`and at<=${q.to}::timestamptz` : tx``}`;
  }
  async coverage(q: SearchInput) {
    const tx = this.tx;
    const [r] = await tx`with sources as (${this.sources()}) select
      count(*) filter(where index_state='pending')::int as pending,
      count(*) filter(where index_state='excluded')::int as excluded from sources where ${this.filters(q)}`;
    return { pending: r.pending as number, excluded: r.excluded as number };
  }
  matches(q: SearchInput) {
    return this.tx`strpos(lower(title||E'\n'||coalesce(summary,'')||E'\n'||body),lower(${q.query}))>0`;
  }
  ranked(q: SearchInput, vector: number[] | undefined) {
    const tx = this.tx;
    const score = vector
      ? tx`case when index_state='indexed' then greatest(0::float8,least(1::float8,1-(embedding operator(extensions.<=>) ${
        JSON.stringify(vector)
      }::extensions.vector))) else 0::float8 end`
      : tx`0::float8`;
    return tx`with sources as (${this.sources()}),scored as (
      select *,${this.matches(q)} as keyword_match,${score} as score from sources where ${this.filters(q)})
      select *,case when keyword_match then 1::float8 else 0::float8 end + case when score>=0.27 then score else 0::float8 end as rank,
      case when keyword_match and score>=0.27 then 'both' when keyword_match then 'keyword' else 'semantic' end as match
      from scored where keyword_match or score>=0.27`;
  }
  async reserveEmbedding() {
    const [r] = await this.tx`select app.reserve_search_embedding() as allowed`;
    return r.allowed as boolean;
  }
  async anchorPage(q: SearchInput, vector: number[] | undefined) {
    if (!q.anchor) return null;
    const tx = this.tx;
    const [r] = await tx`with candidates as (${this.ranked(q, vector)}), ranked as (
      select kind,id,row_number() over(order by rank desc,at desc,kind desc,id desc) as position
      from candidates)
      select ceil(position::numeric/${q.limit})::int as page from ranked where kind=${q.anchor.kind} and id=${q.anchor.id}`;
    return r ? r.page as number : null;
  }
  async candidates(q: SearchInput, vector: number[] | undefined, after?: SearchPosition): Promise<SearchRow[]> {
    const tx = this.tx;
    const rows = await tx`with candidates as (${
      this.ranked(q, vector)
    }) select kind,id,title,summary,at,tag_ids,index_state,match,rank from candidates
      ${
      after
        ? tx`where (rank,at,kind,id)<(${after.rank}::float8,${after.at}::timestamptz,${after.kind}::text,${after.id}::uuid)`
        : tx``
    }
      order by rank desc,at desc,kind desc,id desc limit ${q.limit + 1}`;
    return rows.map((r) => ({
      kind: r.kind as SearchItem["kind"],
      id: r.id as string,
      title: r.title as string,
      summary: (r.summary ?? "") as string,
      at: (r.at as Date).toISOString(),
      tag_ids: r.tag_ids as string[],
      match: r.match as SearchItem["match"],
      rank: r.rank as number,
      index_state: r.index_state as SearchItem["index_state"],
      path: `/${r.kind}s/${r.id}`,
    }));
  }
}
export class SqlSearchUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}
  run<T>(a: Actor, fn: (s: SearchStore) => Promise<T>): Promise<T> {
    return runAsActor(this.sql, a, (tx) => fn(new SqlSearchStore(tx)));
  }
}
