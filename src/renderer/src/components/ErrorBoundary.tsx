
import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
        if (this.props.fallback) return this.props.fallback;
        return (
            <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-xl">
                <h3 className="text-red-400 font-bold mb-2">Something went wrong</h3>
                <pre className="text-xs text-red-300/80 overflow-auto max-h-40 whitespace-pre-wrap">
                    {this.state.error?.message}
                    {'\n'}
                    {this.state.error?.stack}
                </pre>
            </div>
        )
    }

    return this.props.children;
  }
}
