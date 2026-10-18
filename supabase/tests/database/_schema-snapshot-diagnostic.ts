import type postgres from "postgres";

const planKeys = new Set([
  "Plan",
  "Plans",
  "Node Type",
  "Relation Name",
  "Join Type",
  "Parent Relationship",
  "Strategy",
  "Startup Cost",
  "Total Cost",
  "Plan Rows",
  "Plan Width",
  "Actual Rows",
  "Actual Loops",
  "Actual Startup Time",
  "Actual Total Time",
  "Rows Removed by Filter",
  "Rows Removed by Join Filter",
  "Shared Hit Blocks",
  "Shared Read Blocks",
  "Shared Dirtied Blocks",
  "Shared Written Blocks",
  "Temp Read Blocks",
  "Temp Written Blocks",
  "Planning Time",
  "Execution Time",
  "JIT",
  "Functions",
  "Timing",
  "Generation",
  "Inlining",
  "Optimization",
  "Emission",
  "Total",
  "Triggers",
  "Time",
  "Calls",
]);
function safePlan(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safePlan);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([key]) => planKeys.has(key)).map((
        [key, item],
      ) => [
        key,
        safePlan(item),
      ]),
    );
  }
  return value;
}
function prefix(
  strings: TemplateStringsArray,
  text: string,
): TemplateStringsArray {
  const parts = [text + strings[0], ...strings.slice(1)];
  return Object.assign(parts, {
    raw: [text + strings.raw[0], ...strings.raw.slice(1)],
  });
}

/** Temporary opt-in probe: actual public transaction, role, parameters and unchanged timeout. */
export function explainSchemaSnapshot(sql: postgres.Sql): postgres.Sql {
  if (Deno.env.get("WORKSPACE_SCHEMA_SNAPSHOT_DIAGNOSTIC") !== "1") return sql;
  let intercepted = false;
  return new Proxy(sql, {
    get(target, property) {
      if (property !== "begin") return Reflect.get(target, property);
      return (...args: unknown[]) => {
        const forwarded = args.map((arg) => {
          if (typeof arg !== "function") return arg;
          return (tx: postgres.TransactionSql) =>
            arg(
              new Proxy(tx, {
                apply(query, receiver, parameters) {
                  const [strings, ...values] = parameters;
                  if (
                    intercepted || !Array.isArray(strings) ||
                    !String(strings[0]).startsWith(
                      "insert into private.entity_schema_migration_rows(",
                    )
                  ) return Reflect.apply(query, receiver, parameters);
                  intercepted = true;
                  return (async () => {
                    // EXPLAIN without ANALYZE preserves estimates even if the real INSERT times out.
                    const estimated = await Reflect.apply(query, receiver, [
                      prefix(
                        strings as unknown as TemplateStringsArray,
                        "explain (format json) ",
                      ),
                      ...values,
                    ]);
                    console.log(
                      "[DEBUG-518-snapshot-plan]",
                      JSON.stringify({
                        phase: "estimated",
                        plan: safePlan(estimated[0]["QUERY PLAN"]),
                      }),
                    );
                    // ANALYZE replaces (never duplicates) the void-awaited INSERT, including target RLS/FK work.
                    const actual = await Reflect.apply(query, receiver, [
                      prefix(
                        strings as unknown as TemplateStringsArray,
                        "explain (analyze, buffers, timing off, format json) ",
                      ),
                      ...values,
                    ]);
                    console.log(
                      "[DEBUG-518-snapshot-plan]",
                      JSON.stringify({
                        phase: "actual",
                        plan: safePlan(actual[0]["QUERY PLAN"]),
                      }),
                    );
                    return actual;
                  })();
                },
              }),
            );
        });
        return Reflect.apply(target.begin, target, forwarded);
      };
    },
  });
}
