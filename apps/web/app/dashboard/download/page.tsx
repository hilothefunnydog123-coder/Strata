import { PRODUCT } from "@assent/core";

export const dynamic = "force-dynamic";

export default function Download() {
  const platforms = [
    ["macOS", "Apple silicon · universal", "assent-desktop-0.1.0-macos.dmg"],
    ["Windows", "x64", "assent-desktop-0.1.0-x64.msi"],
  ];
  return (
    <div>
      <h1 className="font-serif text-[28px] text-ink">{PRODUCT.desktopName}</h1>
      <p className="text-[13px] text-chrome-500 mt-1 max-w-reading">
        The instrument itself. Everything of substance happens here — the corpus, the criteria
        rail, the coverage map, the blueprint. It runs offline once synced.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 mt-6 max-w-2xl">
        {platforms.map(([os, detail, file]) => (
          <div key={os} className="border border-chrome-200 rounded-lg p-5">
            <div className="font-medium text-ink">{os}</div>
            <div className="a-mono text-[11px] text-chrome-500 mt-0.5">{detail}</div>
            <a href={`/releases/${file}`} className="mt-4 inline-block rounded bg-ink text-paper px-4 py-2 text-[13px] hover:bg-chrome-700 no-underline">
              Download v0.1.0
            </a>
            <div className="a-mono text-[10px] text-chrome-300 mt-2">{file}</div>
          </div>
        ))}
      </div>

      <section className="mt-10 max-w-reading">
        <h2 className="font-serif text-[19px] text-ink">Pair this device</h2>
        <ol className="mt-3 flex flex-col gap-2 text-[13px] text-chrome-700 list-decimal pl-5">
          <li>Open {PRODUCT.desktopName} and choose <span className="a-mono">Sign in</span>. It shows a short code.</li>
          <li>Go to <span className="a-mono">Device approvals</span> in this console and approve that code.</li>
          <li>The app receives a long-lived token, stored in your OS keychain. No password is ever entered in the app.</li>
        </ol>
      </section>
    </div>
  );
}
