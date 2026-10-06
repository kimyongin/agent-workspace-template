-- Follow-up generated with the CLI; sequenced after the existing Oct 6 migrations.
-- Preserve every distinct retired content value without altering identity/version/event snapshots.
create function pg_temp.merge_content(original text, variadic retired text[]) returns text
language plpgsql as $$
declare value text; merged text := coalesce(original,'');
begin
  foreach value in array retired loop
    if value is not null and value <> '' and position(value in merged) = 0 then
      merged := case when merged = '' then value else merged || E'\n\n' || value end;
    end if;
  end loop;
  return merged;
end $$;

alter table app.records drop constraint records_body_check;
alter table app.tasks drop constraint tasks_body_check;
alter table app.principles drop constraint principles_body_check;
alter table app.records add constraint records_body_check check(char_length(body) <= 22000);
alter table app.tasks add constraint tasks_body_check check(char_length(body) <= 22000);
alter table app.principles add constraint principles_body_check check(char_length(body) <= 22000);

update app.records set body = pg_temp.merge_content(body,title,summary,change_note);
update app.tasks set body = pg_temp.merge_content(body,summary);
update app.principles set body = pg_temp.merge_content(body,summary,change_note);

alter table app.records drop column title, drop column summary, drop column change_note;
alter table app.tasks drop column summary;
alter table app.principles drop column summary, drop column change_note;
