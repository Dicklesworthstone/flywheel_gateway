import { AlertTriangle, RefreshCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  correlationId: string | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, correlationId: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const correlationId = extractCorrelationId(error);
    return { hasError: true, error, correlationId };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", {
      error: error.message,
      correlationId: extractCorrelationId(error),
      componentStack: errorInfo.componentStack,
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, correlationId: null });
  };

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="error-boundary">
          <div className="error-boundary__icon">
            <AlertTriangle size={32} />
          </div>
          <h2 className="error-boundary__title">Something went wrong</h2>
          <p className="error-boundary__message">
            {this.state.error?.message ?? "An unexpected error occurred."}
          </p>
          {this.state.correlationId ? (
            <p className="error-boundary__reference">
              Reference: <code>{this.state.correlationId}</code>
            </p>
          ) : null}
          <button
            type="button"
            className="primary-button"
            onClick={this.handleRetry}
          >
            <RefreshCw size={16} />
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

function extractCorrelationId(error: Error): string | null {
  const cause = error.cause as Record<string, unknown> | undefined;
  if (cause && typeof cause === "object" && "correlationId" in cause) {
    return String(cause["correlationId"]);
  }
  if ("correlationId" in error) {
    return String((error as Record<string, unknown>)["correlationId"]);
  }
  return null;
}
