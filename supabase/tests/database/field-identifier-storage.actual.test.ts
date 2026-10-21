import { assertEquals } from "@std/assert";
import { connect, dbTest, outcome, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const kind = "00000000-0000-4000-8000-000000000001";
const type = "11111111-1111-4111-8111-111111111111";

// Actual storage and its direct-write guards are the agreed #543 DB seam.
dbTest(
  "identifier storage preserves raw Unicode and delimiters in its derived reference",
  async () => {
    const pair = `${kind}:001:A/%😀e\u0301`;
    const [row] = await admin`select app.identifier_kind(${pair})::text kind,
    app.identifier_raw(${pair}) raw,app.entity_reference(${type}::uuid,${pair}) reference`;
    assertEquals(row, {
      kind,
      raw: "001:A/%😀e\u0301",
      reference: `${type}:${pair}`,
    });
    for (
      const value of [
        `${kind}:`,
        "00000000-0000-0000-8000-000000000001:value",
        `${kind}: padded`,
        `${kind}:${"x".repeat(201)}`,
        `app:${type}:001`,
      ]
    ) {
      assertEquals(
        (await outcome(admin`select app.identifier_kind(${value})`)).startsWith(
          "23514",
        ),
        true,
      );
    }
  },
);

import type postgres from "postgres";
import { businessWorkspaceFixture } from "./_workspace-business.ts";

async function identifierFixture() {
  const direct = connect(urls.direct, { max: 3, prepare: false });
  const fixture = await businessWorkspaceFixture(admin, direct);
  const typeId = crypto.randomUUID(), ruleId = crypto.randomUUID();
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    "x-type-id": typeId,
    "x-version": 1,
    title: "식별자 저장 경계",
    "x-icon": "box",
    deprecated: false,
    "x-title-template": "$prop_1$",
    "x-identity-property": "prop_2",
    required: ["prop_1", "prop_2"],
    properties: {
      prop_1: { type: "string", title: "이름", "x-order": 1 },
      prop_2: {
        type: "string",
        title: "식별자",
        "x-order": 2,
        "x-identifier": {
          allowed_kind_ids: [kind, ruleId],
          default_kind_id: kind,
        },
      },
      prop_3: {
        type: ["string", "null"],
        title: "일반 번호",
        "x-order": 3,
        "x-identifier": {
          allowed_kind_ids: [kind, ruleId],
          default_kind_id: kind,
        },
      },
    },
  };
  const inDb = <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) =>
    admin.begin(async (tx) => {
      await tx`select set_config('request.workspace_id',${fixture.workspaceId},true),
      set_config('request.jwt.claims',${
        JSON.stringify({ sub: fixture.manager.userId, role: "authenticated" })
      },true)`;
      return fn(tx);
    }) as Promise<T>;
  await inDb(async (tx) => {
    await tx`insert into app.entity_issuers(workspace_id,code,label,system)
      values(${fixture.workspaceId},'app','앱',true),(${fixture.workspaceId},'crm','CRM',false)`;
    await tx`insert into app.entity_identifier_rules(workspace_id,id,source,label,meaning,generation)
      values(${fixture.workspaceId},${kind},'app','자동 발급','앱 식별자','automatic'),
      (${fixture.workspaceId},${ruleId},'crm','외부 번호','원본 외부 번호','direct')`;
    await tx`insert into app.entity_types(workspace_id,id,next_property_number)
      values(${fixture.workspaceId},${typeId},4)`;
    await tx`insert into app.entity_schema_versions(workspace_id,schema)
      values(${fixture.workspaceId},${tx.json(schema)})`;
  });
  await fixture.grantKind(fixture.manager, typeId, "write");
  const pair = `${ruleId}:001:외부😀`, id = `${typeId}:${pair}`;
  const properties = {
    prop_1: "첫 이름",
    prop_2: pair,
    prop_3: `${ruleId}:중복 가능`,
  };
  const insert = (entityId = id, props = properties) =>
    inDb(async (tx) => {
      await tx`insert into app.entities(workspace_id,id,entity_type_id,schema_version,properties)
      values(${fixture.workspaceId},${entityId},${typeId},1,${tx.json(props)})`;
    });
  return {
    ...fixture,
    direct,
    schema,
    typeId,
    ruleId,
    pair,
    id,
    properties,
    inDb,
    insert,
    cleanup: async () => {
      await fixture.cleanup();
      await direct.end();
    },
  };
}

dbTest(
  "direct writes derive identity from the selected property and reserve tombstones",
  async () => {
    const f = await identifierFixture();
    try {
      assertEquals(
        (await outcome(f.insert(`${f.typeId}:${f.ruleId}:wrong`))).startsWith(
          "23514",
        ),
        true,
      );
      await f.insert();
      assertEquals((await outcome(f.insert())).startsWith("23505"), true);
      for (
        const patch of [
          { prop_2: `${f.ruleId}:changed` },
          { prop_2: null },
        ]
      ) {
        assertEquals(
          (await outcome(f.inDb(async (tx) => {
            await tx`update app.entities set properties=properties||${
              tx.json(patch)
            }
          where workspace_id=${f.workspaceId} and id=${f.id}`;
          }))).startsWith("23514"),
          true,
        );
      }
      await f.inDb(async (tx) => {
        await tx`update app.entities set deleted_at=now() where workspace_id=${f.workspaceId} and id=${f.id}`;
      });
      assertEquals((await outcome(f.insert())).startsWith("23505"), true);
      await f.inDb(async (tx) => {
        await tx`update app.entity_identifier_rules set active=false where workspace_id=${f.workspaceId} and id=${f.ruleId}`;
        await tx`update app.entities set deleted_at=null,properties=properties||'{"prop_1":"복원한 이름"}'::jsonb
        where workspace_id=${f.workspaceId} and id=${f.id}`;
      });
      const [row] =
        await admin`select properties from app.entities where workspace_id=${f.workspaceId} and id=${f.id}`;
      assertEquals(row.properties.prop_2, f.pair);
      assertEquals(
        (await outcome(
          f.insert(`${f.typeId}:${f.ruleId}:new`, {
            ...f.properties,
            prop_2: `${f.ruleId}:new`,
          }),
        ))
          .startsWith("23514"),
        true,
      );
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "ordinary identifiers allow duplicate pairs while new stopped assignments and identity definition changes fail",
  async () => {
    const f = await identifierFixture();
    try {
      await f.insert();
      await f.insert(`${f.typeId}:${f.ruleId}:second`, {
        ...f.properties,
        prop_2: `${f.ruleId}:second`,
      });
      await f.inDb(async (tx) => {
        await tx`update app.entities set deleted_at=now() where workspace_id=${f.workspaceId}`;
      });
      for (
        const change of [
          {
            ...f.schema,
            "x-identity-property": "prop_3",
            required: ["prop_1", "prop_2", "prop_3"],
          },
          { ...f.schema, required: ["prop_1"] },
          {
            ...f.schema,
            properties: {
              ...f.schema.properties,
              prop_2: { ...f.schema.properties.prop_2, deprecated: true },
            },
          },
          {
            ...f.schema,
            properties: {
              ...f.schema.properties,
              prop_2: {
                ...f.schema.properties.prop_2,
                "x-identifier": {
                  allowed_kind_ids: [kind],
                  default_kind_id: kind,
                },
              },
            },
          },
        ]
      ) {
        const result = await outcome(f.inDb(async (tx) => {
          await tx`insert into app.entity_schema_versions(workspace_id,schema)
          values(${f.workspaceId},${tx.json({ ...change, "x-version": 2 })})`;
        }));
        assertEquals(result.startsWith("23514"), true, result);
      }
      assertEquals(
        (await outcome(f.inDb(async (tx) => {
          await tx`update app.entity_identifier_rules set meaning='바꾼 의미'
        where workspace_id=${f.workspaceId} and id=${f.ruleId}`;
        }))).startsWith("23514"),
        true,
      );
      assertEquals(
        (await outcome(f.inDb(async (tx) => {
          await tx`update app.entity_identifier_rules set active=false where workspace_id=${f.workspaceId} and id=${kind}`;
        }))).startsWith("23514"),
        true,
      );
      await f.inDb(async (tx) => {
        await tx`update app.entity_identifier_rules set active=false where workspace_id=${f.workspaceId} and id=${f.ruleId}`;
        await tx`update app.entities set properties=properties||'{"prop_1":"보존된 번호 읽기"}'::jsonb
        where workspace_id=${f.workspaceId} and id=${f.id}`;
      });
      assertEquals(
        (await outcome(f.inDb(async (tx) => {
          await tx`update app.entities set properties=properties||${
            tx.json({ prop_3: `${f.ruleId}:new ordinary` })
          }
        where workspace_id=${f.workspaceId} and id=${f.id}`;
        }))).startsWith("23514"),
        true,
      );
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "identifier title variables and fallback decode raw values without exposing serialized kind prefixes",
  async () => {
    const pair = `${kind}:000:원본😀`;
    const field = {
      type: "string",
      "x-identifier": { allowed_kind_ids: [kind], default_kind_id: kind },
    };
    const document = {
      "x-title-template": "$prop_2$",
      "x-identity-property": "prop_2",
      properties: { prop_2: field },
    };
    const [row] = await admin`select app.entity_title(${admin.json(document)},${
      admin.json({ prop_2: pair })
    },'fallback') title,
    app.entity_title(${
      admin.json({ ...document, "x-title-template": "$prop_1$" })
    },${admin.json({ prop_2: pair })},'fallback') fallback`;
    assertEquals(row, { title: "000:원본😀", fallback: "000:원본😀" });
  },
);

dbTest(
  "a historical head cannot replace the selected identity after tombstone creation",
  async () => {
    const f = await identifierFixture();
    try {
      const alternate = {
        ...f.schema,
        "x-version": 2,
        "x-identity-property": "prop_4",
        required: ["prop_1", "prop_4"],
        properties: {
          ...f.schema.properties,
          prop_4: { ...f.schema.properties.prop_2, "x-order": 4 },
        },
      };
      await f.inDb(async (tx) => {
        await tx`insert into app.entity_schema_versions(workspace_id,schema) values(${f.workspaceId},${
          tx.json(alternate)
        })`;
      });
      await f.insert();
      await f.inDb(async (tx) => {
        await tx`update app.entities set deleted_at=now() where workspace_id=${f.workspaceId} and id=${f.id}`;
      });
      assertEquals(
        (await outcome(f.inDb(async (tx) => {
          await tx`update app.entity_types set schema_version=2 where workspace_id=${f.workspaceId} and id=${f.typeId}`;
        }))).startsWith("23514"),
        true,
      );
    } finally {
      await f.cleanup();
    }
  },
);

import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";

dbTest(
  "type readers receive only their document's kind metadata without settings access",
  async () => {
    const f = await identifierFixture();
    try {
      await f.grantKind(f.member, f.typeId, "read");
      const unrelated = crypto.randomUUID();
      await f.inDb(async (tx) => {
        await tx`insert into app.entity_identifier_rules(workspace_id,id,source,label,meaning,generation)
        values(${f.workspaceId},${unrelated},'crm','비공개 종류','다른 설정의 의미','direct')`;
      });
      const metadata = await runInWorkspace(f.direct, f.member, {
        mode: "business",
        requirements: [
          { target_kind: "entity_type", target_id: f.typeId, access: "read" },
        ],
      }, async (tx) => {
        const [row] =
          await tx`select app.entity_identifier_kinds(${f.typeId}::uuid,1) kinds`;
        const settings =
          await tx`select id from app.entity_identifier_rules where id=${unrelated}`;
        assertEquals(settings.length, 0);
        return row.kinds;
      });
      assertEquals(
        metadata.map((item: { id: string }) => item.id).sort(),
        [kind, f.ruleId].sort(),
      );
      assertEquals(
        metadata.find((item: { id: string }) => item.id === f.ruleId)
          .source_label,
        "CRM",
      );
      // A label-only settings write remains allowed even after references exist.
      await runInWorkspace(f.direct, f.manager, {
        mode: "business",
        requirements: [
          { target_kind: "settings", target_id: "*", access: "write" },
        ],
      }, async (tx) => {
        await tx`update app.entity_identifier_rules set label='새 표시 이름'
        where workspace_id=${f.workspaceId} and id=${f.ruleId}`;
      });
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "concurrent duplicate registration has one winner without constraining ordinary identifiers",
  async () => {
    const f = await identifierFixture();
    const competing = connect(urls.admin, { max: 2 });
    try {
      const attempt = () =>
        competing.begin(async (tx) => {
          await tx`select set_config('request.workspace_id',${f.workspaceId},true),
        set_config('request.jwt.claims',${
            JSON.stringify({ sub: f.manager.userId, role: "authenticated" })
          },true)`;
          await tx`insert into app.entities(workspace_id,id,entity_type_id,schema_version,properties)
        values(${f.workspaceId},${f.id},${f.typeId},1,${
            tx.json(f.properties)
          })`;
        });
      const results = await Promise.all([
        outcome(attempt()),
        outcome(attempt()),
      ]);
      assertEquals(results.filter((result) => result === "ok").length, 1);
      assertEquals(
        results.filter((result) => result.startsWith("23505")).length,
        1,
      );
    } finally {
      await competing.end();
      await f.cleanup();
    }
  },
);

dbTest(
  "retired source columns and independent type identity tables have no runtime SQL consumers",
  async () => {
    const retired =
      await admin`select to_regclass('app.entity_type_identity') settings,
    to_regclass('app.entity_type_identity_sources') mappings`;
    assertEquals(retired[0], { settings: null, mappings: null });
    const columns =
      await admin`select attname from pg_attribute where attrelid='app.entities'::regclass
    and attnum>0 and not attisdropped and attname in ('source','external_id')`;
    assertEquals([...columns], []);
    const [grants] =
      await admin`select has_table_privilege('app_user','app.entities','DELETE') hard_delete`;
    assertEquals(grants.hard_delete, false);
    const functions =
      await admin`select n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('app','private') and p.prokind='f' and
    (pg_get_functiondef(p.oid) ~ 'entity_type_identity|external_id')`;
    assertEquals([...functions], []);
  },
);
