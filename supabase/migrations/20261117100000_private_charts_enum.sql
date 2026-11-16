-- Private charts (uploads): new enum values. Kept in their own migration because a new
-- enum value can't be used in the same transaction that adds it.
alter type public.song_status add value if not exists 'private';
alter type public.revision_source add value if not exists 'upload';
