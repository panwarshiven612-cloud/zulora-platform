import React from 'react';

export default class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Uncaught application rendering error:', error, errorInfo);
  }

  handleReload = () => {
    const removeStorageKey = key => {
      try { window.localStorage.removeItem(key); }
      catch { /* Storage may be disabled; still navigate to the clean app route. */ }
    };

    removeStorageKey('activeChatId');
    removeStorageKey('zulora_state');

    try {
      const activeChatKeys = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith('zulora_active_chat_')) activeChatKeys.push(key);
      }
      activeChatKeys.forEach(removeStorageKey);
    } catch { /* A storage access failure should not block the recovery navigation. */ }

    this.setState({ hasError: false, error: null });
    window.location.href = '/';
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
            onClick={this.handleReload}
            style={{ border: 0, borderRadius: '12px', padding: '12px 20px', color: '#07111e', background: 'linear-gradient(110deg,#7dd3fc,#38bdf8)', fontWeight: 700, cursor: 'pointer' }}
          >
            Reload App
          </button>
        </section>
      </main>
    );
  }
}
