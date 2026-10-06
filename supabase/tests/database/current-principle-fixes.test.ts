import { assertEquals, assertRejects } from "@std/assert";
import { asUser, connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { SqlPrincipleUnitOfWork } from "../../functions/_shared/adapters/supabase/principle-store.ts";
import { SqlSearchUnitOfWork } from "../../functions/_shared/adapters/supabase/search-store.ts";
import { searchInput } from "../../functions/_shared/contracts/search.ts";
import { principleCreate } from "../../functions/_shared/contracts/principle.ts";
import * as p from "../../functions/_shared/core/principles/application.ts";
import { search } from "../../functions/_shared/core/search/application.ts";
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { max: 2, prepare: false });
const pd = { uow: new SqlPrincipleUnitOfWork(sql) }, sd = { uow: new SqlSearchUnitOfWork(sql) };
dbTest(
  "retired history: product reads/search/mutations hide archive; business role cannot restore old writers",
  async () => {
    const f = await fixtureOwner(admin);
    try {
      const token = crypto.randomUUID();
      const [old] =
        await admin`insert into app.principles(owner_id,title,body,is_current,origin) values(${f.actor.userId},${token},'과거 원문',false,'legacy') returning *`;
      const current = await p.createPrinciple(
        pd,
        f.actor,
        principleCreate.parse({ id: crypto.randomUUID(), title: token, body: "현재 원문" }),
      );
      await assertRejects(() => p.getPrinciple(pd, f.actor, old.id));
      await assertRejects(() => p.deletePrinciple(pd, f.actor, old.id, old.version));
      const found = await search(
        sd,
        f.actor,
        searchInput.parse({ query: token, kinds: ["principle"], mode: "keyword" }),
      );
      assertEquals(found.items.map((r) => r.id), [current.id]);
      // Keyword reads include the current principle, while semantic coverage tracks records only.
      assertEquals(found.semantic_coverage, { pending: 0, excluded: 0 });
      assertEquals(
        (await admin`select id from app.search_index_state where owner_id=${f.actor.userId} and kind='principle'`)
          .length,
        0,
      );
      assertEquals(
        (await admin`select msg_id from pgmq.q_search_index where message->>'owner_id'=${f.actor.userId} and message->>'kind'='principle'`)
          .length,
        0,
      );
      assertEquals((await asUser(sql, f.actor.userId, (tx) => tx`select id from app.principles`)).map((r) => r.id), [
        current.id,
      ]);
      await assertRejects(() =>
        asUser(
          sql,
          f.actor.userId,
          (tx) =>
            tx`insert into app.principles(owner_id,title,body,is_current) values(${f.actor.userId},'과거 쓰기','거부',false)`,
        )
      );
      for (
        const table of [
          "app.record_principles",
          "app.principle_tags",
          "app.legacy_principle_record_parts",
          "private.retired_principle_sources",
        ]
      ) {
        assertEquals((await admin`select to_regclass(${table}) as present`)[0].present, null);
      }
      assertEquals(
        (await admin`select to_regprocedure('private.preserve_principle_sources(uuid)') as present`)[0].present,
        null,
      );
      assertEquals((await admin`select * from app.principles where id=${old.id}`)[0], old);
    } finally {
      await f.cleanup();
    }
  },
);
