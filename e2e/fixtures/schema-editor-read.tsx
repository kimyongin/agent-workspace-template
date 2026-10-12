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
const onState = () => {};
const onApplied = async () => {};
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <nav aria-label="Fixture navigation">
      <Link to="?change_id=a">변경안 A</Link>
      <Link to="?change_id=b">변경안 B</Link>
    </nav>
    <SchemaEditor type={type} definition={definition} onState={onState} onApplied={onApplied} />
  </BrowserRouter>,
);
