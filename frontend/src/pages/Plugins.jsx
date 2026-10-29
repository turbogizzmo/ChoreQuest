import { useState, useEffect, useCallback, useMemo } from 'react';
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
  Plus,
  Trash2,
  X,
  Search,
  Users,
  Wand2,
} from 'lucide-react';

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const MAC_RE = /^([0-9a-f]{2}[:-]?){5}[0-9a-f]{2}$|^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i;

// Mirrors parse_address() on the server, only for the little badge.
function addressKind(address) {
  const value = (address || '').trim();
  if (!value) return null;
  if (IPV4_RE.test(value) || (value.includes(':') && !MAC_RE.test(value))) return 'IP';
  if (MAC_RE.test(value)) return 'MAC';
  return 'Name';
}

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

// Turn stored config into editable form values.
function toDraft(plugin) {
  const draft = { ...plugin.config };
  for (const field of plugin.fields) {
    if (field.type === 'secret') draft[field.key] = '';
  }
  // Most people open ChoreQuest by its LAN IP — offer that as the server IP.
  if ('chorequest_address' in draft && !draft.chorequest_address && IPV4_RE.test(window.location.hostname)) {
    draft.chorequest_address = window.location.hostname;
  }
  return draft;
}

function Toggle({ enabled, onChange, label }) {
  return (
    <button
      type="button"
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

const REMEMBER_BY = [
  { key: 'mac', label: 'Device ID', help: 'Recommended. Keeps working when the device gets a new IP. (Uses its MAC address.)' },
  { key: 'ip', label: 'IP address', help: 'Best for devices with a fixed IP set up on pfSense.' },
  { key: 'hostname', label: 'Name', help: "Uses the name the device gives itself on your network. Devices without one use their Device ID." },
];

function NetworkPicker({ pluginKey, draft, existing, onPick, onClose }) {
  const [devices, setDevices] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [rememberBy, setRememberBy] = useState('mac');

  useEffect(() => {
    api(`/api/plugins/${pluginKey}/network-devices`, { method: 'POST', body: { config: draft } })
      .then((res) => setDevices(res.devices))
      .catch((err) => setError(err.message));
    // Only load once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginKey]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (devices || []).filter((d) =>
      !q || `${d.name} ${d.ip} ${d.mac}`.toLowerCase().includes(q));
  }, [devices, query]);

  const addressFor = (d) => d[rememberBy] || d.mac;

  return (
    <div className="rounded-md border border-accent/30 bg-surface-raised/40 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Search size={14} className="text-muted flex-shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search devices on your network"
          className="field-input !w-auto !p-1.5 text-xs flex-1 min-w-0"
          autoFocus
        />
        <button type="button" onClick={onClose} className="text-muted hover:text-cream" aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-muted">Remember by</span>
          {REMEMBER_BY.map((opt) => (
            <button
              type="button"
              key={opt.key}
              onClick={() => setRememberBy(opt.key)}
              className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                rememberBy === opt.key ? 'bg-accent/20 border-accent/50 text-cream' : 'border-border text-muted hover:text-cream'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted/80 mt-1 leading-relaxed">
          {REMEMBER_BY.find((o) => o.key === rememberBy).help}
        </p>
      </div>
      {error && <p className="text-crimson text-xs">{error}</p>}
      {!devices && !error && (
        <div className="flex justify-center py-3"><Loader2 size={16} className="text-accent animate-spin" /></div>
      )}
      {devices && shown.length === 0 && <p className="text-muted text-xs py-2">No devices found.</p>}
      <div className="max-h-64 overflow-y-auto divide-y divide-border/50">
        {shown.map((d) => {
          const added = [d.mac, d.ip, d.hostname].some((a) => a && existing.has(a.toLowerCase()));
          const address = addressFor(d);
          return (
            <button
              type="button"
              key={d.mac}
              disabled={added}
              onClick={() => onPick({ id: newId(), name: d.name || d.ip, address })}
              className="w-full flex items-center gap-2 py-2 text-left disabled:opacity-40 hover:bg-accent/5"
            >
              <span className={`h-2 w-2 rounded-full flex-shrink-0 ${d.online ? 'bg-emerald' : 'bg-muted/40'}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-cream truncate">{d.name || 'Unnamed device'}</span>
                <span className="block text-[10px] text-muted font-mono truncate">
                  {/* What will be saved comes first, highlighted */}
                  {[address, ...[d.ip, d.mac].filter((part) => part && part !== address)]
                    .map((part, i) => (
                      <span key={part}>
                        {i > 0 && ' · '}
                        <span className={part === address ? 'text-accent' : ''}>{part}</span>
                      </span>
                    ))}
                </span>
              </span>
              {added ? <CheckCircle2 size={14} className="text-emerald" /> : <Plus size={14} className="text-accent" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DeviceGroupCard({ group, kids, canPick, pluginKey, draft, onChange, onRemove }) {
  const [picking, setPicking] = useState(false);
  const devices = group.devices || [];
  const update = (patch) => onChange({ ...group, ...patch });
  const setDevice = (i, patch) => update({ devices: devices.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  const toggleKid = (id) => update({
    kid_ids: group.kid_ids.includes(id) ? group.kid_ids.filter((k) => k !== id) : [...group.kid_ids, id],
  });

  return (
    <div className="rounded-md border border-border bg-surface-raised/30 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={group.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="Group name, e.g. Alice's devices"
          className="field-input !w-auto !p-2 text-sm font-semibold flex-1 min-w-0"
        />
        <button type="button" onClick={onRemove} className="text-muted hover:text-crimson p-1" aria-label="Remove group">
          <Trash2 size={15} />
        </button>
      </div>

      <div>
        <p className="text-xs text-muted mb-1.5">Offline until these kids finish their quests:</p>
        <div className="flex flex-wrap gap-1.5">
          {kids.map((kid) => {
            const on = group.kid_ids.includes(kid.id);
            return (
              <button
                type="button"
                key={kid.id}
                onClick={() => toggleKid(kid.id)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  on ? 'bg-accent/20 border-accent/50 text-cream' : 'border-border text-muted hover:text-cream'
                }`}
              >
                {kid.display_name}
              </button>
            );
          })}
          {kids.length === 0 && <span className="text-xs text-muted">No heroes yet.</span>}
        </div>
      </div>

      <div className="space-y-2">
        {devices.length === 0 && !picking && (
          <p className="text-xs text-muted">No devices yet.</p>
        )}
        {devices.map((device, i) => {
          const kind = addressKind(device.address);
          return (
            <div key={device.id || i} className="flex items-center gap-1.5">
              <input
                type="text"
                value={device.name || ''}
                onChange={(e) => setDevice(i, { name: e.target.value })}
                placeholder="iPad"
                className="field-input !w-24 !p-1.5 text-xs flex-shrink-0"
              />
              <input
                type="text"
                value={device.address || ''}
                onChange={(e) => setDevice(i, { address: e.target.value })}
                placeholder="IP, MAC or device name"
                className="field-input !w-auto !p-1.5 text-xs font-mono flex-1 min-w-0"
              />
              {kind && (
                <span className="text-[9px] px-1.5 py-0.5 rounded border border-border text-muted flex-shrink-0">
                  {kind}
                </span>
              )}
              <button
                type="button"
                onClick={() => update({ devices: devices.filter((_, j) => j !== i) })}
                className="text-muted hover:text-crimson p-1 flex-shrink-0"
                aria-label="Remove device"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}

        {picking && (
          <NetworkPicker
            pluginKey={pluginKey}
            draft={draft}
            existing={new Set(devices.map((d) => (d.address || '').toLowerCase()))}
            onPick={(d) => update({ devices: [...devices, d] })}
            onClose={() => setPicking(false)}
          />
        )}

        <div className="flex flex-wrap gap-2">
          {canPick && !picking && (
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="game-btn game-btn-blue flex items-center gap-1.5 !text-xs !py-1.5 !px-3"
            >
              <Search size={12} /> Pick from network
            </button>
          )}
          <button
            type="button"
            onClick={() => update({ devices: [...devices, { id: newId(), name: '', address: '' }] })}
            className="game-btn game-btn-purple flex items-center gap-1.5 !text-xs !py-1.5 !px-3"
          >
            <Plus size={12} /> Type one in
          </button>
        </div>
      </div>
    </div>
  );
}

function DeviceGroupsField({ field, value, onChange, kids, plugin, draft }) {
  const groups = value || [];
  const setGroup = (i, g) => onChange(groups.map((x, j) => (j === i ? g : x)));

  const onePerKid = () => onChange([
    ...groups,
    ...kids
      .filter((kid) => !groups.some((g) => g.kid_ids.length === 1 && g.kid_ids[0] === kid.id))
      .map((kid) => ({ id: newId(), name: `${kid.display_name}'s devices`, kid_ids: [kid.id], devices: [] })),
  ]);

  return (
    <div>
      <span className="text-sm text-cream">{field.label}</span>
      {field.help && <p className="text-xs text-muted/70 mt-1 leading-relaxed">{field.help}</p>}
      <div className="space-y-3 mt-2">
        {groups.map((group, i) => (
          <DeviceGroupCard
            key={group.id || i}
            group={group}
            kids={kids}
            canPick={plugin.lists_network_devices}
            pluginKey={plugin.key}
            draft={draft}
            onChange={(g) => setGroup(i, g)}
            onRemove={() => onChange(groups.filter((_, j) => j !== i))}
          />
        ))}
        <div className="flex flex-wrap gap-2">
          {groups.length === 0 && kids.length > 0 && (
            <button
              type="button"
              onClick={onePerKid}
              className="game-btn game-btn-blue flex items-center gap-1.5 !text-xs !py-1.5 !px-3"
            >
              <Users size={12} /> One group per kid
            </button>
          )}
          <button
            type="button"
            onClick={() => onChange([...groups, { id: newId(), name: '', kid_ids: [], devices: [] }])}
            className="game-btn game-btn-purple flex items-center gap-1.5 !text-xs !py-1.5 !px-3"
          >
            <Plus size={12} /> Add group
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ field, value, onChange, secretSet }) {
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
  const groups = status.details?.groups || [];
  const warnings = status.details?.warnings || [];
  return (
    <div className={`p-3 rounded-md border text-xs space-y-2 ${
      status.ok ? 'border-emerald/30 bg-emerald/5' : 'border-amber-500/30 bg-amber-500/5'
    }`}>
      <div className="flex items-start gap-2">
        {status.ok
          ? <CheckCircle2 size={14} className="text-emerald flex-shrink-0 mt-0.5" />
          : <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />}
        <div className="min-w-0">
          <p className={status.ok ? 'text-emerald' : 'text-amber-500'}>{status.message}</p>
          {warnings.map((w) => <p key={w} className="text-amber-500 mt-1">{w}</p>)}
          {status.at && <p className="text-muted/70 mt-0.5">Last checked {new Date(status.at).toLocaleTimeString()}</p>}
        </div>
      </div>
      {groups.length > 0 && (
        <div className="divide-y divide-border/50">
          {groups.map((group) => (
            <div key={group.id} className="py-1.5">
              <div className="flex items-center gap-2">
                {group.blocked
                  ? <WifiOff size={13} className="text-crimson flex-shrink-0" />
                  : <Wifi size={13} className="text-emerald flex-shrink-0" />}
                <span className="text-cream truncate">{group.name}</span>
                <span className={`flex-shrink-0 ${group.blocked ? 'text-crimson' : 'text-emerald'}`}>
                  {group.blocked ? 'offline' : 'online'}
                </span>
              </div>
              <p className="text-muted pl-5">{group.reason}</p>
              {group.devices.filter((d) => d.note).map((d) => (
                <p key={d.address} className="text-amber-500/90 pl-5">
                  {d.name || d.address}: {d.note}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PluginCard({ plugin, kids, onSaved }) {
  const [open, setOpen] = useState(plugin.enabled);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [enabled, setEnabled] = useState(plugin.enabled);
  const [draft, setDraft] = useState(() => toDraft(plugin));
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null); // { ok, text }
  const [status, setStatus] = useState(plugin.status);

  const basicFields = plugin.fields.filter((f) => !f.advanced);
  const advancedFields = plugin.fields.filter((f) => f.advanced);

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

  const post = async (name, path) => {
    setBusy(name);
    setMsg(null);
    try {
      const res = await api(path, { method: 'POST', body: { config: draft } });
      setMsg({ ok: res.ok, text: res.message });
      return res;
    } catch (err) {
      setMsg({ ok: false, text: err.message });
      return null;
    } finally {
      setBusy('');
    }
  };

  const runAction = async (action) => {
    const res = await post(action.key, `/api/plugins/${plugin.key}/actions/${action.key}`);
    if (res?.ok && plugin.enabled) {
      setStatus(await api(`/api/plugins/${plugin.key}/sync`, { method: 'POST' }).catch(() => status));
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

  const renderField = (field) => {
    const setValue = (v) => setDraft((d) => ({ ...d, [field.key]: v }));
    if (field.type === 'device_groups') {
      return (
        <DeviceGroupsField
          key={field.key}
          field={field}
          value={draft[field.key]}
          onChange={setValue}
          kids={kids}
          plugin={plugin}
          draft={draft}
        />
      );
    }
    return (
      <Field
        key={field.key}
        field={field}
        value={draft[field.key]}
        secretSet={plugin.secrets_set?.[field.key]}
        onChange={setValue}
      />
    );
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
        type="button"
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

          {basicFields.map(renderField)}

          {advancedFields.length > 0 && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted hover:text-cream transition-colors"
              >
                {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                Advanced settings
              </button>
              {showAdvanced && advancedFields.map(renderField)}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => save()}
              disabled={!!busy}
              className="game-btn game-btn-blue flex items-center gap-2 !text-xs !py-1.5 !px-3"
            >
              {busy === 'save' ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {enabled ? 'Save & sync' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => post('test', `/api/plugins/${plugin.key}/test`)}
              disabled={!!busy}
              className="game-btn game-btn-purple flex items-center gap-2 !text-xs !py-1.5 !px-3"
            >
              {busy === 'test' ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />}
              Test connection
            </button>
            {plugin.enabled && (
              <button
                type="button"
                onClick={syncNow}
                disabled={!!busy}
                className="game-btn game-btn-blue flex items-center gap-2 !text-xs !py-1.5 !px-3"
              >
                {busy === 'sync' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Sync now
              </button>
            )}
          </div>

          {plugin.enabled && plugin.actions.map((action) => (
            <div key={action.key} className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => runAction(action)}
                disabled={!!busy}
                className="game-btn game-btn-purple flex items-center gap-2 !text-xs !py-1.5 !px-3 flex-shrink-0"
              >
                {busy === action.key ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                {action.label}
              </button>
              {action.help && <p className="text-xs text-muted/70 leading-relaxed">{action.help}</p>}
            </div>
          ))}

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
