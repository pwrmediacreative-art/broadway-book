-- supabase-js upsert updates every column it sends, user_id included, so the update grant
-- must cover it. The owner-only policy still pins user_id to the signed-in player.
grant update (user_id) on public.user_prefs to authenticated;
