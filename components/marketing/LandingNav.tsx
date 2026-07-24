"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { Brand } from "@/components/shell/Brand";
import { ButtonLink } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth";

const LINKS = [
  { label: "Platform", href: "#platform" },
  { label: "Registry", href: "#registry" },
  { label: "Security", href: "#security" },
  { label: "Company", href: "#company" },
];

export function LandingNav() {
  const { session } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-colors",
        scrolled ? "border-edge bg-canvas/90 backdrop-blur" : "border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link href="/">
          <Brand subtitle={false} />
        </Link>
        <nav className="hidden items-center gap-7 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-semibold text-fg-muted transition-colors hover:text-fg"
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {session ? (
            <ButtonLink href="/overview" variant="primary" size="sm">
              Open console
            </ButtonLink>
          ) : (
            <>
              <ButtonLink href="/login" variant="ghost" size="sm" className="hidden sm:inline-flex">
                Sign in
              </ButtonLink>
              <ButtonLink href="#demo" variant="primary" size="sm">
                Request a demo
              </ButtonLink>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
