-- Workspace isolation replaced the former owner policies, including these
-- independent restrictions. Compose system-definition protection with the
-- current workspace/settings policies for direct app_user DML as well.
create policy external_issuer_deletion on app.entity_issuers as restrictive
  for delete to app_user using (code <> 'app');
create policy external_rule_deletion on app.entity_identifier_rules as restrictive
  for delete to app_user using (source <> 'app');
