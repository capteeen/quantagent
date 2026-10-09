/**
 * Storybook (react-vite). Tailwind is wired here on the ui preset so the
 * package needs no postcss/tailwind config file of its own.
 */
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import preset from "../src/tailwind-preset";

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

const config: StorybookConfig = {
  framework: { name: "@storybook/react-vite", options: {} },
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-essentials"],
  core: { disableTelemetry: true },
  viteFinal: async (viteConfig) => ({
    ...viteConfig,
    css: {
      ...viteConfig.css,
      postcss: {
        plugins: [
          tailwindcss({
            presets: [preset],
            content: [here("../src/**/*.{ts,tsx}"), here("./**/*.{ts,tsx}")],
          }),
          autoprefixer(),
        ],
      },
    },
  }),
};

export default config;
