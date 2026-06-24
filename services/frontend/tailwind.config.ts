import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Instrument Serif", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        ink: "#121311",
        "ink-soft": "#55564E",
        "ink-faint": "#8A8B82",
        paper: "#FFFFFF",
        "paper-soft": "#F3F4F1",
        card: "#FFFFFF",
        night: "#0B0F0C",
        "night-soft": "#10160F",
        line: "rgba(18,19,17,0.12)",
        "line-light": "rgba(255,255,255,0.16)",
        // Mova brand — emerald (the single accent colour)
        signal: "#16A35B",
        "signal-bright": "#34D27E",
        "signal-deep": "#0A6E3E",
        // shadcn token layer (used by /components/ui/* — maps onto the Mova palette)
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
      },
      borderRadius: {
        card: "8px",
        pill: "6px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(18,19,17,0.05), 0 22px 44px -28px rgba(18,19,17,0.22)",
        soft: "0 1px 2px rgba(18,19,17,0.05), 0 10px 28px -20px rgba(18,19,17,0.20)",
      },
      maxWidth: {
        shell: "1320px",
      },
      transitionTimingFunction: {
        editorial: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
