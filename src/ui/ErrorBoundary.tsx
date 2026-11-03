import { Component, type ReactNode } from 'react';
import { Icon } from './Icon';

/** `fallback` replaces the default "panel failed" notice (the map uses it for a missing WebGL). */
export class ErrorBoundary extends Component<{ children: ReactNode; name: string; fallback?: (err: Error) => ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error(`[${this.props.name}]`, err); }
  render() {
    if (this.state.err) {
      if (this.props.fallback) return this.props.fallback(this.state.err);
      return (
        <div className="panel-body">
          <div className="notice warn notice-icon" role="alert"><Icon name="alert" /><span>This panel failed: {this.state.err.message}</span></div>
          <button className="btn-icon-text" onClick={() => this.setState({ err: null })}><Icon name="refresh" size={14} />Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}
