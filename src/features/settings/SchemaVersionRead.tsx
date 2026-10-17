import { SchemaExport } from "./SchemaExport.tsx";
import { BodyAction } from "../../components/BodyAction.tsx";
import { useEffect, useRef, useState } from "react";
import type { EntitySchemaVersion } from "@contracts/entity-type.ts";
import { api } from "../../lib/api.ts";
import { SchemaDefinitionRead } from "./SchemaDefinitionRead.tsx";
import { SchemaVersionDiff } from "./SchemaVersionDiff.tsx";

export function SchemaVersionRead(
  { typeId, version, open, onError }: {
    typeId: string;
    version: number;
    open: boolean;
    onError: (message: string) => void;
  },
) {
  const reportError = useRef(onError);
  reportError.current = onError;
  const [value, setValue] = useState<
    { target: EntitySchemaVersion; source?: EntitySchemaVersion }
  >();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setValue(undefined);
    setError("");
    reportError.current("");
    const read = (n: number) =>
      api<EntitySchemaVersion>(
        "GET",
        `/entity-types/${typeId}/schema?schema_version=${n}`,
        undefined,
        controller.signal,
      );
    void Promise.all([
      read(version),
      version > 1 ? read(version - 1) : Promise.resolve(undefined),
    ])
      .then(([target, source]) => {
        if (controller.signal.aborted) return;
        if (
          target.type_id !== typeId || target.schema_version !== version ||
          (source &&
            (source.type_id !== typeId ||
              source.schema_version !== version - 1))
        ) throw new Error("요청한 입력 항목 버전과 조회 결과가 다릅니다.");
        setValue({ target, source });
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : "버전 조회 실패";
          setError(message);
          reportError.current(message);
        }
      });
    return () => controller.abort();
  }, [typeId, version, open, retry]);
  return (
    <div className="schema-version-read">
      {error && <p role="alert" className="error-text">{error}</p>}
      {error && (
        <BodyAction icon="reset" onClick={() => setRetry((n) => n + 1)}>
          입력 항목 다시 조회
        </BodyAction>
      )}
      {!value && !error && <p role="status">입력 항목 읽는 중…</p>}
      {value && (
        <>
          <SchemaExport definition={value.target} />
          <SchemaDefinitionRead definition={value.target} />
          <section aria-label="변경 결과" className="schema-history-result">
            <h3 className="section-title">변경 결과</h3>
            {version === 1
              ? (
                <dl className="key-value-grid key-value-static">
                  <div>
                    <dt>버전</dt>
                    <dd>1 · 최초 생성</dd>
                  </div>
                </dl>
              )
              : (
                <>
                  <dl className="key-value-grid key-value-static">
                    <div>
                      <dt>버전</dt>
                      <dd>{version - 1} → {version} · 적용 완료</dd>
                    </div>
                  </dl>
                  {value.source && (
                    <SchemaVersionDiff
                      before={value.source}
                      after={value.target}
                    />
                  )}
                </>
              )}
          </section>
        </>
      )}
    </div>
  );
}
