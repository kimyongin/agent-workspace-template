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
  suffix = "",
): TemplateStringsArray {
  const parts = [text + strings[0], ...strings.slice(1)];
  const raw = [text + strings.raw[0], ...strings.raw.slice(1)];
  parts[parts.length - 1] += suffix;
  raw[raw.length - 1] += suffix;
  return Object.assign(parts, { raw });
}

/** Temporary opt-in probe: actual public transaction, role, parameters and unchanged timeout. */
export function explainSchemaSnapshot(sql: postgres.Sql): postgres.Sql {
  if (Deno.env.get("WORKSPACE_SCHEMA_SNAPSHOT_DIAGNOSTIC") !== "1") return sql;
  const requestedLimit = Deno.env.get("WORKSPACE_SCHEMA_SNAPSHOT_DIAGNOSTIC_LIMIT");
  if (requestedLimit && !["50", "250"].includes(requestedLimit)) {
    throw new Error("Snapshot diagnostic limit must be 50 or 250");
  }
  const limit = requestedLimit ? Number(requestedLimit) : null;
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
                        `explain (analyze, buffers, timing ${limit ? "on" : "off"}, format json) `,
                        limit ? ` limit ${limit}` : "",
                      ),
                      ...values,
                    ]);
                    console.log(
                      "[DEBUG-518-snapshot-plan]",
                      JSON.stringify({
                        phase: "actual",
                        profiled_targets: limit ?? 2000,
                        plan: safePlan(actual[0]["QUERY PLAN"]),
                      }),
                    );
                    if (limit) {
                      console.log("[DEBUG-518-snapshot-plan]", JSON.stringify({ phase: "bounded-rollback" }));
                      // A partial profiling INSERT must never become an accepted job or a passing boundary test.
                      throw new Error("Bounded snapshot profile completed; deliberately rolling back");
                    }
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
