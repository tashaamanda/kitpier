import { ResetForm } from "@/components/PasswordReset";

// No Referer from this page, belt and braces: the token is in the fragment, which browsers never send anyway.
export const metadata = { title: "Choose a new password · Kitpier", referrer: "no-referrer" as const };

export default function Page() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <h1 className="text-3xl font-semibold">Choose a new password</h1>
      <p className="mb-6 mt-2 text-muted">This signs you out everywhere else.</p>
      <ResetForm />
    </main>
  );
}
