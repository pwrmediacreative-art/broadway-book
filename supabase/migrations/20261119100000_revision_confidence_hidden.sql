-- Q15: players never see an AI confidence score. The song page no longer shows "NN% sure",
-- so take back the column grant 20261116100100 added for it. Admin screens read confidence
-- through their own security-definer functions (review_song, review_items, ...), unchanged.
revoke select (ai_confidence) on public.revisions from anon, authenticated;
