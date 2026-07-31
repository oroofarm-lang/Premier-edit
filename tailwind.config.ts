import type { Config } from "tailwindcss";

function oklchVar(name: string) {
  return `oklch(var(${name}) / <alpha-value>)`;
}

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      borderRadius: {
        lg: "var(--radius)",
        md: "var(--radius-md)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        mono: ["var(--font-geist-mono)"],
      },
      boxShadow: {
        glow: "0 0 15px rgb(124 58 237 / 0.3)",
        "glow-cyan": "0 0 15px rgb(6 182 212 / 0.25)",
      },
      keyframes: {
        orbit: {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
      },
      animation: {
        orbit: "orbit 1.2s linear infinite",
      },
      colors: {
        success: {
          DEFAULT: oklchVar("--success"),
          foreground: oklchVar("--success-foreground"),
        },
        background: oklchVar("--background"),
        foreground: oklchVar("--foreground"),
        card: {
          DEFAULT: oklchVar("--card"),
          foreground: oklchVar("--card-foreground"),
        },
        popover: {
          DEFAULT: oklchVar("--popover"),
          foreground: oklchVar("--popover-foreground"),
        },
        primary: {
          DEFAULT: oklchVar("--primary"),
          foreground: oklchVar("--primary-foreground"),
        },
        secondary: {
          DEFAULT: oklchVar("--secondary"),
          foreground: oklchVar("--secondary-foreground"),
        },
        muted: {
          DEFAULT: oklchVar("--muted"),
          foreground: oklchVar("--muted-foreground"),
        },
        accent: {
          DEFAULT: oklchVar("--accent"),
          foreground: oklchVar("--accent-foreground"),
        },
        destructive: {
          DEFAULT: oklchVar("--destructive"),
          foreground: oklchVar("--destructive-foreground"),
        },
        border: oklchVar("--border"),
        input: oklchVar("--input"),
        ring: oklchVar("--ring"),
        chart: {
          "1": oklchVar("--chart-1"),
          "2": oklchVar("--chart-2"),
          "3": oklchVar("--chart-3"),
          "4": oklchVar("--chart-4"),
          "5": oklchVar("--chart-5"),
        },
        sidebar: {
          DEFAULT: oklchVar("--sidebar"),
          foreground: oklchVar("--sidebar-foreground"),
          primary: oklchVar("--sidebar-primary"),
          "primary-foreground": oklchVar("--sidebar-primary-foreground"),
          accent: oklchVar("--sidebar-accent"),
          "accent-foreground": oklchVar("--sidebar-accent-foreground"),
          border: oklchVar("--sidebar-border"),
          ring: oklchVar("--sidebar-ring"),
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
