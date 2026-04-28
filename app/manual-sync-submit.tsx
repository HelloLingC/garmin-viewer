"use client";

import { useFormStatus } from "react-dom";

export function ManualSyncSubmit() {
  const { pending } = useFormStatus();

  return (
    <button
      className="inline-flex h-10 items-center justify-center border border-emerald-300/50 px-4 text-sm font-medium text-emerald-200 transition hover:bg-emerald-300/10 disabled:cursor-wait disabled:border-white/10 disabled:text-neutral-500"
      disabled={pending}
      type="submit"
    >
      {pending ? "Syncing..." : "Sync now"}
    </button>
  );
}
