import { Icon } from '../Icon';

export function EmptyData({ what, file }: { what: string; file: string }) {
  const dev = new URLSearchParams(location.search).has('fixtures');
  return (
    <div className="panel-body empty">
      <div className="empty-icon"><Icon name="database" size={22} /></div>
      <p><b>No {what} yet.</b></p>
      <p className="muted">The data pipeline writes <code>public/data/{file}</code>. It is missing or empty in this build, so there is nothing to show. Nothing is invented to fill the gap.</p>
      {!dev && <p className="muted small">Developers: append <code>?fixtures=1</code> to the URL to load clearly labelled synthetic fixtures for UI work.</p>}
    </div>
  );
}
