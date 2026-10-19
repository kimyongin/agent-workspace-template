/** Exact local fixture CAS. Callers must bind the actor and saved values to their private run manifest. */
export function restoreFixturePreferences(sql, actorId, original, expected) {
  return sql.begin(async (tx) => {
    // postgres sends a null parameter as SQL NULL even when wrapped in sql.json.
    const before = original.sqlNull ? null : original.value === null ? tx`'null'::jsonb` : tx.json(original.value);
    const changed = await tx`update auth.users set raw_user_meta_data=${before}::jsonb
      where id=${actorId} and raw_user_meta_data=${tx.json(expected)}::jsonb returning id`;
    if (changed.length === 1) return;
    const unchanged = await tx`select id from auth.users where id=${actorId}
      and raw_user_meta_data is not distinct from ${before}::jsonb`;
    if (unchanged.length !== 1) {
      throw new Error("fixture preferences changed outside the tracked test; preserved current metadata");
    }
  });
}
