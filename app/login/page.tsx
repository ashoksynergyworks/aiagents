"use client";

import { useActionState, useState } from "react";
import Logo from "../Logo";
import { login } from "./actions";
import NeuralCanvas from "./NeuralCanvas";
import { FIELD } from "../ui";

export default function Login() {
  const [error, action, pending] = useActionState(login, "");
  const [show, setShow] = useState(false);

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.15fr_1fr]">
      {/* brand side: the neural mesh on the logo's ink */}
      <section className="relative isolate flex min-h-64 flex-col justify-end overflow-hidden bg-wordmark p-8 text-paper sm:p-12 lg:min-h-dvh lg:p-16">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_30%_35%,color-mix(in_oklab,var(--tertiary)_45%,transparent),transparent),radial-gradient(45%_40%_at_80%_80%,color-mix(in_oklab,var(--secondary)_30%,transparent),transparent)]" />
        <NeuralCanvas className="absolute inset-0 -z-10 size-full" />
        <div className="max-w-lg animate-rise">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-paper/15 bg-paper/5 px-3 py-1 text-xs font-medium tracking-wide text-paper/80 backdrop-blur-sm">
            <span className="size-1.5 animate-pulse rounded-full bg-secondary" />
            Live on your referral data
          </p>
          <h1 className="font-serif text-4xl leading-[1.08] tracking-tight text-balance sm:text-5xl lg:text-6xl">
            Ask a question. <span className="text-secondary">Get the report.</span>
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-pretty text-paper/70">
            Referrals, PCPs and specialists, answered in plain words with the numbers behind them.
          </p>
        </div>
      </section>

      {/* form side */}
      <main className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm animate-rise [animation-delay:120ms]">
          <Logo className="h-7" />
          <h2 className="mt-10 text-2xl font-semibold tracking-tight">Sign in</h2>
          {/* <p className="mt-1.5 text-[15px] text-muted">Use your SynergyWorks account.</p> */}

          <form action={action} className="mt-8 space-y-5">
            <label className="block text-sm font-medium">
              Email
              <input name="email" type="email" required autoComplete="username" placeholder="you@thesynergyworks.com" className={FIELD} />
            </label>
            <label className="block text-sm font-medium">
              Password
              <span className="relative block">
                <input name="password" type={show ? "text" : "password"} required autoComplete="current-password" className={`${FIELD} pr-16`} />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  aria-pressed={show}
                  className="absolute inset-y-0 right-1 my-auto h-9 cursor-pointer rounded-lg px-3 text-xs font-semibold text-muted transition-colors hover:text-ink focus-visible:outline-3 focus-visible:outline-primary"
                >
                  {show ? "Hide" : "Show"}
                </button>
              </span>
            </label>
            <p role="alert" className="min-h-5 text-sm text-secondary">
              {error}
            </p>
            <button
              disabled={pending}
              className="group relative flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl bg-primary text-[15px] font-semibold text-paper shadow-[0_10px_24px_-12px_var(--primary)] transition-[background-color,transform] duration-150 hover:bg-primary-strong active:scale-[0.99] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-80"
            >
              {pending ? "Signing in…" : "Sign in"}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="size-4 transition-transform duration-200 group-hover:translate-x-0.5">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </form>
          <p className="mt-10 text-xs text-muted">Developed &amp; maintained by SynergyWorks Solutions LLP</p>
        </div>
      </main>
    </div>
  );
}
