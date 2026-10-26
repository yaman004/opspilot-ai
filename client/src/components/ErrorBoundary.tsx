import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Last-resort screen for rendering crashes. Plain styles so it works even if the theme failed to load. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>Something broke on this page</h1>
          <p style={{ color: '#627183', margin: '0 0 16px' }}>
            The error has been logged to the browser console. Reloading usually fixes it; if it keeps happening, tell your administrator what you were doing.
          </p>
          <button onClick={() => window.location.assign('/app')} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #d8dfe6', cursor: 'pointer' }}>
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }
}
