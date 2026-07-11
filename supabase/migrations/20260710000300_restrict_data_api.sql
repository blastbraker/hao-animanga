-- HAO's Fastify API is the only application-data boundary. Supabase Auth and
-- Storage remain client-facing, while canonical catalog and user records are
-- accessed through the API's per-account authorization checks.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
