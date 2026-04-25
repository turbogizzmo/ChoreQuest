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
  componentDidCatch(error, errorInfo) {
    console.error('[AppErrorBoundary]', error, errorInfo);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-6 text-cream">
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

class PageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('[PageErrorBoundary]', error, errorInfo);
  }
  componentDidUpdate(prevProps) {
    // Reset when navigating to a different page so the error doesn't persist
    if (prevProps.pageKey !== this.props.pageKey && this.state.error) {
      this.setState({ error: null });
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-6 text-cream">
          <p className="text-base font-semibold">This page ran into a problem</p>
          <p className="text-sm text-muted text-center max-w-xs">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            className="game-btn game-btn-blue"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function Page({ pageKey, children }) {
  return (
    <PageErrorBoundary pageKey={pageKey}>
      <Suspense fallback={<Loading />}>
        {children}
      </Suspense>
    </PageErrorBoundary>
  );
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
          <UpdatePrompt />
          <Routes>
            <Route path="/login" element={<Page pageKey="login"><Login /></Page>} />
            <Route path="/register" element={<Page pageKey="register"><Register /></Page>} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
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
          <Routes>
            <Route path="/" element={<Page pageKey="dashboard"><DashboardComponent /></Page>} />
            <Route path="/chores" element={<Page pageKey="chores"><Chores /></Page>} />
            <Route path="/chores/:id" element={<Page pageKey="chore-detail"><ChoreDetail /></Page>} />
            <Route path="/rewards" element={<Page pageKey="rewards"><Rewards /></Page>} />
            <Route path="/inventory" element={<Navigate to="/rewards?tab=inventory" replace />} />
            <Route path="/wishlist" element={<Navigate to="/rewards?tab=wishlist" replace />} />
            <Route path="/calendar" element={<Page pageKey="calendar"><Calendar /></Page>} />
            <Route path="/party" element={<Page pageKey="party"><Party /></Page>} />
            <Route path="/leaderboard" element={<Page pageKey="leaderboard"><Leaderboard /></Page>} />
            <Route path="/profile" element={<Page pageKey="profile"><Profile /></Page>} />
            <Route path="/avatar" element={<Page pageKey="avatar"><AvatarEditor /></Page>} />
            <Route path="/events" element={<Page pageKey="events"><Events /></Page>} />
            <Route path="/kids/:kidId" element={<Page pageKey="kid-quests"><KidQuests /></Page>} />
            <Route path="/bounty" element={<Page pageKey="bounty"><BountyBoard /></Page>} />
            <Route path="/settings" element={<Page pageKey="settings"><Settings /></Page>} />
            {user.role === 'admin' && <Route path="/admin" element={<Page pageKey="admin"><AdminDashboard /></Page>} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </ToastProvider>
    </AppErrorBoundary>
  );
}
