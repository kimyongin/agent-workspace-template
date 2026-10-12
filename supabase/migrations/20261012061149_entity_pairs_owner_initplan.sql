-- Cache the Actor UID once per statement instead of evaluating it for each pair row.
-- Keep the existing app_user role, ownership predicate, and read/write authorization.
-- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
alter policy entity_pairs_owner on app.entity_pairs
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
