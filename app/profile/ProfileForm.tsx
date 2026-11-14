"use client";

import { useActionState } from "react";
import { DISPLAY_NAME_MAX, INSTRUMENTS } from "@/lib/auth/roles";
import { saveProfile, type ProfileState } from "./actions";

export default function ProfileForm(props: {
  displayName: string;
  instrument: string;
  next: string;
  first: boolean;
}) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(saveProfile, {});

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={props.next} />
      <label htmlFor="display_name" className="text-lg font-medium">
        Display name <span className="text-bb-cue-gray">(shown on your edits)</span>
      </label>
      <input
        id="display_name"
        name="display_name"
        required
        maxLength={DISPLAY_NAME_MAX}
        autoComplete="nickname"
        defaultValue={props.displayName}
        className="bb-input h-14 px-4 text-xl"
      />
      <label htmlFor="instrument" className="mt-2 text-lg font-medium">
        Instrument <span className="text-bb-cue-gray">(optional)</span>
      </label>
      <select
        id="instrument"
        name="instrument"
        defaultValue={props.instrument}
        className="bb-input h-14 px-4 text-xl capitalize"
      >
        <option value="">—</option>
        {INSTRUMENTS.map((i) => (
          <option key={i} value={i}>
            {i}
          </option>
        ))}
      </select>
      {state.error && (
        <p role="alert" className="bb-error text-lg">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="bb-btn bb-btn-primary mt-2 h-14 text-xl"
      >
        {pending ? "Saving…" : props.first ? "Save and continue" : "Save"}
      </button>
    </form>
  );
}
