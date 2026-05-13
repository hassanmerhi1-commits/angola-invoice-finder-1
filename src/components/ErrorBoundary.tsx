import React from 'react';
import { useLanguage } from '@/i18n';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorBoundaryFallback
          message={this.state.error?.message}
          onReset={() => {
            this.setState({ hasError: false, error: null });
            window.location.href = '/';
          }}
        />
      );
    }
    return this.props.children;
  }
}

/** Requires `LanguageProvider` above `ErrorBoundary` in App (see App.tsx). */
function ErrorBoundaryFallback({ message, onReset }: { message?: string; onReset: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <div className="max-w-md text-center space-y-4">
        <h2 className="text-xl font-bold text-destructive">{t.errorBoundaryUi.unexpected}</h2>
        <p className="text-muted-foreground text-sm">
          {message || t.errorBoundaryUi.defaultMessage}
        </p>
        <button
          type="button"
          onClick={onReset}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm"
        >
          {t.errorBoundaryUi.backHome}
        </button>
      </div>
    </div>
  );
}
