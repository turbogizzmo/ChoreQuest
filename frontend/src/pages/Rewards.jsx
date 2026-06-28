import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useSettings } from '../hooks/useSettings';
import Modal from '../components/Modal';
import Inventory from './Inventory';
import Wishlist from './Wishlist';
import AvatarShop from './AvatarShop';
import {
  ShoppingBag,
  Plus,
  Pencil,
  Trash2,
  Coins,
  Package,
  Sparkles,
  Star,
  Palette,
  Filter,
  Loader2,
} from 'lucide-react';

const emptyForm = {
  title: '',
  description: '',
  point_cost: 50,
  icon: '',
  stock: '',
  category: '',
};

const TABS = [
  { key: 'shop', label: 'Shop', icon: ShoppingBag },
  { key: 'avatar', label: 'Avatar', icon: Palette },
  { key: 'inventory', label: 'Inventory', icon: Package },
  { key: 'wishlist', label: 'Wishlist', icon: Star },
];

export default function Rewards() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, updateUser } = useAuth();
  const { ai_quest_generation: aiEnabled } = useSettings();
  const isParent = user?.role === 'parent' || user?.role === 'admin';
  const isKid = user?.role === 'kid';

  const activeTab = searchParams.get('tab') || 'shop';
  const setTab = (key) => setSearchParams(key === 'shop' ? {} : { tab: key }, { replace: true });

  const [rewards, setRewards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editingReward, setEditingReward] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiCostBasis, setAiCostBasis] = useState('');

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [redeemingId, setRedeemingId] = useState(null);
  const [redeemMessage, setRedeemMessage] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const userXp = user?.points_balance ?? 0;

  const fetchRewards = useCallback(async () => {
    try {
      setError('');
      const data = await api('/api/rewards');
      setRewards(Array.isArray(data) ? data : data.rewards || data.items || []);
    } catch (err) {
      setError(err.message || 'Failed to load rewards.');
    }
  }, []);

  useEffect(() => {
    fetchRewards().finally(() => setLoading(false));
  }, [fetchRewards]);

  useEffect(() => {
    const handler = () => { fetchRewards(); };
    window.addEventListener('ws:message', handler);
    return () => window.removeEventListener('ws:message', handler);
  }, [fetchRewards]);

  if (activeTab === 'avatar') {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <TabBar activeTab={activeTab} setTab={setTab} />
        <AvatarShop />
      </div>
    );
  }
  if (activeTab === 'inventory') {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <TabBar activeTab={activeTab} setTab={setTab} />
        <Inventory />
      </div>
    );
  }
  if (activeTab === 'wishlist') {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <TabBar activeTab={activeTab} setTab={setTab} />
        <Wishlist />
      </div>
    );
  }

  const openCreateModal = () => {
    setEditingReward(null);
    setForm({ ...emptyForm });
    setFormError('');
    setShowAi(false);
    setAiPrompt('');
    setAiError('');
    setAiCostBasis('');
    setShowModal(true);
  };

  const openEditModal = (reward) => {
    setEditingReward(reward);
    setForm({
      title: reward.title || '',
      description: reward.description || '',
      point_cost: reward.point_cost ?? reward.cost ?? 50,
      icon: reward.icon || '',
      stock: reward.stock != null ? String(reward.stock) : '',
      category: reward.category || '',
    });
    setFormError('');
    setShowAi(false);
    setAiPrompt(
      [reward.title, reward.description, reward.category]
        .filter(Boolean)
        .join(' — ')
        .slice(0, 500)
    );
    setAiError('');
    setAiCostBasis('');
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingReward(null);
    setFormError('');
    setShowAi(false);
    setAiLoading(false);
    setAiError('');
    setAiCostBasis('');
  };

  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      setFormError('Name is required.');
      return;
    }
    if (Number(form.point_cost) < 1) {
      setFormError('Cost must be at least 1 XP.');
      return;
    }

    setSubmitting(true);
    setFormError('');

    const body = {
      title: form.title.trim(),
      description: form.description.trim(),
      point_cost: Number(form.point_cost),
      icon: form.icon || undefined,
      category: form.category.trim() || undefined,
    };

    if (form.stock !== '') {
      body.stock = Number(form.stock);
    }

    try {
      if (editingReward) {
        await api(`/api/rewards/${editingReward.id}`, { method: 'PUT', body });
      } else {
        await api('/api/rewards', { method: 'POST', body });
      }
      closeModal();
      await fetchRewards();
    } catch (err) {
      setFormError(err.message || 'Could not save the reward.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGenerate = async () => {
    const prompt = aiPrompt.trim();
    if (prompt.length < 3) {
      setAiError('Describe the reward idea in a few words first.');
      return;
    }
    setAiLoading(true);
    setAiError('');
    try {
      const draft = await api('/api/rewards/generate', {
        method: 'POST',
        body: { prompt },
      });
      setForm((prev) => ({
        ...prev,
        title: draft.title ?? prev.title,
        description: draft.description ?? prev.description,
        point_cost: draft.point_cost ?? prev.point_cost,
        icon: draft.icon ?? prev.icon,
        category: draft.category ?? prev.category,
      }));
      setAiCostBasis(draft.cost_basis ?? '');
    } catch (err) {
      setAiError(err.message || 'The oracle could not draft this reward.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api(`/api/rewards/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      await fetchRewards();
    } catch (err) {
      setError(err.message || 'Failed to remove the reward.');
    } finally {
      setDeleting(false);
    }
  };

  const handleRedeem = async (reward) => {
    setRedeemingId(reward.id);
    setRedeemMessage('');
    try {
      await api(`/api/rewards/${reward.id}/redeem`, { method: 'POST' });
      const cost = reward.point_cost ?? reward.cost ?? 0;
      updateUser({ points_balance: (user?.points_balance ?? 0) - cost });
      setRedeemMessage(`Claimed "${reward.title}". Check your inventory.`);
      await fetchRewards();
    } catch (err) {
      setRedeemMessage(err.message || 'Redemption failed.');
    } finally {
      setRedeemingId(null);
    }
  };

  const canAfford = (reward) => {
    return userXp >= (reward.point_cost ?? reward.cost ?? 0);
  };

  const isOutOfStock = (reward) => {
    return reward.stock != null && reward.stock <= 0;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="text-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <TabBar activeTab={activeTab} setTab={setTab} />

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h1 className="text-cream text-lg font-semibold">
          Rewards Shop
        </h1>
        {isParent && (
          <button
            onClick={openCreateModal}
            className="game-btn game-btn-blue flex items-center gap-1.5"
          >
            <Plus size={14} />
            Add Reward
          </button>
        )}
      </div>

      {isKid && (
        <div className="game-panel p-4">
          <div className="flex items-center gap-3">
            <Coins size={20} className="text-gold" />
            <div>
              <p className="text-muted text-xs">Your balance</p>
              <p className="text-gold text-base font-semibold">{userXp.toLocaleString()} XP</p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="p-2.5 rounded-md border border-crimson/40 bg-crimson/10 text-crimson text-sm">
          {error}
        </div>
      )}

      {(() => {
        const categories = [...new Set(rewards.map(r => r.category).filter(Boolean))];
        if (categories.length === 0) return null;
        return (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <Filter size={13} className="text-muted flex-shrink-0" />
            <button
              onClick={() => setCategoryFilter('all')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
                categoryFilter === 'all'
                  ? 'bg-accent/15 text-accent border-accent/25'
                  : 'text-muted border-border hover:text-cream'
              }`}
            >
              All
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
                  categoryFilter === cat
                    ? 'bg-accent/15 text-accent border-accent/25'
                    : 'text-muted border-border hover:text-cream'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        );
      })()}

      {redeemMessage && (
        <div
          className={`p-2.5 rounded-md border text-sm ${
            redeemMessage.toLowerCase().includes('fail') ||
            redeemMessage.toLowerCase().includes('insufficient')
              ? 'border-crimson/40 bg-crimson/10 text-crimson'
              : 'border-emerald/40 bg-emerald/10 text-emerald'
          }`}
        >
          {redeemMessage}{' '}
          {!redeemMessage.toLowerCase().includes('fail') &&
            !redeemMessage.toLowerCase().includes('insufficient') && (
              <button
                onClick={() => setTab('inventory')}
                className="underline font-medium hover:opacity-80 transition-opacity"
              >
                View Inventory
              </button>
            )}
        </div>
      )}

      {(() => {
        const filtered = categoryFilter === 'all' ? rewards : rewards.filter(r => r.category === categoryFilter);
        return filtered;
      })().length === 0 && rewards.length > 0 ? (
        <div className="game-panel p-8 text-center">
          <p className="text-muted text-sm">No rewards in this category.</p>
          <button
            onClick={() => setCategoryFilter('all')}
            className="text-accent text-xs mt-2 hover:underline"
          >
            Show all
          </button>
        </div>
      ) : rewards.length === 0 ? (
        <div className="game-panel p-8 text-center">
          <p className="text-muted text-sm">No rewards available yet.</p>
          {isParent && (
            <button
              onClick={openCreateModal}
              className="game-btn game-btn-blue mt-3 inline-flex items-center gap-1.5"
            >
              <Plus size={14} />
              Add first reward
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(categoryFilter === 'all' ? rewards : rewards.filter(r => r.category === categoryFilter)).map((reward) => {
            const outOfStock = isOutOfStock(reward);
            const affordable = canAfford(reward);
            const cost = reward.point_cost ?? reward.cost ?? 0;

            return (
              <div
                key={reward.id}
                className={`game-panel p-4 flex flex-col gap-2 ${outOfStock ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start gap-2.5">
                  <div className="w-10 h-10 rounded-md bg-surface-raised border border-border flex items-center justify-center flex-shrink-0">
                    {reward.icon ? (
                      <span className="text-xl">{reward.icon}</span>
                    ) : (
                      <Sparkles size={18} className="text-accent" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-cream text-sm font-medium">{reward.title}</h3>
                    {reward.description && (
                      <p className="text-muted text-xs mt-0.5">{reward.description}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1">
                    <Coins size={14} className="text-gold" />
                    <span className="text-gold text-sm font-medium">{cost} XP</span>
                  </div>
                  {reward.category && (
                    <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium border border-border bg-surface-raised text-muted">
                      {reward.category}
                    </span>
                  )}
                </div>

                {reward.stock != null && (
                  <div className="flex items-center gap-1.5">
                    <Package size={12} className={outOfStock ? 'text-crimson' : 'text-muted'} />
                    {outOfStock ? (
                      <span className="text-crimson text-xs font-medium">Sold Out</span>
                    ) : (
                      <span className="text-muted text-xs">{reward.stock} left</span>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-1.5 mt-auto pt-1">
                  {isKid && (
                    <button
                      onClick={() => handleRedeem(reward)}
                      disabled={!affordable || outOfStock || redeemingId === reward.id}
                      className={`game-btn game-btn-gold flex-1 flex items-center justify-center gap-1.5 ${
                        !affordable || outOfStock ? 'opacity-40 cursor-not-allowed' : ''
                      } ${redeemingId === reward.id ? 'opacity-60 cursor-wait' : ''}`}
                    >
                      <Coins size={12} />
                      {redeemingId === reward.id
                        ? 'Claiming...'
                        : !affordable
                        ? 'Not Enough XP'
                        : outOfStock
                        ? 'Sold Out'
                        : 'Redeem'}
                    </button>
                  )}
                  {isParent && (
                    <>
                      <button
                        onClick={() => openEditModal(reward)}
                        className="p-1.5 rounded-md hover:bg-surface-raised transition-colors text-muted hover:text-accent"
                        aria-label="Edit reward"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(reward)}
                        className="p-1.5 rounded-md hover:bg-surface-raised transition-colors text-muted hover:text-crimson"
                        aria-label="Delete reward"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editingReward ? 'Edit Reward' : 'New Reward'}
        actions={[
          { label: 'Cancel', onClick: closeModal, className: 'game-btn game-btn-red' },
          {
            label: submitting ? 'Saving...' : editingReward ? 'Update' : 'Add Reward',
            onClick: handleSubmit,
            className: 'game-btn game-btn-gold',
            disabled: submitting,
          },
        ]}
      >
        <div className="space-y-3">
          {formError && (
            <div className="p-2 rounded-md border border-crimson/40 bg-crimson/10 text-crimson text-sm">{formError}</div>
          )}
          {isParent && aiEnabled && (
            <div>
              <button
                type="button"
                onClick={() => setShowAi(!showAi)}
                className="flex items-center gap-2 text-accent text-sm hover:text-accent/80 transition-colors"
              >
                <Sparkles size={14} />
                {showAi
                  ? 'Hide AI helper'
                  : editingReward
                    ? 'Rewrite with AI'
                    : 'Research with AI'}
              </button>
              {showAi && (
                <div className="mt-3 space-y-2 border border-border rounded-lg p-3 bg-surface-raised/30">
                  <p className="text-muted text-xs">
                    Paste a kid&apos;s wish, product idea, expected price, or reward notes. The AI will draft the copy and suggest XP from an estimated real-world cost when it applies.
                  </p>
                  <p className="text-muted text-xs">
                    Up to 5 generations every 5 minutes. Avoid names or private family details.
                  </p>
                  <textarea
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="e.g. LEGO Minecraft wolf set from Sam's wish list, around $18, make it sound exciting"
                    rows={3}
                    maxLength={500}
                    className="field-input resize-none"
                  />
                  {aiError && (
                    <p className="text-crimson text-xs">{aiError}</p>
                  )}
                  {aiCostBasis && !aiError && (
                    <p className="text-muted text-xs">
                      AI cost check: {aiCostBasis}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={aiLoading}
                    className="game-btn game-btn-gold flex items-center gap-2"
                  >
                    <Sparkles size={14} />
                    {aiLoading ? 'Consulting the oracle...' : editingReward ? 'Rewrite Reward' : 'Draft Reward'}
                  </button>
                </div>
              )}
            </div>
          )}
          <div>
            <label className="block text-cream text-sm font-medium mb-1">Name</label>
            <input type="text" value={form.title} onChange={(e) => updateForm('title', e.target.value)} placeholder="Extra Screen Time" className="field-input" />
          </div>
          <div>
            <label className="block text-cream text-sm font-medium mb-1">Description</label>
            <textarea value={form.description} onChange={(e) => updateForm('description', e.target.value)} placeholder="What does this reward grant?" rows={3} className="field-input resize-none" />
          </div>
          <div>
            <label className="block text-cream text-sm font-medium mb-1">Cost (XP)</label>
            <input type="number" min={1} value={form.point_cost} onChange={(e) => updateForm('point_cost', e.target.value)} className="field-input" />
          </div>
          <div>
            <label className="block text-cream text-sm font-medium mb-1">Icon (Emoji)</label>
            <input type="text" value={form.icon} onChange={(e) => updateForm('icon', e.target.value)} placeholder="e.g. trophy, star, gift" className="field-input" />
          </div>
          <div>
            <label className="block text-cream text-sm font-medium mb-1">Category (Optional)</label>
            <input type="text" value={form.category} onChange={(e) => updateForm('category', e.target.value)} placeholder="e.g. Treats, Experiences" className="field-input" />
          </div>
          <div>
            <label className="block text-cream text-sm font-medium mb-1">Stock (Optional)</label>
            <input type="number" min={0} value={form.stock} onChange={(e) => updateForm('stock', e.target.value)} placeholder="Leave empty for unlimited" className="field-input" />
            <p className="text-muted text-xs mt-1">Leave empty for unlimited supply.</p>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Remove Reward"
        actions={[
          { label: 'Cancel', onClick: () => setDeleteTarget(null), className: 'game-btn game-btn-blue' },
          { label: deleting ? 'Removing...' : 'Remove', onClick: handleDelete, className: 'game-btn game-btn-red', disabled: deleting },
        ]}
      >
        <p className="text-muted">
          Remove <span className="text-gold font-medium">"{deleteTarget?.title}"</span> from the shop?
        </p>
      </Modal>
    </div>
  );
}

function TabBar({ activeTab, setTab }) {
  return (
    <div className="flex gap-0.5 border-b border-border">
      {TABS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          onClick={() => setTab(key)}
          className={`flex items-center gap-1.5 py-2 px-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === key
              ? 'border-accent text-accent'
              : 'border-transparent text-muted hover:text-cream'
          }`}
        >
          <Icon size={14} className="shrink-0" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
