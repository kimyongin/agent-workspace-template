import { assertEquals, assertRejects } from "@std/assert";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { requestActor } from "../_request.ts";
import { SqlEntityRelationDefinitionUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-relation-definition-store.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { createEntityType } from "../../functions/_shared/core/entity-types/application.ts";
import {
  createEntityRelationDefinition,
  deleteEntityRelationDefinition,
  getEntityRelationDefinition,
  listEntityRelationDefinitions,
  updateEntityRelationDefinition,
} from "../../functions/_shared/core/entity-relations/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
dbTest(
  "relation definitions retain ordered roles, permit multiple meanings, isolate owner and bind cursors",
  async () => {
    const admin = connect(urls.admin),
      sql = connect(urls.direct, { max: 3 }),
      a = await fixtureOwner(admin),
      b = await fixtureOwner(admin);
    const d = { uow: new SqlEntityRelationDefinitionUnitOfWork(sql) },
      types = { uow: new SqlEntityTypeUnitOfWork(sql) };
    try {
      const type = await createEntityType(types, requestActor(a.actor), { label: "상품" });
      const input = {
        ends: [{ type_id: type.id, label: "상위", cardinality: "one" }, {
          type_id: type.id,
          label: "하위",
          cardinality: "many",
        }],
      };
      const writer = requestActor(a.actor), first = await createEntityRelationDefinition(d, writer, input);
      assertEquals(await createEntityRelationDefinition(d, writer, input), first);
      const second = await createEntityRelationDefinition(d, requestActor(a.actor), {
        ends: [{ ...input.ends[0], label: "대체 상품" }, { ...input.ends[1], label: "원 상품" }],
      });
      assertEquals((await getEntityRelationDefinition(d, a.actor, first.id)).ends.map((e) => e.label), [
        "상위",
        "하위",
      ]);
      assertEquals((await listEntityRelationDefinitions(d, b.actor)).items, []);
      assertEquals(
        (await assertRejects(() => getEntityRelationDefinition(d, b.actor, first.id), AppError)).code,
        "not_found",
      );
      const page = await listEntityRelationDefinitions(d, a.actor, { q: "상품", limit: 1 });
      assertEquals(page.items.length, 1);
      const next = await listEntityRelationDefinitions(d, a.actor, { q: "상품", cursor: page.next_cursor, limit: 1 });
      assertEquals(new Set([...page.items, ...next.items].map((x) => x.id)).size, 2);
      for (
        const [actor, filter] of [[a.actor, { q: "상위" }], [b.actor, { q: "상품" }], [a.actor, {
          q: "상품",
          archived: "all",
        }]] as const
      ) {
        assertEquals(
          (await assertRejects(
            () => listEntityRelationDefinitions(d, actor, { ...filter, cursor: page.next_cursor, limit: 1 }),
            AppError,
          )).code,
          "invalid_input",
        );
      }
      const writes = await Promise.allSettled(
        [true, false].map((archived) =>
          updateEntityRelationDefinition(d, requestActor(a.actor), first.id, { expected_version: 1, archived })
        ),
      );
      assertEquals(writes.filter((x) => x.status === "fulfilled").length, 1);
      assertEquals(
        (writes.find((x) => x.status === "rejected") as PromiseRejectedResult).reason.code,
        "settings_changed",
      );
      const latest = await getEntityRelationDefinition(d, a.actor, first.id);
      const archived = await updateEntityRelationDefinition(d, requestActor(a.actor), first.id, {
        expected_version: latest.version,
        archived: true,
      });
      assertEquals(archived.archived, true);
      assertEquals((await listEntityRelationDefinitions(d, a.actor, { archived: "archived" })).items.map((x) => x.id), [
        first.id,
      ]);
      const deletion = requestActor(a.actor);
      assertEquals(await deleteEntityRelationDefinition(d, deletion, second.id, { expected_version: 1 }), {
        deleted: true,
      });
      assertEquals(await deleteEntityRelationDefinition(d, deletion, second.id, { expected_version: 1 }), {
        deleted: true,
      });
    } finally {
      await a.cleanup();
      await b.cleanup();
      await sql.end();
      await admin.end();
    }
  },
);
