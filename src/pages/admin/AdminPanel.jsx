/**
 * AdminPanel.jsx — Zulora AI Dedicated Admin Dashboard
 * =====================================================
 * Restricted exclusively to authorized admin accounts:
 *   - panwarshiven612@gmail.com
 *   - zulora.help@gmail.com
 *
 * Tabs: User Management | Content Control | Payments & Transactions |
 *       Notifications | Reports & Analytics
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, BarChart2, Bell, Check, ChevronDown, ChevronRight,
  Download, FileText, Loader2, Lock, LogOut, RefreshCw, Send,
  Settings2, Shield, ShieldOff, Sparkles, Trash2, User, Users,
  XCircle, DollarSign, Package, TrendingUp, MessageSquare
} from 'lucide-react';
import { collection, getDocs, doc, updateDoc, query, orderBy, limit, where, Timestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../context/AuthContext';

const ADMIN_EMAILS = new Set(['panwarshiven612@gmail.com', 'zulora.help@gmail.com']);

const TABS = [
  { id: 'users',     label: 'User Management',         icon: Users },
  { id: 'content',   label: 'Content Control',          icon: Package },
  { id: 'payments',  label: 'Payments & Transactions',  icon: DollarSign },
  { id: 'notify',    label: 'Notifications',            icon: Bell },
  { id: 'analytics', label: 'Reports & Analytics',      icon: BarChart2 },
];

// ─── Shared helpers ──────────────────────────────────────────────────────────
const Card = ({ children, className = '' }) => (
  <div className={`rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-5 ${className}`}>
    {children}
  </div>
);

const Pill = ({ label, color = 'sky' }) => {
  const palettes = {
    sky:    'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
    green:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    red:    'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    amber:  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    slate:  'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${palettes[color] || palettes.slate}`}>
      {label}
    </span>
  );
};

const StatCard = ({ icon: Icon, label, value, sub, color = 'sky' }) => (
  <Card className="flex items-center gap-4">
    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-${color}-100 dark:bg-${color}-900/30`}>
      <Icon className={`w-5 h-5 text-${color}-600 dark:text-${color}-400`} />
    </span>
    <span>
      <p className="text-xl font-extrabold text-slate-900 dark:text-white">{value}</p>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      {sub && <p className="text-[10px] text-slate-400 dark:text-slate-500">{sub}</p>}
    </span>
  </Card>
);

// ─── Tab: User Management ────────────────────────────────────────────────────
function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [updating, setUpdating] = useState('');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(100)));
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.warn('[Admin] Failed to fetch users:', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const toggleBlock = async (uid, currentlyBlocked) => {
    setUpdating(uid);
    try {
      await updateDoc(doc(db, 'users', uid), { blocked: !currentlyBlocked, updatedAt: Date.now() });
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, blocked: !currentlyBlocked } : u));
    } catch (e) {
      alert('Failed to update user: ' + e.message);
    } finally {
      setUpdating('');
    }
  };

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    return !q || (u.email || '').toLowerCase().includes(q) || (u.displayName || '').toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or email..."
          className="flex-1 min-w-[200px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        <button onClick={fetchUsers} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Users} label="Total Users" value={users.length} color="sky" />
        <StatCard icon={Check} label="Active" value={users.filter(u => !u.blocked).length} color="green" />
        <StatCard icon={ShieldOff} label="Blocked" value={users.filter(u => u.blocked).length} color="red" />
        <StatCard icon={Sparkles} label="Pro Subscribers" value={users.filter(u => u.isPro || u.plan === 'pro').length} color="amber" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading users...
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Plan</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Joined</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map(user => (
                <tr key={user.id} className="bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    {user.photoURL
                      ? <img src={user.photoURL} alt="" className="w-7 h-7 rounded-full object-cover" />
                      : <span className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 grid place-items-center"><User className="w-3.5 h-3.5 text-slate-500" /></span>
                    }
                    <span className="max-w-[130px] truncate">{user.displayName || 'Anonymous'}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400 max-w-[180px] truncate">{user.email || '—'}</td>
                  <td className="px-4 py-3">
                    <Pill label={user.isPro || user.plan === 'pro' ? 'Pro' : 'Free'} color={user.isPro ? 'amber' : 'slate'} />
                  </td>
                  <td className="px-4 py-3">
                    <Pill label={user.blocked ? 'Blocked' : 'Active'} color={user.blocked ? 'red' : 'green'} />
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {user.createdAt ? new Date(user.createdAt?.seconds ? user.createdAt.seconds * 1000 : user.createdAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      disabled={updating === user.id}
                      onClick={() => toggleBlock(user.id, user.blocked)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${user.blocked
                        ? 'bg-emerald-100 hover:bg-emerald-200 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : 'bg-red-100 hover:bg-red-200 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                      }`}
                    >
                      {updating === user.id
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : user.blocked ? <Check className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />
                      }
                      {user.blocked ? 'Unblock' : 'Block'}
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-slate-400 text-sm">No users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Content Control ────────────────────────────────────────────────────
function ContentControl() {
  const [categories, setCategories] = useState([
    { id: 'chat', label: 'Chat & Q&A', enabled: true, featured: true },
    { id: 'video', label: 'Video Studio', enabled: true, featured: true },
    { id: 'image', label: 'Image Generation', enabled: true, featured: false },
    { id: 'brain', label: 'AI Brain', enabled: true, featured: false },
    { id: 'vault', label: 'Zulora Vault', enabled: true, featured: false },
    { id: 'voice', label: 'Voice Agent', enabled: true, featured: true },
  ]);

  const toggle = (id, field) => {
    setCategories(prev => prev.map(c => c.id === id ? { ...c, [field]: !c[field] } : c));
  };

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3">Feature Categories</h3>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {categories.map(cat => (
            <div key={cat.id} className="flex items-center justify-between py-3">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{cat.label}</span>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
                  <input type="checkbox" checked={cat.enabled} onChange={() => toggle(cat.id, 'enabled')}
                    className="w-3.5 h-3.5 rounded accent-sky-500" />
                  Enabled
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
                  <input type="checkbox" checked={cat.featured} onChange={() => toggle(cat.id, 'featured')}
                    className="w-3.5 h-3.5 rounded accent-amber-500" />
                  Featured
                </label>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-xl">Save Changes</button>
        </div>
      </Card>
    </div>
  );
}

// ─── Tab: Payments & Transactions ────────────────────────────────────────────
function PaymentsTab() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const snap = await getDocs(query(collection(db, 'transactions'), orderBy('createdAt', 'desc'), limit(50)));
        setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch {
        setTransactions([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totalRevenue = transactions.filter(t => t.status === 'success').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
  const successCount = transactions.filter(t => t.status === 'success').length;
  const failedCount  = transactions.filter(t => t.status === 'failed').length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={DollarSign} label="Total Revenue" value={`₹${totalRevenue.toLocaleString()}`} color="green" />
        <StatCard icon={Check} label="Successful" value={successCount} color="sky" />
        <StatCard icon={XCircle} label="Failed" value={failedCount} color="red" />
        <StatCard icon={TrendingUp} label="Total Transactions" value={transactions.length} color="amber" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading transactions...
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs font-bold text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">Plan</th>
                <th className="px-4 py-3 text-left">Amount</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Transaction ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {transactions.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-slate-400 text-sm">No transactions yet.</td></tr>
              )}
              {transactions.map(tx => (
                <tr key={tx.id} className="bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300 max-w-[150px] truncate">{tx.email || tx.userId || '—'}</td>
                  <td className="px-4 py-3"><Pill label={tx.plan || 'Pro'} color="amber" /></td>
                  <td className="px-4 py-3 font-bold text-slate-800 dark:text-slate-200">₹{(tx.amount || 0).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <Pill label={tx.status || 'pending'}
                      color={tx.status === 'success' ? 'green' : tx.status === 'failed' ? 'red' : 'amber'} />
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {tx.createdAt ? new Date(tx.createdAt?.seconds ? tx.createdAt.seconds * 1000 : tx.createdAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs font-mono max-w-[120px] truncate">{tx.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => {
            const csv = ['Email,Plan,Amount,Status,Date,TxID',
              ...transactions.map(t => `${t.email || ''},${t.plan || ''},${t.amount || 0},${t.status || ''},${t.createdAt ? new Date(t.createdAt?.seconds ? t.createdAt.seconds * 1000 : t.createdAt).toISOString() : ''},${t.id}`)
            ].join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url;
            a.download = `zulora_transactions_${Date.now()}.csv`; a.click();
            URL.revokeObjectURL(url);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold"
        >
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>
    </div>
  );
}

// ─── Tab: Notifications (FCM Broadcast) ──────────────────────────────────────
function NotificationsTab() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const sendBroadcast = async () => {
    if (!title.trim() || !body.trim()) { setError('Title and message body are required.'); return; }
    setSending(true); setError(''); setSent(false);
    try {
      // Store broadcast notification in Firestore (triggers Cloud Function for FCM fan-out)
      const { addDoc } = await import('firebase/firestore');
      await addDoc(collection(db, 'admin_broadcasts'), {
        title: title.trim(),
        body: body.trim(),
        sentAt: Date.now(),
        sentBy: 'admin',
        type: 'broadcast'
      });
      setSent(true);
      setTitle(''); setBody('');
    } catch (e) {
      setError(e.message || 'Failed to send notification.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4 max-w-xl">
      <Card>
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-4">Broadcast Push Notification</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Notification Title</label>
            <input value={title} onChange={e => { setTitle(e.target.value); setSent(false); setError(''); }}
              placeholder="e.g. New Feature Launch 🚀"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Message Body</label>
            <textarea value={body} onChange={e => { setBody(e.target.value); setSent(false); setError(''); }}
              rows={4} placeholder="Write your broadcast message..."
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none" />
          </div>
          {error && <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />{error}</p>}
          {sent && <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />Broadcast queued for delivery.</p>}
          <button onClick={sendBroadcast} disabled={sending}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-sm font-semibold">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sending ? 'Sending...' : 'Send to All Users'}
          </button>
        </div>
      </Card>
    </div>
  );
}

// ─── Tab: Reports & Analytics ─────────────────────────────────────────────────
function AnalyticsTab() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [usersSnap, txSnap] = await Promise.all([
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'transactions'))
        ]);
        const users = usersSnap.docs.map(d => d.data());
        const txs = txSnap.docs.map(d => d.data());
        const revenue = txs.filter(t => t.status === 'success').reduce((a, t) => a + (Number(t.amount) || 0), 0);
        const proUsers = users.filter(u => u.isPro || u.plan === 'pro').length;
        const lastWeek = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const newThisWeek = users.filter(u => {
          const ct = u.createdAt?.seconds ? u.createdAt.seconds * 1000 : u.createdAt;
          return ct && ct > lastWeek;
        }).length;
        setStats({ totalUsers: users.length, proUsers, revenue, newThisWeek, totalTx: txs.length });
      } catch {
        setStats(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const exportReport = () => {
    if (!stats) return;
    const csv = [
      'Metric,Value',
      `Total Users,${stats.totalUsers}`,
      `Pro Subscribers,${stats.proUsers}`,
      `New This Week,${stats.newThisWeek}`,
      `Total Revenue (INR),${stats.revenue}`,
      `Total Transactions,${stats.totalTx}`,
      `Report Date,${new Date().toISOString()}`
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `zulora_analytics_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading analytics...</div>;
  if (!stats) return <div className="py-12 text-center text-slate-400">Analytics data could not be loaded.</div>;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard icon={Users} label="Total Users" value={stats.totalUsers} color="sky" />
        <StatCard icon={Sparkles} label="Pro Subscribers" value={stats.proUsers} color="amber" />
        <StatCard icon={TrendingUp} label="New This Week" value={stats.newThisWeek} color="green" />
        <StatCard icon={DollarSign} label="Revenue (₹)" value={`₹${stats.revenue.toLocaleString()}`} color="green" />
        <StatCard icon={FileText} label="Transactions" value={stats.totalTx} color="slate" />
      </div>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">Business Metrics Summary</h3>
          <button onClick={exportReport} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-700">
            <Download className="w-3 h-3" /> Export CSV
          </button>
        </div>
        <div className="space-y-2.5">
          {[
            { label: 'Conversion Rate (Free → Pro)', value: stats.totalUsers > 0 ? `${((stats.proUsers / stats.totalUsers) * 100).toFixed(1)}%` : '0%', bar: stats.totalUsers > 0 ? (stats.proUsers / stats.totalUsers) * 100 : 0 },
            { label: 'Weekly Growth Rate', value: `+${stats.newThisWeek} users`, bar: Math.min(100, (stats.newThisWeek / Math.max(1, stats.totalUsers)) * 1000) },
            { label: 'Avg. Revenue Per Pro User', value: stats.proUsers > 0 ? `₹${(stats.revenue / stats.proUsers).toFixed(0)}` : '₹0', bar: 100 },
          ].map(m => (
            <div key={m.label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600 dark:text-slate-400 font-medium">{m.label}</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{m.value}</span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${Math.min(100, m.bar)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── Main Admin Panel Component ───────────────────────────────────────────────
export default function AdminPanel() {
  const { currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState('users');

  const isAdmin = ADMIN_EMAILS.has(currentUser?.email || '');

  if (!currentUser) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-50 dark:bg-[#070b14] px-4">
        <div className="flex flex-col items-center gap-4 p-8 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl max-w-sm w-full mx-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-sky-50 dark:bg-sky-950/50 grid place-items-center text-sky-600 dark:text-sky-400">
            <Shield className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-white">Admin Dashboard</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Please sign in with an authorized Zulora admin account to continue.</p>
          </div>
          <div className="flex flex-col gap-2 w-full mt-2">
            <button
              onClick={() => window.location.assign('/login')}
              className="w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold text-sm shadow-md transition-all"
            >
              Sign In to Admin
            </button>
            <button
              onClick={() => window.location.assign('/dashboard')}
              className="w-full py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition-all"
            >
              Return to Workspace
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-50 dark:bg-[#070b14] px-4">
        <div className="flex flex-col items-center gap-4 p-8 rounded-3xl border border-red-200 dark:border-red-900/60 bg-white dark:bg-slate-900 shadow-xl max-w-sm w-full mx-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-950/50 grid place-items-center text-red-500">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-white">Access Denied</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Your account (<strong>{currentUser.email}</strong>) is not authorized to access this admin panel.
            </p>
          </div>
          <Pill label="Unauthorized" color="red" />
          <button
            onClick={() => window.location.assign('/dashboard')}
            className="w-full mt-2 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition-all"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const TabContent = {
    users: UserManagement,
    content: ContentControl,
    payments: PaymentsTab,
    notify: NotificationsTab,
    analytics: AnalyticsTab,
  }[activeTab] || (() => null);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#070b14]">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-600 text-white shadow-sm">
            <Shield className="w-5 h-5" />
          </span>
          <div>
            <p className="text-sm font-extrabold text-slate-900 dark:text-white">Zulora Master Admin</p>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">{currentUser.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.location.assign('/dashboard')}
            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold transition-all"
          >
            &larr; Workspace
          </button>
          <Pill label="Master Admin" color="sky" />
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="hidden sm:flex flex-col w-56 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 min-h-[calc(100vh-57px)] py-3 px-2 sticky top-[57px]">
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all mb-0.5 text-left w-full ${activeTab === tab.id
                  ? 'bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {tab.label}
              </button>
            );
          })}
        </aside>

        {/* Mobile Tab Bar */}
        <div className="sm:hidden fixed bottom-0 left-0 right-0 z-20 flex bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-1 py-1">
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex flex-col items-center gap-1 py-1.5 rounded-xl text-[9px] font-bold transition-all ${activeTab === tab.id ? 'text-sky-600 dark:text-sky-400' : 'text-slate-400'}`}>
                <Icon className="w-4 h-4" />
                <span className="leading-none">{tab.label.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>

        {/* Main Content */}
        <main className="flex-1 min-w-0 px-4 py-6 sm:px-6 pb-24 sm:pb-6">
          <div className="mb-5">
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
              {TABS.find(t => t.id === activeTab)?.label}
            </h2>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
              Zulora AI Admin Dashboard · {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <TabContent />
        </main>
      </div>
    </div>
  );
}

