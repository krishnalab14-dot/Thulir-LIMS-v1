import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Field, TextInput } from '../components/ui';
import { api } from '../lib/api';

interface OrgSettings {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  nablAccreditationNumber: string | null;
  gstNumber: string | null;
  logoUrl: string | null;
}

export function Settings() {
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Form fields
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [nablNumber, setNablNumber] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [logoUrl, setLogoUrl] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.get<OrgSettings>('/settings/organization');
      setSettings(data);
      setAddress(data.address ?? '');
      setPhone(data.phone ?? '');
      setEmail(data.email ?? '');
      setNablNumber(data.nablAccreditationNumber ?? '');
      setGstNumber(data.gstNumber ?? '');
      setLogoUrl(data.logoUrl ?? '');
    } catch {
      setError('Could not load organization settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const updated = await api.put<OrgSettings>('/settings/organization', {
        address: address.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        nablAccreditationNumber: nablNumber.trim() || undefined,
        gstNumber: gstNumber.trim() || undefined,
        logoUrl: logoUrl.trim() || undefined,
      });
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to save';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-12 text-center text-[13px] text-slate-400">Loading settings…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Organization Settings</h1>
        <p className="mt-1 text-[13px] text-slate-500">
          Configure printable letterhead details used in Reports, Invoices, and the Approval preview.
        </p>
      </div>

      {/* Lab identity */}
      <Card>
        <div className="border-b border-slate-100 bg-brand-700 px-5 py-3">
          <h2 className="text-[12px] font-bold uppercase tracking-wide text-white">Lab Identity</h2>
        </div>
        <div className="p-5">
          <div className="rounded-md bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
            Lab Name: <span className="font-semibold text-slate-800">{settings?.name}</span>
            <span className="ml-2 text-[11px] text-slate-400">(set during registration, not editable here)</span>
          </div>
        </div>
      </Card>

      {/* Printable Details */}
      <Card>
        <div className="border-b border-slate-100 bg-brand-700 px-5 py-3">
          <h2 className="text-[12px] font-bold uppercase tracking-wide text-white">Printable Details</h2>
        </div>
        <div className="space-y-4 p-5">
          <Field label="Lab Address" className="sm:col-span-2">
            <TextInput
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street address, city, state, PIN code"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone">
              <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91-XXXXXXXXXX" />
            </Field>
            <Field label="Email">
              <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="lab@example.com" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="NABL Accreditation Number">
              <TextInput value={nablNumber} onChange={(e) => setNablNumber(e.target.value)} placeholder="e.g. TC-1234" />
            </Field>
            <Field label="GST Number">
              <TextInput value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} placeholder="e.g. 29AAAAA0000A1Z5" />
            </Field>
          </div>

          <Field label="Logo URL">
            <TextInput
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
            />
            {logoUrl && (
              <div className="mt-2 flex items-center gap-3">
                <img
                  src={logoUrl}
                  alt="Logo preview"
                  className="h-16 w-auto rounded border border-slate-200 object-contain bg-white"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
                <span className="text-[11px] text-slate-400">Preview</span>
              </div>
            )}
          </Field>
        </div>
      </Card>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save} disabled={saving} className="px-5">
          {saving ? 'Saving…' : 'Save Settings'}
        </Button>
        {saved && <span className="text-[13px] font-medium text-emerald-700">✓ Saved</span>}
        {error && <span className="text-[13px] text-rose-600">{error}</span>}
      </div>
    </div>
  );
}
