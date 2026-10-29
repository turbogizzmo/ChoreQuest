import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import {
  Puzzle,
  ArrowLeft,
  Loader2,
  Save,
  Plug,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  WifiOff,
  Wifi,
  Shield,
} from 'lucide-react';

// Turn stored config into editable form values (device lists become text).
function toDraft(plugin) {
  const draft = { ...plugin.config };
  for (const field of plugin.fields) {
    if (field.type === 'secret') draft[field.key] = '';
    if (field.type === 'kid_devices') {
      const devices = plugin.config[field.key] || {};
      draft[field.key] = Object.fromEntries(
        Object.entries(devices).map(([kidId, ips]) => [kidId, (ips || []).join(', ')]),
      );
    }
  }
  return draft;
}

function Toggle({ enabled, onChange, label }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors flex-shrink-0 ${
        enabled ? 'bg-accent/30 border-accent/40' : 'bg-navy border-border'
      }`}
      aria-label={label}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full transition-transform ${
          enabled ? 'translate-x-6 bg-accent' : 'translate-x-1 bg-muted/60'
        }`}
      />
    </button>
  );
}

function Field({ field, value, onChange, kids, secretSet }) {
  const help = field.help && <p className="text-xs text-muted/70 mt-1 leading-relaxed">{field.help}</p>;

  if (field.type === 'bool') {
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm text-cream">{field.label}</span>
          {help}
        </div>
        <Toggle enabled={!!value} onChange={onChange} label={`Toggle ${field.label}`} />
      </div>
    );
  }

  if (field.type === 'kid_devices') {
    const devices = value || {};
    return (
      <div>
        <span className="text-sm text-cream">{field.label}</span>
        {help}
        <div className="space-y-2 mt-2">
          {kids.length === 0 && <p className="text-muted text-xs">No heroes yet.</p>}
          {kids.map((kid) => (
            <div key={kid.id} className="flex items-center gap-2">
              <span className="text-xs text-cream w-20 truncate flex-shrink-0">{kid.display_name}</span>
              <input
                type="text"
                value={devices[kid.id] ?? ''}
                onChange={(e) => onChange({ ...devices, [kid.id]: e.target.value })}
                placeholder="192.168.1.50, 192.168.1.51"
                className="field-input !p-2 text-xs font-mono flex-1 min-w-0"
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  let input;
  if (field.type === 'select') {
    input = (
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="field-input !p-2 text-sm">
        {field.options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  } else {
    const type = { secret: 'password', time: 'time', number: 'number' }[field.type] || 'text';
    input = (
      <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.type === 'secret' && secretSet ? '•••••••• (saved)' : field.placeholder}
        autoComplete={field.type === 'secret' ? 'new-password' : 'off'}
        className="field-input !p-2 text-sm"
      />
    );
  }
  return (
    <label className="block">
      <span className="text-sm text-cream">
        {field.label}
        {field.required && <span className="text-crimson"> *</span>}
      </span>
      <div className="mt-1">{input}</div>
      {help}
    </label>
  );
}

function StatusPanel({ status }) {
  if (!status) return null;
  const kids = status.details?.kids || [];
  return (
    <div className={`p-3 rounded-md border text-xs space-y-2 ${
      status.ok ? 'border-emerald/30 bg-emerald/5' : 'border-crimson/30 bg-crimson/5'
    }`}>
      <div className="flex items-start gap-2">
        {status.ok
          ? <CheckCircle2 size={14} className="text-emerald flex-shrink-0 mt-0.5" />
          : <AlertTriangle size={14} className="text-crimson flex-shrink-0 mt-0.5" />}
        <div className="min-w-0">
          <p className={status.ok ? 'text-emerald' : 'text-crimson'}>{status.message}</p>
          {status.at && <p className="text-muted/70 mt-0.5">Last sync {new Date(status.at).toLocaleTimeString()}</p>}
        </div>
      </div>
      {kids.length > 0 && (
        <div className="divide-y divide-border/50">
          {kids.map((kid) => (
            <div key={kid.user_id} className="flex items-center gap-2 py-1.5">
              {kid.blocked
                ? <WifiOff size={13} className="text-crimson flex-shrink-0" />
                : <Wifi size={13} className="text-emerald flex-shrink-0" />}
              <span className="text-cream w-20 truncate">{kid.display_name}</span>
              <span className="text-muted truncate">{kid.reason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PluginCard({ plugin, kids, onSaved }) {
  const [open, setOpen] = useState(plugin.enabled);
  const [enabled, setEnabled] = useState(plugin.enabled);
  const [draft, setDraft] = useState(() => toDraft(plugin));
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null); // { ok, text }
  const [status, setStatus] = useState(plugin.status);

  const save = async (nextEnabled = enabled) => {
    setBusy('save');
    setMsg(null);
    try {
      const updated = await api(`/api/plugins/${plugin.key}`, {
        method: 'PUT',
        body: { enabled: nextEnabled, config: draft },
      });
      setEnabled(updated.enabled);
      setDraft(toDraft(updated));
      setStatus(updated.status);
      setMsg({ ok: true, text: updated.enabled ? 'Saved and synced.' : 'Saved. Plugin is off.' });
      onSaved(updated);
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    setBusy('test');
    setMsg(null);
    try {
      const res = await api(`/api/plugins/${plugin.key}/test`, { method: 'POST', body: { config: draft } });
      setMsg({ ok: res.ok, text: res.message });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy('');
    }
  };

  const syncNow = async () => {
    setBusy('sync');
    try {
      setStatus(await api(`/api/plugins/${plugin.key}/sync`, { method: 'POST' }));
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy('');
    }
  };

  const toggle = (value) => {
    setOpen(true);
    if (!value && plugin.enabled) {
      // Turning off takes effect immediately — that's when devices are unblocked.
      save(false);
    } else {
      setEnabled(value);
    }
  };

  return (
    <div className="game-panel p-4 space-y-4">
      <div className="flex items-start gap-3">
        <Plug size={18} className={enabled ? 'text-accent mt-0.5' : 'text-muted mt-0.5'} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-cream text-sm font-semibold">{plugin.name}</h2>
            <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-border text-muted">
              {plugin.category}
            </span>
          </div>
          <p className="text-muted text-xs mt-1 leading-relaxed">{plugin.description}</p>
        </div>
        <Toggle enabled={enabled} onChange={toggle} label={`Enable ${plugin.name}`} />
      </div>

      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs text-muted hover:text-cream transition-colors"
      >
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {open ? 'Hide settings' : 'Settings'}
      </button>

      {open && (
        <div className="space-y-4">
          {plugin.setup_steps.length > 0 && (
            <ol className="list-decimal pl-5 space-y-1.5 text-xs text-muted leading-relaxed">
              {plugin.setup_steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          )}

          {plugin.fields.map((field) => (
            <Field
              key={field.key}
              field={field}
              value={draft[field.key]}
              kids={kids}
              secretSet={plugin.secrets_set?.[field.key]}
              onChange={(v) => setDraft((d) => ({ ...d, [field.key]: v }))}
            />
          ))}

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => save()}
              disabled={!!busy}
              className="game-btn game-btn-blue flex items-center gap-2 !text-xs !py-1.5 !px-3"
            >
              {busy === 'save' ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {enabled ? 'Save & sync' : 'Save'}
            </button>
            <button
              onClick={test}
              disabled={!!busy}
              className="game-btn game-btn-purple flex items-center gap-2 !text-xs !py-1.5 !px-3"
            >
              {busy === 'test' ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />}
              Test connection
            </button>
            {plugin.enabled && (
              <button
                onClick={syncNow}
                disabled={!!busy}
                className="game-btn game-btn-blue flex items-center gap-2 !text-xs !py-1.5 !px-3"
              >
                {busy === 'sync' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Sync now
              </button>
            )}
          </div>
          {msg && <p className={`text-xs ${msg.ok ? 'text-emerald' : 'text-crimson'}`}>{msg.text}</p>}
        </div>
      )}

      {(plugin.enabled || status) && <StatusPanel status={status} />}
    </div>
  );
}

export default function Plugins() {
  const navigate = useNavigate();
  const [plugins, setPlugins] = useState(null);
  const [kids, setKids] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [list, kidList] = await Promise.all([api('/api/plugins'), api('/api/stats/kids')]);
      setPlugins(list);
      setKids(kidList || []);
    } catch (err) {
      setError(err.message || 'Failed to load plugins');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSaved = (updated) => {
    setPlugins((prev) => prev.map((p) => (p.key === updated.key ? updated : p)));
  };

  return (
    <div className="w-full max-w-2xl mx-auto overflow-hidden">
      <button
        onClick={() => navigate('/settings')}
        className="flex items-center gap-1.5 text-muted hover:text-cream transition-colors mb-4 text-sm"
      >
        <ArrowLeft size={16} />
        Family Settings
      </button>
      <div className="flex items-center gap-3 mb-2">
        <Puzzle size={24} className="text-cream" />
        <h1 className="text-cream text-lg font-semibold">Plugins</h1>
      </div>
      <p className="text-muted text-xs mb-6 leading-relaxed">
        Optional add-ons that connect ChoreQuest to other things in your home. Every plugin is
        off until you turn it on.
      </p>

      {error && (
        <div className="game-panel p-8 text-center">
          <Shield size={48} className="text-crimson/30 mx-auto mb-4" />
          <p className="text-crimson text-sm">{error}</p>
        </div>
      )}

      {!plugins && !error && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="text-accent animate-spin" />
        </div>
      )}

      {plugins && (
        <div className="space-y-4">
          {plugins.map((plugin) => (
            <PluginCard key={plugin.key} plugin={plugin} kids={kids} onSaved={onSaved} />
          ))}
        </div>
      )}
    </div>
  );
}
