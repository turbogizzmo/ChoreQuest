import { lazy, Suspense, useCallback, Component } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useWebSocket } from './hooks/useWebSocket';
import Layout from './components/Layout';
import UpdatePrompt from './components/UpdatePrompt';
import { ToastProvider } from './components/Toast';

const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const KidDashboard = lazy(() => import('./pages/KidDashboard'));
const ParentDashboard = lazy(() => import('./pages/ParentDashboard'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const Chores = lazy(() => import('./pages/Chores'));
const ChoreDetail = lazy(() => import('./pages/ChoreDetail'));
const Rewards = lazy(() => import('./pages/Rewards'));
const Profile = lazy(() => import('./pages/Profile'));
const Calendar = lazy(() => import('./pages/Calendar'));
const Leaderboard = lazy(() => import('./pages/Leaderboard'));
const Settings = lazy(() => import('./pages/Settings'));
const Events = lazy(() => import('./pages/Events'));
const KidQuests = lazy(() => import('./pages/KidQuests'));
const Party = lazy(() => import('./pages/Party'));
const BountyBoard = lazy(() => import('./pages/BountyBoard'));
const AvatarEditor = lazy(() => import('./components/AvatarEditor'));

function Loading() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-accent font-medium text-sm">Loading...</div>
    </div>
  );
}

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-6 bg-navy text-cream">
          <p className="text-base font-semibold">Something went wrong</p>
          <p className="text-sm text-muted text-center max-w-xs">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            className="game-btn game-btn-blue"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const { user, loading, refreshSession } = useAuth();

  const handleWsMessage = useCallback((msg) => {
    // Refresh user object (points_balance, etc.) on every WS event
    refreshSession();
    window.dispatchEvent(new CustomEvent('ws:message', { detail: msg }));
  }, [refreshSession]);

  useWebSocket(user?.id, handleWsMessage);

  if (loading) return <Loading />;

  if (!user) {
    return (
      <AppErrorBoundary>
        <ToastProvider>
          <Suspense fallback={<Loading />}>
            <UpdatePrompt />
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </AppErrorBoundary>
    );
  }

  const DashboardComponent = user.role === 'kid' ? KidDashboard
    : user.role === 'parent' ? ParentDashboard
    : ParentDashboard;

  return (
    <AppErrorBoundary>
      <ToastProvider>
        <Layout>
          <UpdatePrompt />
          <Suspense fallback={<Loading />}>
            <Routes>
            <Route path="/" element={<DashboardComponent />} />
            <Route path="/chores" element={<Chores />} />
            <Route path="/chores/:id" element={<ChoreDetail />} />
            <Route path="/rewards" element={<Rewards />} />
            <Route path="/inventory" element={<Navigate to="/rewards?tab=inventory" replace />} />
            <Route path="/wishlist" element={<Navigate to="/rewards?tab=wishlist" replace />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/party" element={<Party />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/avatar" element={<AvatarEditor />} />
            <Route path="/events" element={<Events />} />
            <Route path="/kids/:kidId" element={<KidQuests />} />
            <Route path="/bounty" element={<BountyBoard />} />
            <Route path="/settings" element={<Settings />} />
            {user.role === 'admin' && <Route path="/admin" element={<AdminDashboard />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </Layout>
      </ToastProvider>
    </AppErrorBoundary>
  );
}
