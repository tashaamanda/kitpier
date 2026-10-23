import Link from "next/link";
import { ForgotForm } from "@/components/PasswordReset";

export const metadata = { title: "Forgot password · Kitpier" };

export default function Page() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <h1 className="text-3xl font-semibold">Forgot your password?</h1>
      <p className="mb-6 mt-2 text-muted">Enter your account email and we&apos;ll send you a link to choose a new one.</p>
      <ForgotForm />
      <Link href="/signin" className="mt-6 text-sm text-muted underline">
        Back to sign in
      </Link>
    </main>
  );
}
