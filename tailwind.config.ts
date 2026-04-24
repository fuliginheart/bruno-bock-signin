import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        signin: {
          DEFAULT: "#16a34a", // green-600
          fill: "#22c55e",
        },
        signout: {
          DEFAULT: "#dc2626", // red-600
          fill: "#ef4444",
        },
      },
      fontFamily: {
        sans: ["system-ui", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
