"use client";

// "Send a copy" invite links (20261118180000_setlist_invites.sql). The database decides
// everything (owner-only links, one recipient, 7-day expiry, turn off, independent copy).
import { browserClient } from "@/lib/supabase/browser";

export type InviteState = "open" | "used" | "expired" | "off" | "yours" | "accepted" | "missing";
export interface SentInvite {
  id: string;
  code: string;
  created_at: string;
  expires_at: string;
  state: "open" | "used" | "expired" | "off";
  accepted_at: string | null;
  accepted_name: string | null;
}
export interface InviteCardData {
  state: InviteState;
  code: string;
  name?: string;
  sender?: string;
  count?: number;
  expires_at?: string;
  copy_id?: string | null;
}

const db = () => browserClient();
function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export const inviteUrl = (code: string) => `${location.origin}/setlists/invite/${code}`;
export const privateCount = async (setlist: string) => must<number>(await db().rpc("setlist_private_count", { p_setlist: setlist })) ?? 0;
export const createInvite = async (setlist: string) => must<string>(await db().rpc("setlist_invite_create", { p_setlist: setlist }));
export const sentInvites = async (setlist: string) => must<SentInvite[]>(await db().rpc("setlist_invites_for", { p_setlist: setlist })) ?? [];
export const revokeInvite = async (id: string) => void must(await db().rpc("setlist_invite_revoke", { p_invite: id }));
export const openInvite = async (code: string) => must<InviteCardData>(await db().rpc("setlist_invite_open", { p_code: code }));
export const acceptInvite = async (code: string) => must<string>(await db().rpc("setlist_invite_accept", { p_code: code }));
export const declineInvite = async (code: string) => void must(await db().rpc("setlist_invite_decline", { p_code: code }));
export const waitingInvites = async () => must<InviteCardData[]>(await db().rpc("setlist_invites_waiting")) ?? [];
/** Tell the top bar the waiting count changed (accepted or declined). */
export const INVITES_EVENT = "bb:invites";
