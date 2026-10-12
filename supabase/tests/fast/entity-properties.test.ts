import { assertEquals, assertRejects } from "@std/assert";
import { createEntity, updateEntity, type EntityStore } from "../../functions/_shared/core/entity/application.ts";
import { initialEntityDefinition } from "../../functions/_shared/contracts/entity-type.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { requestActor } from "../_request.ts";
Deno.test("Typed entity usecase validates the final patch, uses defaults only at creation and preserves stored type", async () => {
  const typeId = crypto.randomUUID();
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_2 = { type: ["integer", "null"], default: 7 };
  definition.display.order.push("prop_2");
  let row: any = null;
  const store = {
    executeRequest: (_: unknown, run: () => unknown) => run(),
    definition: () => Promise.resolve({ ...definition, type_id: typeId, schema_version: 1, type_version: 1, type: { id:typeId, label:"재료",icon_id:"leaf",archived:false } }),
    getBusinessSettings: () => Promise.resolve({settings:{}}),
    get: () => Promise.resolve(row),
    insert: (i: any) => Promise.resolve(row = {...i,type:{id:typeId,label:"재료",icon_id:"leaf",archived:false},current_schema_version:1,title:i.properties.prop_1,display_properties:{prop_1:i.properties.prop_1},version:1,deleted_at:null}),
    update: (_: unknown, patch: any) => Promise.resolve(row={...row,...patch,version:row.version+1}),
    appendChange: () => Promise.resolve(),
  } as unknown as EntityStore;
  const deps = {uow:{run: (_: unknown, run: (s:EntityStore)=>any) => run(store)}};
  const actor = requestActor({userId:crypto.randomUUID()});
  await createEntity(deps,actor,{entity_type_id:typeId,schema_version:1,properties:{prop_1:"재료"},external_id:"한글/%"});
  assertEquals(row.properties,{prop_1:"재료",prop_2:7});
  await updateEntity(deps,actor,row.id,{schema_version:1,expected_version:1,properties:{prop_2:null}});
  assertEquals(row.properties,{prop_1:"재료",prop_2:null});
  const error = await assertRejects(()=>updateEntity(deps,actor,row.id,{schema_version:1,expected_version:2,properties:{prop_2:1.5}}),AppError);
  assertEquals(error.fields?.[0].path,"properties.prop_2");
  assertEquals(row.version,2);
  assertEquals((await assertRejects(()=>updateEntity(deps,actor,row.id,{schema_version:2,expected_version:2,properties:{prop_1:"new"}}),AppError)).code,"schema_changed");
});
