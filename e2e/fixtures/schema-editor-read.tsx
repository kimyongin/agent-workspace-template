import { createRoot } from "react-dom/client";
import { BrowserRouter, Link } from "react-router";
import { SchemaEditor } from "../../src/features/settings/SchemaEditor.tsx";
import { type EntityType, initialEntityDefinition } from "../../supabase/functions/_shared/contracts/entity-type.ts";
import "../../src/styles/app.css";
import "../../src/features/settings/settings.css";
const type: EntityType = {
  id: "00000000-0000-4000-8000-000000000001",
  label: "재료",
  icon_id: "leaf",
  archived: false,
  version: 1,
  schema_version: 1,
  next_property_number: 2,
  created_at: "2026-10-12T00:00:00Z",
  updated_at: "2026-10-12T00:00:00Z",
};
const definition = {
  ...initialEntityDefinition("이름"),
  type_id: type.id,
  schema_version: 1,
  created_at: type.created_at,
};
if (new URLSearchParams(location.search).has("display-example")) {
  definition.schema.properties.prop_1.title = "재료명";
  Object.assign(definition.schema.properties, {
    prop_2: { type: "number", title: "수량" },
    prop_3: { type: "string", title: "단위", enum: ["kg", "g"] },
  });
  definition.display.order.push("prop_2", "prop_3");
  definition.display.list_columns.push("prop_2", "prop_3");
  definition.display.option_labels.prop_3 = { kg: "킬로그램", g: "그램" };
}
const onState = () => {};
const onApplied = async () => "";
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <nav aria-label="Fixture navigation">
      <Link to="?change_id=a">변경안 A</Link>
      <Link to="?change_id=b">변경안 B</Link>
    </nav>
    <SchemaEditor type={type} definition={definition} onState={onState} onApplied={onApplied} />
  </BrowserRouter>,
);
