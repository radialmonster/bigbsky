import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  // Optional label so nested boundaries can log which subtree failed.
  label?: string;
  // Optional custom fallback; falls back to the default reload UI when absent.
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render/lifecycle errors in its subtree so one bad record can't
 * whitescreen the whole reader. BigBsky renders untrusted remote Bluesky records
 * (post text, facets, embeds), so a malformed record or an unexpected undefined
 * deep in a post card is a realistic failure mode, not a theoretical one —
 * without a boundary React unmounts the entire tree and leaves #root blank.
 *
 * The default fallback is intentionally self-contained (inline styles, no app
 * context, no app components) so it still renders even if the failure is broad.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const where = this.props.label ? ` (${this.props.label})` : "";
    console.error(`BigBsky render error${where}:`, error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }
    return (
      <div
        role="alert"
        style={{
          maxWidth: "36rem",
          margin: "4rem auto",
          padding: "1.5rem",
          fontFamily: "system-ui, sans-serif",
          lineHeight: 1.5,
          color: "inherit",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", margin: "0 0 0.5rem" }}>Something went wrong</h1>
        <p style={{ margin: "0 0 1rem", opacity: 0.8 }}>
          BigBsky hit an unexpected error while rendering this view. Reloading usually clears it.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "999px",
              border: "1px solid currentColor",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            Reload
          </button>
          <button
            type="button"
            onClick={this.reset}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "999px",
              border: "1px solid transparent",
              background: "transparent",
              color: "inherit",
              opacity: 0.7,
              cursor: "pointer",
              font: "inherit",
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
