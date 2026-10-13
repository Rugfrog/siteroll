import { useEffect, useState } from 'react';
import { api, fileToJpeg, useApi } from '../api';
import { useMe } from '../App';
import { Icon } from '../icons';
import { ActionButton, Card, ErrorBox, Field, Loading, PageHead, useToast } from '../ui';

export default function Settings() {
  const state = useApi<any>('/api/agency');
  const { reload } = useMe();
  const toast = useToast();
  const [f, setF] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (state.data) setF(state.data);
  }, [state.data]);
  if (!f) return state.error ? <ErrorBox error={state.error} /> : <Loading rows={8} />;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.put('/api/agency', f);
      await reload();
      toast('Settings saved');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <PageHead title="Settings" sub="Your agency's details and branding. They appear on dashboards, posters, invoices and texts.">
        <button className="btn btn-primary" form="settings-form">
          Save settings
        </button>
      </PageHead>
      {error && <ErrorBox error={error} />}
      <form id="settings-form" onSubmit={save} className="grid grid-main mt">
        <div className="stack">
          <Card title="Agency" pad>
            <div className="form-grid">
              <Field label="Agency name">
                <input className="input" value={f.name} onChange={set('name')} required />
              </Field>
              <Field label="Office phone" hint="shown to workers">
                <input className="input" value={f.phone} onChange={set('phone')} />
              </Field>
              <Field label="Email">
                <input className="input" type="email" value={f.email} onChange={set('email')} />
              </Field>
            </div>
            <Field label="Address">
              <input className="input" value={f.address} onChange={set('address')} />
            </Field>
          </Card>
          <Card title="Invoices" sub="Printed on every invoice." pad>
            <div className="form-grid">
              <Field label="VAT number">
                <input className="input" value={f.vat_number} onChange={set('vat_number')} />
              </Field>
              <Field label="Company number">
                <input className="input" value={f.company_number} onChange={set('company_number')} />
              </Field>
              <Field label="Payment terms (days)">
                <input className="input" type="number" min={0} max={120} value={f.payment_terms_days} onChange={set('payment_terms_days')} />
              </Field>
              <Field label="Bank">
                <input className="input" value={f.bank_name} onChange={set('bank_name')} />
              </Field>
              <Field label="Sort code">
                <input className="input" value={f.bank_sort_code} onChange={set('bank_sort_code')} placeholder="12-34-56" />
              </Field>
              <Field label="Account number">
                <input className="input" value={f.bank_account} onChange={set('bank_account')} />
              </Field>
            </div>
          </Card>
          <Card title="Privacy" pad>
            <Field label="Delete sign-in selfies after (days)" hint="UK GDPR: keep them no longer than you need">
              <input className="input" type="number" min={7} max={730} value={f.photo_retention_days} onChange={set('photo_retention_days')} style={{ maxWidth: 160 }} />
            </Field>
            <p className="small muted" style={{ margin: '10px 0 0' }}>
              Checked once a day. Card photos are deleted when a worker is marked as having left. Location is only read at the moment someone signs in or out.
            </p>
          </Card>
        </div>
        <div className="stack">
          <Card title="Branding" pad>
            <div className="stack">
              <Field label="Brand colour">
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input type="color" value={f.brand_colour} onChange={set('brand_colour')} aria-label="Pick a colour" style={{ width: 48, height: 40, border: 0, background: 'none', padding: 0 }} />
                  <input className="input" value={f.brand_colour} onChange={set('brand_colour')} style={{ fontFamily: 'monospace' }} />
                </div>
              </Field>
              <div className="row" style={{ gap: 6 }}>
                {['#0e6655', '#1d4ed8', '#7c2d12', '#6d28d9', '#b45309', '#be123c', '#15171c'].map((c) => (
                  <button key={c} type="button" onClick={() => setF({ ...f, brand_colour: c })} aria-label={`Use ${c}`} style={{ width: 28, height: 28, borderRadius: 8, background: c, border: f.brand_colour === c ? '3px solid #fff' : 0, boxShadow: '0 0 0 1px var(--line)', cursor: 'pointer' }} />
                ))}
              </div>
              <div>
                <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
                  Logo
                </div>
                <div className="row">
                  <div style={{ width: 120, height: 64, borderRadius: 10, border: '1px dashed var(--line)', display: 'grid', placeItems: 'center', background: '#fff', overflow: 'hidden' }}>
                    {f.hasLogo ? <img src={`/files/logo?v=${f.logo_path}`} alt="Current logo" style={{ maxWidth: '100%', maxHeight: '100%' }} /> : <span className="tiny muted">No logo</span>}
                  </div>
                  <label className="btn btn-sm">
                    <Icon name="camera" /> Upload
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      className="sr-only"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const image = file.type === 'image/png' ? await readAsDataUrl(file) : await fileToJpeg(file, 800, 0.9);
                          await api.post('/api/agency/logo', { image });
                          await state.reload();
                          await reload();
                          toast('Logo saved');
                        } catch (err) {
                          toast((err as Error).message, true);
                        }
                      }}
                    />
                  </label>
                  {f.hasLogo && (
                    <ActionButton
                      className="btn btn-sm btn-ghost"
                      onClick={async () => {
                        await api.post('/api/agency/logo', { image: null });
                        await state.reload();
                        await reload();
                      }}
                    >
                      Remove
                    </ActionButton>
                  )}
                </div>
                <p className="tiny muted">PNG or JPEG. Used on posters, PDFs and the sign-in page.</p>
              </div>
              <div className="card" style={{ overflow: 'hidden' }} aria-hidden="true">
                <div style={{ background: f.brand_colour, color: '#fff', padding: '10px 14px', fontWeight: 700 }}>{f.name}</div>
                <div className="small muted" style={{ padding: '8px 14px' }}>
                  Preview of the poster and PDF header
                </div>
              </div>
            </div>
          </Card>
          <Card title="Agency staff">
            <ul className="list">
              {f.users.map((u: any) => (
                <li key={u.id}>
                  <div className="grow">
                    <div className="title">{u.name}</div>
                    <div className="tiny muted">{u.email}</div>
                  </div>
                </li>
              ))}
            </ul>
            <p className="small muted card-pad" style={{ margin: 0, borderTop: '1px solid var(--line-2)' }}>
              To add staff, see “Setting up a new agency” in the README.
            </p>
          </Card>
        </div>
      </form>
    </>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Couldn't read that file"));
    r.readAsDataURL(file);
  });
}
