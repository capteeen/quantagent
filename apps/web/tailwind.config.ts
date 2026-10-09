import type { Config } from "tailwindcss";
import preset from "@quantagent/ui/tailwind-preset";

const config: Config = {
  presets: [preset as Config],
  content: ["./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};

export default config;
