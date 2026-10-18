import { assertEquals, assertRejects } from "@std/assert";
import { restoreFixturePreferences } from "../../../scripts/fixture-preferences.mjs";
import { connect, dbTest, urls } from "./_db.ts";

dbTest(
  "fixture preference recovery restores exact JSON and SQL null, retries safely, refuses concurrent changes",
  async () => {
    const admin = connect(urls.admin, { max: 1 });
    const actor = crypto.randomUUID();
    const read = async () => {
      const [row] =
        await admin`select raw_user_meta_data as value,raw_user_meta_data is null as sql_null from auth.users where id=${actor}`;
      return { value: row.value, sqlNull: row.sql_null };
    };
    try {
      await admin`insert into auth.users(id,email) values(${actor},${`preferences-${actor}@example.test`})`;
      const expected = { workspace_timezone: "UTC", arbitrary: { preserved: [1, true, null] } };
      for (
        const original of [
          { value: { arbitrary: { preserved: [1, true, null] } }, sqlNull: false },
          { value: { workspace_timezone: null, arbitrary: { preserved: [1, true, null] } }, sqlNull: false },
          { value: null, sqlNull: true },
          { value: null, sqlNull: false },
        ]
      ) {
        await admin`update auth.users set raw_user_meta_data=${
          original.sqlNull ? null : admin.json(original.value)
        }::jsonb where id=${actor}`;
        assertEquals(await read(), original);
        await admin`update auth.users set raw_user_meta_data=${admin.json(expected)} where id=${actor}`;
        await restoreFixturePreferences(admin, actor, original, expected);
        assertEquals(await read(), original);
        await restoreFixturePreferences(admin, actor, original, expected);
        assertEquals(await read(), original);
        const concurrent = { ...expected, unrelated_concurrent_change: "must survive" };
        await admin`update auth.users set raw_user_meta_data=${admin.json(concurrent)} where id=${actor}`;
        await assertRejects(
          () => restoreFixturePreferences(admin, actor, original, expected),
          Error,
          "changed outside",
        );
        assertEquals(await read(), { value: concurrent, sqlNull: false });
      }
      await assertRejects(
        () => restoreFixturePreferences(admin, crypto.randomUUID(), { value: {}, sqlNull: false }, expected),
        Error,
        "changed outside",
      );
    } finally {
      await admin`delete from auth.users where id=${actor}`;
      await admin.end();
    }
  },
);
