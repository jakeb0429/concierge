"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { INQUIRY_CATEGORIES, INQUIRY_CATEGORY_LABEL, type InquiryCategory } from "@/lib/categories";

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  specialties: string[];
  preferredView: string;
  lastLogin: string | null;
  openTickets: number;
  openSignals: number;
};

const ROLE_LABEL: Record<string, string> = {
  agent: "Agent",
  team_lead: "Team lead",
  brand_admin: "Admin (triage)",
  super_admin: "Super admin",
};

function SpecialtyPicker({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {INQUIRY_CATEGORIES.map((c) => {
        const on = value.includes(c);
        return (
          <button
            key={c}
            type="button"
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((v) => v !== c) : [...value, c])}
            className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
              on
                ? "bg-neutral-900 text-white"
                : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
            } ${disabled ? "opacity-50" : ""}`}
          >
            {INQUIRY_CATEGORY_LABEL[c as InquiryCategory]}
          </button>
        );
      })}
    </div>
  );
}

export default function UsersManager({
  tenantName,
  meId,
  initialUsers,
}: {
  tenantName: string;
  meId: string;
  initialUsers: UserRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ email: "", name: "", role: "agent", specialties: [] as string[] });
  const [edits, setEdits] = useState<Record<string, { role: string; specialties: string[] }>>({});

  const editOf = (u: UserRow) => edits[u.id] ?? { role: u.role, specialties: u.specialties };
  const isDirty = (u: UserRow) => {
    const e = editOf(u);
    return e.role !== u.role || JSON.stringify([...e.specialties].sort()) !== JSON.stringify([...u.specialties].sort());
  };

  async function save(u: UserRow) {
    const e = editOf(u);
    setBusy(u.id);
    const res = await fetch(`/api/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(e.role !== u.role ? { role: e.role } : {}), specialties: e.specialties }),
    });
    setBusy(null);
    if (!res.ok) {
      setNotice((await res.json().catch(() => ({ error: "Save failed." }))).error);
      return;
    }
    setNotice(null);
    router.refresh();
  }

  // Applies immediately — the default view is an onboarding switch, not part
  // of the role/specialties edit-then-save flow.
  async function setView(u: UserRow, preferredView: string) {
    setBusy(u.id);
    const res = await fetch(`/api/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferredView }),
    });
    setBusy(null);
    if (!res.ok) {
      setNotice((await res.json().catch(() => ({ error: "Save failed." }))).error);
      return;
    }
    setNotice(null);
    router.refresh();
  }

  async function addUser() {
    if (!draft.email.includes("@")) return;
    setBusy("new");
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    setBusy(null);
    if (!res.ok) {
      setNotice((await res.json().catch(() => ({ error: "Add failed." }))).error);
      return;
    }
    setDraft({ email: "", name: "", role: "agent", specialties: [] });
    setAdding(false);
    setNotice(null);
    router.refresh();
  }

  async function invite(u: UserRow) {
    setBusy(u.id);
    await fetch("/api/auth/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: u.email }),
    });
    setBusy(null);
    setNotice(`Sign-in link sent to ${u.email}.`);
  }

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="page-title">Team — {tenantName}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Specialties decide which tickets auto-assign to each person. The admin sees everything and can
            override any assignment.
          </p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="btn-primary px-3 py-1.5 text-sm"
        >
          {adding ? "Cancel" : "Add teammate"}
        </button>
      </div>

      {notice && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {notice}
        </div>
      )}

      {adding && (
        <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-3 flex gap-3">
            <input
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              placeholder="email@company.com"
              className="w-64 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
            />
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Name (optional)"
              className="w-48 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
            />
            <select
              value={draft.role}
              onChange={(e) => setDraft({ ...draft, role: e.target.value })}
              className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
            >
              <option value="agent">Agent</option>
              <option value="team_lead">Team lead</option>
              <option value="brand_admin">Admin (triage)</option>
            </select>
          </div>
          <div className="mb-3">
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-400">
              Handles these question types
            </div>
            <SpecialtyPicker
              value={draft.specialties}
              onChange={(specialties) => setDraft({ ...draft, specialties })}
            />
          </div>
          <button
            onClick={addUser}
            disabled={busy === "new" || !draft.email.includes("@")}
            className="btn-primary px-4 py-1.5 text-sm"
          >
            {busy === "new" ? "Adding…" : "Add and grant sign-in"}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {initialUsers.map((u) => {
          const e = editOf(u);
          return (
            <div key={u.id} className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="mb-2 flex items-center gap-3">
                <div className="font-medium">{u.name ?? u.email}</div>
                {u.name && <div className="text-sm text-neutral-400">{u.email}</div>}
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                  {ROLE_LABEL[u.role] ?? u.role}
                </span>
                {u.id === meId && (
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">you</span>
                )}
                <div className="ml-auto flex items-center gap-4 text-xs text-neutral-400">
                  <span>
                    {u.openTickets} open ticket{u.openTickets === 1 ? "" : "s"}
                  </span>
                  {u.openSignals > 0 && <span>{u.openSignals} training pending</span>}
                  <span>{u.lastLogin ? `last seen ${new Date(u.lastLogin).toLocaleDateString()}` : "never signed in"}</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <SpecialtyPicker
                    value={e.specialties}
                    onChange={(specialties) => setEdits({ ...edits, [u.id]: { ...e, specialties } })}
                  />
                </div>
                {u.role !== "super_admin" && u.id !== meId && (
                  <select
                    value={e.role}
                    onChange={(ev) => setEdits({ ...edits, [u.id]: { ...e, role: ev.target.value } })}
                    className="rounded-lg border border-neutral-300 px-2 py-1 text-xs"
                  >
                    <option value="agent">Agent</option>
                    <option value="team_lead">Team lead</option>
                    <option value="brand_admin">Admin (triage)</option>
                  </select>
                )}
                <select
                  value={u.preferredView}
                  onChange={(ev) => setView(u, ev.target.value)}
                  disabled={busy === u.id}
                  title="Which view they land on after signing in — Simple = the Q&A-only onboarding view"
                  className={`rounded-lg border px-2 py-1 text-xs ${u.preferredView === "simple" ? "border-gold bg-cream text-neutral-700" : "border-neutral-300"}`}
                >
                  <option value="full">Full workspace</option>
                  <option value="simple">Simple Q&A view</option>
                </select>
                {isDirty(u) && (
                  <button
                    onClick={() => save(u)}
                    disabled={busy === u.id}
                    className="btn-primary px-3 py-1 text-xs"
                  >
                    {busy === u.id ? "Saving…" : "Save"}
                  </button>
                )}
                {!u.lastLogin && (
                  <button
                    onClick={() => invite(u)}
                    disabled={busy === u.id}
                    className="rounded-lg border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
                  >
                    Send sign-in link
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
