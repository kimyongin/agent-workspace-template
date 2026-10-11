import type postgres from "postgres";
import type { SearchInput, SearchItem } from "../../contracts/search.ts";
import { recordDisplayText } from "../../contracts/record-display.ts";
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
      tx`select owner_id,'task'::text as kind,id,title,body,updated_at as at,status,entity_ids,kind as task_kind,null::text as record_kind,null::boolean as is_current,${
        tagIdsColumn(tx, "task")
      } from app.tasks
      union all select owner_id,'record',id,body,body,occurred_at,null::text,entity_ids,null::text,record_kind,null::boolean,${
        tagIdsColumn(tx, "record")
      } from app.records
      union all select owner_id,'principle',id,title,body,saved_at,null::text,'{}'::text[],null::text,null::text,is_current,'[]'::jsonb from app.principles where is_current`;
    return tx`select s.*,i.generation,case
      when s.kind<>'record' then 'excluded'
      when i.input_hash=encode(extensions.digest(s.body,'sha256'),'hex') and i.pipeline=${SEARCH_PIPELINE}
        and (i.state='excluded' or (i.state='indexed' and exists(select 1 from app.search_chunks c
          where c.owner_id=s.owner_id and c.record_id=s.id and c.generation=i.generation))) then i.state else 'pending' end as index_state
      from (${originals}) s left join app.search_index_state i on (i.owner_id,i.kind,i.id)=(s.owner_id,s.kind,s.id)`;
  }
  filters(q: SearchInput) {
    const tx = this.tx;
    return tx`kind in ${tx(q.kinds)}
      and (kind<>'principle' or is_current)
      ${q.task_kind ? tx`and (kind<>'task' or task_kind=${q.task_kind})` : tx``}
      ${q.task_status ? tx`and (kind<>'task' or status=${q.task_status})` : tx``}
      ${q.record_kind ? tx`and (kind<>'record' or record_kind=${q.record_kind})` : tx``}
      ${q.tag_id && !q.tag_ids?.length ? tx`and tag_ids ? ${q.tag_id}` : tx``}
      ${
      q.tag_ids?.length ? tx`and tag_ids ?| ${tx.array([...q.tag_ids, ...(q.tag_id ? [q.tag_id] : [])])}::text[]` : tx``
    }
      ${q.entity_id ? tx`and entity_ids @> array[${q.entity_id}::text]` : tx``}
      ${q.from ? tx`and at>=${q.from}::timestamptz` : tx``} ${q.to ? tx`and at<=${q.to}::timestamptz` : tx``}`;
  }
  async coverage(q: SearchInput) {
    const tx = this.tx;
    const [r] = await tx`with sources as (${this.sources()}) select
      count(*) filter(where kind='record' and index_state='pending')::int as pending,
      count(*) filter(where kind='record' and index_state='excluded')::int as excluded from sources where ${
      this.filters(q)
    }`;
    return { pending: r.pending as number, excluded: r.excluded as number };
  }
  matches(q: SearchInput) {
    return this.tx`strpos(lower(title||E'\n'||body),lower(${q.query}))>0`;
  }
  ranked(q: SearchInput, vector: number[] | undefined) {
    const tx = this.tx;
    const bestChunk = vector
      ? tx`left join lateral (select c.start_offset,c.end_offset,
        greatest(0::float8,least(1::float8,1-(c.embedding operator(extensions.<=>) ${
        JSON.stringify(vector)
      }::extensions.vector))) as score
        from app.search_chunks c where s.kind='record' and s.index_state='indexed' and
        c.owner_id=s.owner_id and c.record_id=s.id and c.generation=s.generation
        order by c.embedding operator(extensions.<=>) ${
        JSON.stringify(vector)
      }::extensions.vector,c.start_offset limit 1) best on true`
      : tx`left join lateral (select null::int as start_offset,null::int as end_offset,0::float8 as score) best on true`;
    return tx`with sources as (${this.sources()}),scored as (
      select s.*,${this.matches(q)} as keyword_match,coalesce(best.score,0::float8) as score,
        case when best.score>=0.27 then best.start_offset else greatest(0,strpos(lower(s.body),lower(${q.query}))-81) end as snippet_start,
        case when best.score>=0.27 then best.end_offset else least(char_length(s.body),greatest(0,strpos(lower(s.body),lower(${q.query}))-81)+240) end as snippet_end
        from sources s ${bestChunk} where ${this.filters(q)})
      select *,case when keyword_match then 1::float8 else 0::float8 end + case when score>=0.27 then score else 0::float8 end as rank,
      case when keyword_match and score>=0.27 then 'both' when keyword_match then 'keyword' else 'semantic' end as match
      from scored where keyword_match or score>=0.27`;
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
    }) select kind,id,title,substring(body from snippet_start+1 for snippet_end-snippet_start) as snippet,
      snippet_start,snippet_end,at,tag_ids,index_state,match,rank,status,record_kind from candidates
      ${
      after
        ? tx`where (rank,at,kind,id)<(${after.rank}::float8,${after.at}::timestamptz,${after.kind}::text,${after.id}::text)`
        : tx``
    }
      order by rank desc,at desc,kind desc,id desc limit ${q.limit + 1}`;
    return rows.map((r) => ({
      kind: r.kind as SearchItem["kind"],
      id: r.id as string,
      title: r.kind === "record" ? recordDisplayText(r.title as string) : r.title as string,
      snippet: r.snippet as string,
      snippet_start: r.snippet_start as number,
      snippet_end: r.snippet_end as number,
      at: (r.at as Date).toISOString(),
      tag_ids: r.tag_ids as string[],
      match: r.match as SearchItem["match"],
      rank: r.rank as number,
      index_state: r.index_state as SearchItem["index_state"],
      path: `/${r.kind}s/${r.id}`,
      task_status: r.kind === "task" ? r.status as SearchItem["task_status"] : null,
      record_kind: (r.record_kind as SearchItem["record_kind"]) ?? null,
    }));
  }
}
export class SqlSearchUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}
  run<T>(a: Actor, fn: (s: SearchStore) => Promise<T>): Promise<T> {
    return runAsActor(this.sql, a, async (tx) => {
      await tx`select app.require_search_owner()`;
      return fn(new SqlSearchStore(tx));
    });
  }
}
