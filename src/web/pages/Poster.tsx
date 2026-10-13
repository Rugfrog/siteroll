// A4 poster for the site board: QR code + short instructions. The same link goes on an NFC tag.
import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../api';
import { Icon } from '../icons';
import { ErrorBox, Loading } from '../ui';

export default function Poster() {
  const { id } = useParams();
  const state = useApi<any>(`/api/sites/${id}/poster`);
  useEffect(() => {
    if (state.data) document.title = `Poster – ${state.data.siteName}`;
  }, [state.data]);
  if (state.error) return <div className="page"><ErrorBox error={state.error} /></div>;
  if (!state.data) return <Loading />;
  const p = state.data;
  return (
    <div className="poster-wrap">
      <div className="no-print spread" style={{ maxWidth: '210mm', margin: '0 auto 16px' }}>
        <Link to={`/sites/${id}`} className="btn">
          <Icon name="arrowLeft" /> Back to site
        </Link>
        <div className="row">
          <span className="small muted">
            NFC tag? Write this link to it: <code style={{ userSelect: 'all' }}>{p.url}</code>
          </span>
          <button className="btn btn-primary" onClick={() => window.print()}>
            <Icon name="printer" /> Print
          </button>
        </div>
      </div>
      <article className="poster" style={{ ['--brand' as any]: p.agency.colour }}>
        <header className="poster-top">
          <div className="agency">
            {p.agency.hasLogo && <img src="/files/logo" alt="" />}
            {p.agency.name}
          </div>
          <h1>Scan to sign in</h1>
          <div className="site">{p.siteName}</div>
          <div style={{ opacity: 0.85, fontSize: '11pt', marginTop: '1mm' }}>{p.clientName}</div>
        </header>
        <div className="poster-qr">
          <div className="qr" dangerouslySetInnerHTML={{ __html: p.svg }} aria-label="QR code" />
          <div style={{ marginTop: '6mm', fontSize: '14pt', fontWeight: 700 }}>Point your phone camera at the code. No app needed.</div>
        </div>
        <div className="poster-steps">
          <div>
            <b>1</b>Open your camera and point it at the square. Or tap your phone on the tag.
          </div>
          <div>
            <b>2</b>Tap the link, then the big green <strong>Sign in</strong> button.
          </div>
          <div>
            <b>3</b>Going home? Scan again and tap <strong>Sign out</strong>.
          </div>
        </div>
        <footer className="poster-foot">
          <span>First time on this phone? You'll get a text with a 6-digit code.</span>
          <span>
            Problems? Call {p.agency.name} on {p.agency.phone}
          </span>
        </footer>
        <div style={{ padding: '0 16mm 6mm', fontSize: '7.5pt', color: '#555' }}>
          Your location is checked only at the moment you sign in or out, to confirm you're on site. It is never tracked in between. This list is also the site's fire register.
        </div>
      </article>
    </div>
  );
}
