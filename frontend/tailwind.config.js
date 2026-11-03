import tailwindcssAnimate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
    darkMode: ["class"],
    content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
    "./utils/**/*.{js,ts,jsx,tsx}",
    "./docs/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
  	extend: {
      colors: {
        os: {
          bg: "var(--bg-base)",
          elev1: "var(--bg-elev-1)",
          elev2: "var(--bg-elev-2)",
          elev3: "var(--bg-elev-3)",
          text: "var(--text-primary)",
          muted: "var(--text-muted)",
          strokeSoft: "var(--stroke-soft)",
          strokeMedium: "var(--stroke-medium)",
          strokeStrong: "var(--stroke-strong)",
          accentStart: "var(--accent-start)",
          accentMid: "var(--accent-mid)",
          accentEnd: "var(--accent-end)"
        },
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        primary: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-on)'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'hsl(var(--accent-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))'
        }
      },
      spacing: {
        "os-1": "4px",
        "os-2": "8px",
        "os-3": "12px",
        "os-4": "16px",
        "os-6": "24px",
        "os-8": "32px",
        "os-12": "48px",
        "os-16": "64px"
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        "os-sm": "8px",
        "os-md": "12px",
        "os-lg": "16px",
        "os-xl": "20px",
        "os-pill": "100px"
      },
      boxShadow: {
        "os-ambient": "0 4px 24px rgba(0,0,0,0.3)",
        "os-elevated": "0 8px 40px rgba(0,0,0,0.4)",
        "os-glow": "0 0 30px var(--accent-glow)",
        "os-focus": "0 0 0 3px var(--accent-glow),0 0 30px var(--accent-glow)"
      }
  	}
  },
  plugins: [tailwindcssAnimate],
}
