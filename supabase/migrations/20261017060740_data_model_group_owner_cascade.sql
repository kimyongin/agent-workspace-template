begin;
-- Account deletion cascades through both model history and kind history. Keep
-- references restrictive for ordinary deletion, but validate after every cascade.
alter table app.data_model_children
 alter constraint data_model_children_owner_id_type_id_fkey deferrable initially deferred,
 alter constraint data_model_children_owner_id_analysis_id_fkey deferrable initially deferred,
 alter constraint data_model_children_owner_id_job_id_fkey deferrable initially deferred;
commit;
