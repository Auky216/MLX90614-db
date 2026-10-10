/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        ink: "#171716",
        paper: "#FFFFFF",
        canvas: "#F6F6F4",
        mist: "#EFEFEB",
        line: "#DFDFD9",
        graphite: "#666661"
      }
    }
  },
  plugins: []
};
