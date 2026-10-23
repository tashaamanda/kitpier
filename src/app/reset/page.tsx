import { ResetForm } from "@/components/PasswordReset";
import TopBar from "@/components/TopBar";

// No Referer from this page, belt and braces: the token is in the fragment, which browsers never send anyway.
export const metadata = { title: "Choose a new password · Kitpier", referrer: "no-referrer" as const };

export default function Page() {
  return (
    <main className="lp-hero" style={{ gridTemplateRows: "auto 1fr" }}>
      <TopBar />
      <div className="mx-auto grid w-full max-w-md content-center gap-6 py-10">
        <div className="grid gap-2">
          <h1 className="text-4xl" style={{ letterSpacing: "-0.04em" }}>
            Choose a new <i>password</i>
          </h1>
          <p className="text-muted" style={{ lineHeight: 1.75, letterSpacing: "0.035em" }}>
            This signs you out everywhere else.
          </p>
        </div>
        <ResetForm />
      </div>
    </main>
  );
}
