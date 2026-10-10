/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        ink: "#080808",
        paper: "#FFFFFF",
        mist: "#F2F2F2",
        graphite: "#5C5C5C"
      }
    }
  },
  plugins: []
};
