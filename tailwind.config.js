/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        twitch: {
          dark: "#0e0e10",
          sidebar: "#18181b",
          card: "#1f1f23",
          hover: "#26262c",
          elevated: "#2a2a30",
          border: "#2d2d34",
          purple: "#9146ff",
          purpleHover: "#772ce8",
          purpleLight: "#a970ff",
          purpleAccent: "#bf94ff",
          live: "#eb0400",
          emerald: "#00f59b",
          amber: "#f5a623",
        },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
