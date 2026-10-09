/**
 * Every story renders on the void, in the typefaces, at 390px by default.
 */
import type { Preview } from "@storybook/react";
import "../src/fonts.css";
import "./tailwind.css";
import { colors, tokensCss } from "../src/tokens";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    backgrounds: {
      default: "void",
      values: [
        { name: "void", value: colors.void },
        { name: "panel", value: colors.panel },
      ],
    },
    viewport: {
      defaultViewport: "phone390",
      viewports: {
        phone390: { name: "Phone 390×844", styles: { width: "390px", height: "844px" }, type: "mobile" },
        phone430: { name: "Phone 430×932", styles: { width: "430px", height: "932px" }, type: "mobile" },
        tablet: { name: "Tablet 768", styles: { width: "768px", height: "1024px" }, type: "tablet" },
      },
    },
    controls: { expanded: true },
  },
  decorators: [
    (Story) => (
      <>
        <style>{tokensCss}</style>
        <div className="min-h-screen bg-void bg-void-radial font-mono text-text antialiased">
          <div className="mx-auto w-full max-w-[390px] px-4 py-4">
            <Story />
          </div>
        </div>
      </>
    ),
  ],
};

export default preview;
