import { Component } from 'react';

const isDev = import.meta.env.DEV;

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // Log to console in dev, could send to error tracking service in production
    if (isDev) {
      console.error('ErrorBoundary caught:', error, errorInfo);
    }
  }

  handleCopyError = () => {
    const { error, errorInfo } = this.state;
    const text = [
      `Error: ${error?.message || 'Unknown error'}`,
      `Stack: ${error?.stack || 'No stack'}`,
      `Component Stack: ${errorInfo?.componentStack || 'No component stack'}`,
      `URL: ${window.location.href}`,
      `Time: ${new Date().toISOString()}`,
    ].join('\n\n');
    navigator.clipboard.writeText(text).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    });
  };

  handleReset = () => {
    this.setState({ error: null, errorInfo: null });
  };

  render() {
    if (this.state.error) {
      const { error, errorInfo, copied } = this.state;
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="max-w-md w-full text-center">
            <div className="w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <h2 className="text-lg font-bold text-slate-800 mb-2">Algo salió mal</h2>
            <p className="text-sm text-slate-500 mb-4">
              {error?.message || "Error inesperado"}
            </p>
            
            {isDev && error?.stack && (
              <div className="mb-4 text-left bg-slate-100 rounded-xl p-3 max-h-40 overflow-auto">
                <pre className="text-xs text-slate-600 whitespace-pre-wrap break-words">{error.stack}</pre>
              </div>
            )}

            <div className="flex gap-2 justify-center flex-wrap">
              <button
                onClick={this.handleReset}
                className="px-4 py-2.5 bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-300 min-h-[44px]"
              >
                Intentar de nuevo
              </button>
              <button
                onClick={() => { this.setState({ error: null }); window.location.reload(); }}
                className="px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 min-h-[44px]"
              >
                Recargar app
              </button>
            </div>
            
            <button
              onClick={this.handleCopyError}
              className="mt-3 text-xs text-slate-400 hover:text-slate-600 underline"
            >
              {copied ? '✓ Copiado' : 'Copiar detalles del error'}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
