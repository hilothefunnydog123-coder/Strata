import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        raised: "rgb(var(--raised) / <alpha-value>)",
        hover: "rgb(var(--hover) / <alpha-value>)",
        edge: {
          DEFAULT: "rgb(var(--edge) / <alpha-value>)",
          strong: "rgb(var(--edge-strong) / <alpha-value>)",
        },
        fg: {
          DEFAULT: "rgb(var(--fg) / <alpha-value>)",
          muted: "rgb(var(--fg-muted) / <alpha-value>)",
          dim: "rgb(var(--fg-dim) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          soft: "rgb(var(--accent-soft) / <alpha-value>)",
          fg: "rgb(var(--accent-fg) / <alpha-value>)",
        },
        positive: {
          DEFAULT: "rgb(var(--positive) / <alpha-value>)",
          soft: "rgb(var(--positive-soft) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "rgb(var(--warning) / <alpha-value>)",
          soft: "rgb(var(--warning-soft) / <alpha-value>)",
        },
        elevated: {
          DEFAULT: "rgb(var(--elevated) / <alpha-value>)",
          soft: "rgb(var(--elevated-soft) / <alpha-value>)",
        },
        critical: {
          DEFAULT: "rgb(var(--critical) / <alpha-value>)",
          soft: "rgb(var(--critical-soft) / <alpha-value>)",
        },
        info: {
          DEFAULT: "rgb(var(--info) / <alpha-value>)",
          soft: "rgb(var(--info-soft) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "var(--font-mono)",
          "SF Mono",
          "ui-monospace",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "0.875rem", letterSpacing: "0.02em" }],
      },
      boxShadow: {
        panel: "0 1px 2px 0 rgb(0 0 0 / 0.24)",
        raised:
          "0 1px 3px 0 rgb(0 0 0 / 0.4), 0 8px 24px -12px rgb(0 0 0 / 0.5)",
        pop: "0 12px 40px -8px rgb(0 0 0 / 0.55), 0 0 0 1px rgb(var(--edge) / 0.6)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgb(var(--critical) / 0.5)" },
          "70%": { boxShadow: "0 0 0 6px rgb(var(--critical) / 0)" },
          "100%": { boxShadow: "0 0 0 0 rgb(var(--critical) / 0)" },
        },
        "slide-in": {
          from: { opacity: "0", transform: "translateX(8px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "bar-grow": {
          from: { transform: "scaleY(0)" },
          to: { transform: "scaleY(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "pulse-ring": "pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "slide-in": "slide-in 0.25s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
