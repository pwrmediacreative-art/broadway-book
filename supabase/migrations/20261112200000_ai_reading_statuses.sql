-- AI reading statuses. Own file because a new enum value can't be used in the
-- transaction that adds it.
-- import_files: the AI result didn't pass the parser after one retry; a human types it.
alter type public.import_status add value if not exists 'needs_manual';
-- songs: an AI-read chart waiting for a human. Never shown to the public.
alter type public.song_status add value if not exists 'needs_review';
