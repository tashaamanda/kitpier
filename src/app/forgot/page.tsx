import Link from "next/link";
import { ForgotForm } from "@/components/PasswordReset";
import TopBar from "@/components/TopBar";

export const metadata = { title: "Forgot password · Kitpier" };

export default function Page() {
  return (
    <main className="lp-hero" style={{ gridTemplateRows: "auto 1fr" }}>
      <TopBar />
      <div className="mx-auto grid w-full max-w-md content-center gap-6 py-10">
        <div className="grid gap-2">
          <h1 className="text-4xl" style={{ letterSpacing: "-0.04em" }}>
            Forgot your <i>password?</i>
          </h1>
          <p className="text-muted" style={{ lineHeight: 1.75, letterSpacing: "0.035em" }}>
            Enter your account email and we&apos;ll send you a link to choose a new one.
          </p>
        </div>
        <ForgotForm />
        <Link href="/signin" className="text-sm text-muted underline">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
