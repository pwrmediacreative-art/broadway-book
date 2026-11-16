-- The Unverified song page shows "NN% sure" from the live chart's stored confidence, so
-- visitors may read that one column too (20261113000000 granted the others). Row rules are
-- unchanged: only revisions of published songs are visible. ai_raw stays hidden.
grant select (ai_confidence) on public.revisions to anon, authenticated;
