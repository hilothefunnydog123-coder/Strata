import type { Config } from "tailwindcss";

/**
 * Tailwind handles layout only. The design system (reserved colors, the citation
 * highlight, document surfaces) lives in @assent/ui/styles.css. A few tokens are
 * mirrored here as CSS-var-backed colors for convenience.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "var(--a-paper)",
        ink: "var(--a-ink)",
        chrome: {
          50: "var(--a-chrome-050)",
          100: "var(--a-chrome-100)",
          200: "var(--a-chrome-200)",
          300: "var(--a-chrome-300)",
          500: "var(--a-chrome-500)",
          700: "var(--a-chrome-700)",
          900: "var(--a-chrome-900)",
        },
        citation: "var(--a-citation)",
      },
      fontFamily: {
        serif: ["var(--a-font-serif)"],
        sans: ["var(--a-font-sans)"],
        mono: ["var(--a-font-mono)"],
      },
      maxWidth: { reading: "68ch" },
    },
  },
  plugins: [],
};
export default config;
