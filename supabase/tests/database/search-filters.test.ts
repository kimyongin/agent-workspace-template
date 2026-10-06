import { assert, assertEquals, assertRejects } from "@std/assert";
import { SqlSearchUnitOfWork } from "../../functions/_shared/adapters/supabase/search-store.ts";
import { searchInput } from "../../functions/_shared/contracts/search.ts";
import { search } from "../../functions/_shared/core/search/application.ts";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }),
  sql = connect(urls.pooler, { prepare: false, max: 2 }),
  d = { uow: new SqlSearchUnitOfWork(sql) };
dbTest(
  "search actual SQL filters task kind/status, current principle only, record kind, coverage/anchor/cursor",
  async () => {
    const f = await fixtureOwner(admin);
    try {
      const owner = f.actor.userId,
        token = crypto.randomUUID(),
        ids = Array.from({ length: 7 }, () => crypto.randomUUID());
      await admin`insert into app.tasks(id,owner_id,kind,status,title,summary) values(${
        ids[0]
      },${owner},'once','open',${token},'계획'),(${ids[1]},${owner},'once','done',${token},'완료')`;
      await admin`insert into app.tasks(id,owner_id,kind,status,title,summary,recurrence,timezone) values(${
        ids[2]
      },${owner},'recurring','active',${token},'반복','{"freq":"daily","starts_on":"2026-01-01"}','Asia/Seoul')`;
      await admin`insert into app.principles(id,owner_id,title,summary,is_current) values(${
        ids[3]
      },${owner},${token},'현재',true),(${ids[4]},${owner},${token},'과거',false)`;
      await admin`insert into app.records(id,owner_id,title,summary,record_kind) values(${
        ids[5]
      },${owner},${token},'관찰','user'),(${ids[6]},${owner},${token},'변경','change')`;
      const q = (extra: object) => searchInput.parse({ query: token, mode: "keyword", ...extra });
      for (
        const [extra, expected] of [
          [{ kinds: ["task"], task_kind: "recurring" }, [ids[2]]],
          [{ kinds: ["task"], task_status: "done" }, [ids[1]]],
          [{ kinds: ["principle"] }, [ids[3]]],
          [{ kinds: ["record"], record_kind: "change" }, [ids[6]]],
        ] as const
      ) {
        const result = await search(d, f.actor, q(extra));
        assertEquals(result.items.map((r) => r.id), [...expected]);
        assertEquals(result.semantic_coverage, { pending: 1, excluded: 0 });
        assertEquals(
          (await search(d, f.actor, q({ ...extra, anchor: { kind: "task", id: ids[0] } }))).anchor_page,
          null,
        );
      }
      const page = await search(d, f.actor, q({ kinds: ["task"], task_kind: "once", limit: 1 }));
      assert(page.next_cursor);
      await assertRejects(() =>
        search(d, f.actor, q({ kinds: ["task"], task_kind: "recurring", limit: 1, cursor: page.next_cursor }))
      );
      assertEquals((await search(d, f.actor, q({ kinds: ["record"], record_kind: "result" }))).items, []);
    } finally {
      await f.cleanup();
    }
  },
);
