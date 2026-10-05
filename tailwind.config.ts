import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1E1E1C",
        paper: "#FAFAF8",
        line: "#E4E2DD",
        muted: "#8A8578",
        signal: {
          DEFAULT: "#0F7A78",
          dark: "#0B5C5A",
          light: "#E4F3F2",
        },
        status: {
          delivered: "#1F9D55",
          pending: "#C98A1F",
          failed: "#C1443D",
          optedout: "#8A8578",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(32,30,26,.05), 0 12px 32px -22px rgba(32,30,26,.30)",
        lift: "0 2px 6px rgba(32,30,26,.08), 0 18px 44px -24px rgba(15,122,120,.40)",
      },
    },
  },
  plugins: [],
};

export default config;
