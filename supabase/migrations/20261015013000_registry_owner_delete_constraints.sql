-- The registry's cross-references must be checked after the complete account cascade.
-- They still reject deleting a referenced rule/issuer when its owning type remains.
begin;
alter table app.entity_identifier_rules
  alter constraint entity_identifier_rules_owner_id_source_fkey deferrable initially deferred;
alter table app.entity_type_identity
  alter constraint entity_type_identity_owner_id_default_source_fkey deferrable initially deferred;
alter table app.entity_type_identity_sources
  alter constraint entity_type_identity_sources_owner_id_code_rule_id_fkey deferrable initially deferred;
commit;
