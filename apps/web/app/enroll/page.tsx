import { redirect } from "next/navigation";
import { Wordmark } from "@/components/Chrome";
import { EnrollForm } from "@/components/EnrollForm";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The one page a bootstrapped account can reach before the console opens.
 *
 * It exists because there is no safe channel for delivering a second factor with the
 * password: anything shipped alongside it — in the repository, in an email, in a
 * chat — is a shared secret, and a shared second factor is not a second factor. So
 * the secret is generated here and the only lasting copy is on the owner's phone.
 */
export default async function Enroll() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.totpEnrolled) redirect("/dashboard");

  return (
    <main id="main" className="min-h-screen grid md:grid-cols-2">
      <div className="hidden md:flex flex-col justify-between bg-chrome-900 text-paper p-10">
        <Wordmark className="[&_span]:text-paper" />
        <div>
          <p className="font-serif text-[24px] leading-snug max-w-sm">
            One step left. Your second factor is created on your phone, and nowhere else.
          </p>
          <p className="a-mono text-[12px] text-chrome-300 mt-4">
            Until this is done, the console stays closed.
          </p>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="md:hidden mb-6">
            <Wordmark />
          </div>
          <h1 className="font-serif text-[26px] text-ink mb-1">Set up your authenticator</h1>
          <p className="text-[13px] text-chrome-500 mb-6">
            Scan this with 1Password, Authy, Google Authenticator, or any TOTP app. Signed in as{" "}
            <span className="text-ink">{user.email}</span>.
          </p>
          <EnrollForm />
          <p className="text-[12px] text-chrome-500 mt-6">
            From now on you will need your password and a code from this app to sign in.
          </p>
        </div>
      </div>
    </main>
  );
}
