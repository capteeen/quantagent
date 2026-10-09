"use client";
/**
 * Client-boundary re-exports of the @quantagent/ui kit. The kit's components use
 * hooks and carry no "use client" directive, so server components (the pages,
 * the Shell) import them through this module instead of the package directly.
 */
export { EmptyState, Footer, FOOTER_TEXT } from "@quantagent/ui/kit";
