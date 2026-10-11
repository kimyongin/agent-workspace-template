-- api/mcp enqueue through app.enqueue_search_index under app_user.
-- Verify deployed writers use that path before applying; retain SECURITY DEFINER queue access.
revoke usage on schema pgmq from app_server;
revoke execute on function pgmq.send(text,jsonb) from app_server;
revoke execute on function pgmq.send(text,jsonb,jsonb,timestamp with time zone) from app_server;
revoke execute on function pgmq.format_table_name(text,text) from app_server;
revoke insert on pgmq.q_search_index from app_server;
revoke select (msg_id) on pgmq.q_search_index from app_server;
