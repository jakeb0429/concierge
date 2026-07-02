"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

function Login() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const callbackUrl = params.get("callbackUrl") || "/";
  const signedIn = useRef(false); // fire the one-time-token sign-in exactly once (dev strict-mode guard)

  // Completing a magic link: the verify route redirects here with a one-time token.
  useEffect(() => {
    if (signedIn.current) return;
    if (params.get("magic") === "verified") {
      signedIn.current = true;
      const e = params.get("email")!;
      const t = params.get("token")!;
      setStatus("Signing you in…");
      signIn("credentials", { email: e, token: t, callbackUrl, redirect: true });
    } else if (params.get("error")) {
      setStatus("That link was invalid or expired — request a new one.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function request(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, callbackUrl }),
      });
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  async function passwordLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const res = await signIn("password", { email, password, callbackUrl, redirect: false });
      if (res?.error) setStatus("Wrong email or password.");
      else window.location.href = res?.url ?? callbackUrl;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="text-xl font-semibold tracking-tight">Concierge</h1>
      <p className="mt-1 text-sm text-neutral-500">Sign in with your work email.</p>

      {status && <p className="mt-4 rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-600">{status}</p>}

      {sent ? (
        <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-700">
          Check your inbox — if that address has access, a sign-in link is on its way.
        </div>
      ) : usePassword ? (
        <form onSubmit={passwordLogin} className="mt-6 space-y-2">
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@scribechs.com"
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-300"
          />
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-300"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      ) : (
        <form onSubmit={request} className="mt-6 space-y-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@rheosgear.com"
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-300"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Sending…" : "Email me a sign-in link"}
          </button>
        </form>
      )}

      {!sent && (
        <button
          onClick={() => {
            setUsePassword((v) => !v);
            setStatus(null);
          }}
          className="mt-3 text-xs text-neutral-400 hover:text-neutral-700"
        >
          {usePassword ? "← Use an emailed sign-in link instead" : "Have a password? Sign in with it →"}
        </button>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
