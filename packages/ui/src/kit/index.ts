/**
 * The phone-first kit (SPEC §6.8). Every component is designed at 390px,
 * styled with Tailwind on the ui preset, and has an honest empty and failed
 * state. Nothing here invents content.
 */
export { ConnectCard, type ConnectCardProps, type ConnectKind } from "./ConnectCard";
export { PromptBox, PROMPT_PLACEHOLDER, type PromptBoxProps } from "./PromptBox";
export { LaunchButton, type LaunchButtonProps } from "./LaunchButton";
export { ThreadStrip, STATUS_LABEL, type ThreadStripProps } from "./ThreadStrip";
export { WorkerSheet, ProofViewer, type WorkerSheetProps } from "./WorkerSheet";
export { ApprovalCard, SWIPE_THRESHOLD_PX, type ApprovalCardProps } from "./ApprovalCard";
export { CoinCard, type CoinCardProps, type Fetched } from "./CoinCard";
export { ShieldReport, type ShieldReportProps } from "./ShieldReport";
export { LogRow, workerOfEvent, externalRefsOf, type LogRowProps, type ExternalRef, type Cluster } from "./LogRow";
export { EmptyState, type EmptyStateProps } from "./EmptyState";
export { AutopilotToggle, ACTION_CLASSES, AUTOPILOT_COPY, type AutopilotToggleProps } from "./AutopilotToggle";
export { Footer, FOOTER_TEXT, type FooterProps } from "./Footer";
export { copyText, shortKey, fmtTime, explorerTxUrl, explorerAccountUrl, pumpFunUrl, xPostUrl } from "./primitives";
