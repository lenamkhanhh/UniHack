import type { Config } from "tailwindcss";

// v6 design tokens. Values live as CSS variables in app/globals.css; names here are the
// Tailwind aliases (e.g. bg-paper, text-ink-2, border-rule, bg-paid-bg, text-blocked).
const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        card: "var(--card)",
        ink: "var(--ink)",
        "ink-2": "var(--ink-2)",
        "ink-3": "var(--ink-3)",
        rule: "var(--rule)",
        "rule-2": "var(--rule-2)",
        mist: "var(--mist)",
        "mist-2": "var(--mist-2)",
        chalk: "var(--chalk)",
        brand: "var(--brand)",
        "brand-deep": "var(--brand-deep)",
        paid: "var(--paid)",
        "paid-bg": "var(--paid-bg)",
        "paid-rule": "var(--paid-rule)",
        blocked: "var(--blocked)",
        "blocked-bg": "var(--blocked-bg)",
        "blocked-rule": "var(--blocked-rule)",
        warn: "var(--warn)",
        "warn-bg": "var(--warn-bg)",
        "warn-rule": "var(--warn-rule)",
        sand: "var(--sand)",
        night: "var(--night)",
        "night-2": "var(--night-2)",
        "night-rule": "var(--night-rule)",
        "tint-rose": "var(--tint-rose)",
        "tint-slate": "var(--tint-slate)",
      },
      fontFamily: {
        sans: ["var(--font-geist)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "14px",
      },
    },
  },
  plugins: [],
};
export default config;
