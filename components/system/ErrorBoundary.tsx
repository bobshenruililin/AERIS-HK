"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Fallback = ReactNode | ((error: Error, reset: () => void) => ReactNode);

interface Props {
  children: ReactNode;
  fallback?: Fallback;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      const fallback = this.props.fallback;
      if (typeof fallback === "function") {
        return fallback(this.state.error, this.reset);
      }
      if (fallback != null) return fallback;
      return (
        <div
          className="flex h-full min-h-[8rem] flex-col items-center justify-center gap-2 bg-[#05070c] px-4 text-center text-[11px] text-slate-400"
          data-testid="error-boundary"
        >
          <div className="font-mono text-amber-200">Renderer contained</div>
          <div>{this.state.error.message}</div>
          <button
            type="button"
            className="rounded-full border border-cyan-300/30 px-3 py-1 text-cyan-100"
            onClick={this.reset}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
