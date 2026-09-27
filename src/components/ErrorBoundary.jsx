import React from 'react';

export default class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Uncaught application rendering error:', error, errorInfo);
  }

  handleReset = () => {
    try {
      window.sessionStorage.clear();
    } catch (error) {
      console.warn('Could not clear temporary session state during recovery:', error);
    }
    // Re-enter through the protected workspace so Firebase persistence can restore the session.
    // The app router will send signed-out visitors back to the public landing page.
    window.location.href = '/dashboard';
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main
        role="alert"
        style={{
          minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px',
          color: '#e5edf9', background: 'radial-gradient(circle at top, #132746 0, #070b14 55%)',
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
        }}
      >
        <section style={{ maxWidth: '440px', textAlign: 'center', padding: '36px', borderRadius: '24px', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
          <div aria-hidden="true" style={{ fontSize: '36px', marginBottom: '12px' }}>✦</div>
          <h1 style={{ margin: '0 0 10px', fontSize: '24px', fontWeight: 750 }}>Zulora AI ran into a problem</h1>
          <p style={{ margin: '0 0 24px', color: '#a9b7cc', lineHeight: 1.6 }}>Reload the app to restore your workspace.</p>
          <button
            type="button"
            onClick={this.handleReset}
            style={{ border: 0, borderRadius: '12px', padding: '12px 20px', color: '#07111e', background: 'linear-gradient(110deg,#7dd3fc,#38bdf8)', fontWeight: 700, cursor: 'pointer' }}
          >
            Reload App
          </button>
        </section>
      </main>
    );
  }
}
