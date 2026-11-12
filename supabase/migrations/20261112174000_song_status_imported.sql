-- Songs created by a Dropbox scan start as 'imported': a title, artist and source PDF,
-- no chart yet. Own file because a new enum value can't be used in the transaction
-- that adds it.
alter type public.song_status add value if not exists 'imported';
