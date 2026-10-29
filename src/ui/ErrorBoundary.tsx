import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode; name: string }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error(`[${this.props.name}]`, err); }
  render() {
    if (this.state.err) {
      return (
        <div className="panel-body">
          <div className="notice warn">This panel failed: {this.state.err.message}</div>
          <button onClick={() => this.setState({ err: null })}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}
