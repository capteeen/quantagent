/**
 * A billboard label in the scene: DOM text positioned by three (drei Html), so it uses the
 * real JetBrains Mono from fonts.css and never a glyph texture. Used for candidate names,
 * the 48px thumbnails, the proof hash, the tx signature, the CA and the site URL.
 */
import type { CSSProperties, ReactNode } from "react";
import { Html } from "@react-three/drei";

export const MONO = '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';

export interface LabelProps {
  position: [number, number, number];
  children: ReactNode;
  color?: string;
  size?: number;
  interactive?: boolean;
  onClick?: (() => void) | undefined;
  style?: CSSProperties;
  title?: string;
  testId?: string;
}

export function Label({ position, children, color = "#D7DEE6", size = 11, interactive = false, onClick, style, title, testId }: LabelProps) {
  return (
    <Html position={position} center zIndexRange={[20, 0]} style={{ pointerEvents: interactive ? "auto" : "none" }}>
      <div
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={onClick}
        onKeyDown={(e) => {
          if (interactive && onClick && (e.key === "Enter" || e.key === " ")) onClick();
        }}
        title={title}
        data-testid={testId}
        style={{
          fontFamily: MONO,
          fontSize: size,
          lineHeight: 1.2,
          color,
          whiteSpace: "nowrap",
          userSelect: "none",
          cursor: interactive ? "pointer" : "default",
          minHeight: interactive ? 44 : undefined,
          minWidth: interactive ? 44 : undefined,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textShadow: "0 0 6px rgba(6,8,10,0.9)",
          ...style,
        }}
      >
        {children}
      </div>
    </Html>
  );
}
