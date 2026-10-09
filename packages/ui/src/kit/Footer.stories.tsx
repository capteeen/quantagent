import type { Meta, StoryObj } from "@storybook/react";
import { Footer } from "./Footer";

const meta: Meta<typeof Footer> = { title: "Kit/Footer", component: Footer };
export default meta;
type S = StoryObj<typeof Footer>;

export const Default: S = { args: {} };
