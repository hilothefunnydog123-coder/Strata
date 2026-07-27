import Link from "next/link";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/Chrome";
import { LoginForm } from "@/components/LoginForm";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Login() {
  if (await currentUser()) redirect("/dashboard");
  return (
    <main className="min-h-screen grid md:grid-cols-2">
      <div className="hidden md:flex flex-col justify-between bg-chrome-900 text-paper p-10">
        <Wordmark className="[&_span]:text-paper" />
        <div>
          <p className="font-serif text-[24px] leading-snug max-w-sm">
            Accounts are provisioned after a contract. There is no signup — and that absence is deliberate.
          </p>
          <p className="a-mono text-[12px] text-chrome-300 mt-4">Credentials + TOTP. The desktop app never sees a password.</p>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="md:hidden mb-6"><Wordmark /></div>
          <h1 className="font-serif text-[26px] text-ink mb-1">Sign in</h1>
          <p className="text-[13px] text-chrome-500 mb-6">Use your work email, password, and authenticator code.</p>
          <LoginForm />
          <p className="text-[12px] text-chrome-500 mt-6">
            Need access? <Link href="/#demo" className="text-citation">Request a demo</Link>. No self-service signup exists.
          </p>
        </div>
      </div>
    </main>
  );
}
