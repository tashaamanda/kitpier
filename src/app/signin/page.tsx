import AuthForm from "@/components/AuthForm";
import TopBar from "@/components/TopBar";

export const metadata = { title: "Sign in · Kitpier" };

export default function Page() {
  return (
    <main className="lp-hero" style={{ gridTemplateRows: "auto 1fr" }}>
      <TopBar />
      <div className="mx-auto grid w-full max-w-md content-center gap-6 py-10">
        <div className="grid gap-2">
          <h1 className="text-4xl" style={{ letterSpacing: "-0.04em" }}>
            Welcome to <i>Kitpier</i>
          </h1>
          <p className="text-muted" style={{ lineHeight: 1.75, letterSpacing: "0.035em" }}>
            Create an account to plan a stack, or sign in to your projects.
          </p>
        </div>
        <AuthForm />
      </div>
    </main>
  );
}
