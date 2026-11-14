import type { Config } from "tailwindcss";

// v8b design tokens (artifacts/ui-mockup/DESIGN_SYSTEM_v8b.md). Values live as CSS variables in
// app/globals.css; names here are the Tailwind aliases (e.g. bg-paper, text-ink-2, bg-tint-mint).
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
        amber: "var(--amber)",
        info: "var(--info)",
        "info-bg": "var(--info-bg)",
        "info-rule": "var(--info-rule)",
        navy: "var(--navy)",
        "navy-2": "var(--navy-2)",
        "navy-rule": "var(--navy-rule)",
        sand: "var(--sand)",
        night: "var(--night)",
        "night-2": "var(--night-2)",
        "night-rule": "var(--night-rule)",
        "tint-rose": "var(--tint-rose)",
        "tint-slate": "var(--tint-slate)",
        "tint-mint": "var(--tint-mint)",
      },
      fontFamily: {
        sans: ["var(--font-geist)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
        display: ["var(--font-archivo)", "var(--font-geist)", "sans-serif"],
      },
      fontSize: {
        // Nothing on the web below 13px (design system v8b).
        xs: ["13px", { lineHeight: "1.45" }],
      },
      borderRadius: {
        // Corner rules: content cards 16px, data panels/tables/receipts/code 4px,
        // status tags 6px, inputs 10px, buttons/chips pill.
        card: "16px",
        data: "4px",
        tag: "6px",
        input: "10px",
      },
    },
  },
  plugins: [],
};
export default config;
