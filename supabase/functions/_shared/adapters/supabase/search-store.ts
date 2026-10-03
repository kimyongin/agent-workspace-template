import type postgres from "postgres";
import type { SearchInput, SearchItem } from "../../contracts/search.ts";
import type { Actor } from "../../core/shared/actor.ts";
import type { SearchPosition, SearchStore } from "../../core/search/application.ts";
import { runAsActor } from "./sql-context.ts";
import { tagIdsColumn } from "./tag-links.ts";
import { SEARCH_PIPELINE } from "../../core/search/config.ts";
class SqlSearchStore implements SearchStore {
  constructor(private readonly tx: postgres.TransactionSql) {}
  sources() {
    const tx = this.tx;
    const originals =
      tx`select owner_id,'task'::text as kind,id,title,summary,body,updated_at as at,null::text as status,${
        tagIdsColumn(tx, "task")
      } from app.tasks
      union all select owner_id,'record',id,title,summary,body,occurred_at,null::text,${
        tagIdsColumn(tx, "record")
      } from app.records
      union all select owner_id,'principle',id,title,summary,body,updated_at,status,${
        tagIdsColumn(tx, "principle")
      } from app.principles`;
    return tx`select s.*,case
      when s.summary is null or btrim(s.summary)='' then 'excluded'
      when i.input_hash=encode(extensions.digest(s.title||E'\n'||s.summary,'sha256'),'hex') and i.pipeline=${SEARCH_PIPELINE}
        and i.state in ('indexed','excluded') then i.state else 'pending' end as index_state
      from (${originals}) s left join app.search_index_state i on (i.owner_id,i.kind,i.id)=(s.owner_id,s.kind,s.id)`;
  }
  filters(q: SearchInput) {
    const tx = this.tx;
    return tx`kind in ${tx(q.kinds)} and (kind<>'principle' or ${q.status}='all' or status=${q.status})
      ${q.tag_id ? tx`and tag_ids ? ${q.tag_id}` : tx``}
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
  async anchorPage(q: SearchInput) {
    if (!q.anchor) return null;
    const tx = this.tx;
    const [r] = await tx`with sources as (${this.sources()}), ranked as (
      select kind,id,row_number() over(order by at desc,kind desc,id desc) as position
      from sources where ${this.filters(q)} and ${this.matches(q)})
      select ceil(position::numeric/${q.limit})::int as page from ranked where kind=${q.anchor.kind} and id=${q.anchor.id}`;
    return r ? r.page as number : null;
  }
  async keyword(q: SearchInput, after?: SearchPosition): Promise<SearchItem[]> {
    const tx = this.tx;
    const rows =
      await tx`with sources as (${this.sources()}) select kind,id,title,summary,at,tag_ids,index_state from sources
      where ${this.filters(q)} and ${this.matches(q)}
      ${after ? tx`and (at,kind,id)<(${after.at}::timestamptz,${after.kind}::text,${after.id}::uuid)` : tx``}
      order by at desc,kind desc,id desc limit ${q.limit + 1}`;
    return rows.map((r) => ({
      kind: r.kind as SearchItem["kind"],
      id: r.id as string,
      title: r.title as string,
      summary: (r.summary ?? "") as string,
      at: (r.at as Date).toISOString(),
      tag_ids: r.tag_ids as string[],
      match: "keyword",
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
