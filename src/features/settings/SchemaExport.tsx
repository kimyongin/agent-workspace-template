import { Button } from "../../components/ui/button.tsx";

import type { EntitySchemaVersion } from "@contracts/entity-type.ts";

/** Export only the public document; the envelope is transport metadata. */
export function SchemaExport({ definition, current = false }: { definition: EntitySchemaVersion; current?: boolean }) {
  return (
    <Button variant="ghost" type="button"
      onClick={() => {
        const blob = new Blob([JSON.stringify(definition.schema, null, 2) + "\n"], {
          type: "application/schema+json;charset=utf-8",
        });
        const url = URL.createObjectURL(blob), anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `schema-${definition.type_id}-v${definition.schema_version}.json`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }}
    >
      {current ? "현재 정의 JSON 내보내기" : `버전 ${definition.schema_version} JSON 내보내기`}
    </Button>
  );
}
