-- Existing owner RLS and restrictive foreign keys preserve linked/history definitions.
-- No cascading deletion of number kinds or mappings is introduced.
grant delete on app.entity_issuers, app.entity_identifier_rules to app_user;
-- Restrictive policies compose with owner isolation. System definitions remain
-- removable only through the privileged Auth account cleanup, never app_user DML.
create policy external_issuer_deletion on app.entity_issuers as restrictive
 for delete to app_user using(code <> 'app');
create policy external_rule_deletion on app.entity_identifier_rules as restrictive
 for delete to app_user using(source <> 'app');
