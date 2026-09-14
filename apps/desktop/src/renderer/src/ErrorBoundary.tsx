import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catches render-time exceptions so a bug shows a readable panel instead of a half-mounted
 * layout. Deliberately plain — it must not depend on anything that could itself be the thing
 * that broke, so the colours below are literal hex, not design tokens: a broken stylesheet
 * import or a bad :root must not take this fallback down with it.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Renderer error:", error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 32,
          textAlign: "center",
          color: "#e8ebee",
          background: "#171a1e",
        }}
      >
        <div style={{ color: "#f0745c", fontSize: 16 }}>Something in the interface broke</div>
        <pre
          style={{
            maxWidth: "60ch",
            whiteSpace: "pre-wrap",
            color: "#8c959c",
            fontSize: 12,
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {this.state.error.message}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: "7px 14px",
            background: "#262b30",
            border: "1px solid #3a4249",
            borderRadius: 6,
            color: "#e8ebee",
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
