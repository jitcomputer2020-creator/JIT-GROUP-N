/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NavTab, Story } from './types';
import { Navbar } from './components/layout/Navbar';
import { Sidebar } from './components/layout/Sidebar';
import { BottomNav } from './components/layout/BottomNav';
import { RightWidgetPanel } from './components/layout/RightWidgetPanel';
import { AuthModal } from './components/modals/AuthModal';
import { SearchModal } from './components/modals/SearchModal';
import { NotificationsDrawer } from './components/modals/NotificationsDrawer';
import { StoryViewerModal } from './components/modals/StoryViewerModal';

import { Loader2 } from 'lucide-react';
import { APP_CONFIG } from './constants/branding';
import { SocialProvider } from './context/SocialContext';

// Views
import { HomeView } from './views/HomeView';
import { FriendsView } from './views/FriendsView';
import { ReelsView } from './views/ReelsView';
import { GamesView } from './views/GamesView';
import { MessagesView } from './views/MessagesView';
import { TournamentsView } from './views/TournamentsView';
import { WalletView } from './views/WalletView';
import { ProfileView } from './views/ProfileView';
import { SettingsView } from './views/SettingsView';
import { LoginView } from './views/LoginView';
import { RegisterView } from './views/RegisterView';
import { AdminView } from './views/AdminView';

function isAdminPathActive(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  return path === '/admin' || path.startsWith('/admin/') || hash === '#/admin';
}

const MainLayout: React.FC = () => {
  const { isAuthenticated, isAuthLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<NavTab>(() => {
    if (isAdminPathActive()) return 'admin';
    return isAuthenticated ? 'home' : 'login';
  });

  // Modal states
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [viewingStory, setViewingStory] = useState<Story | null>(null);

  useEffect(() => {
    const handlePopState = () => {
      setActiveTab((prev) => {
        if (isAdminPathActive()) return 'admin';
        if (prev === 'admin') return isAuthenticated ? 'home' : 'login';
        return prev;
      });
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isAuthenticated]);

  // Automatic route guard once auth verification finishes
  useEffect(() => {
    if (isAuthLoading) return;
    if (activeTab === 'admin' || isAdminPathActive()) return;

    if (isAuthenticated && (activeTab === 'login' || activeTab === 'register')) {
      setActiveTab('home');
    } else if (!isAuthenticated && activeTab !== 'login' && activeTab !== 'register') {
      setActiveTab('login');
    }
  }, [isAuthenticated, isAuthLoading, activeTab]);

  const handleOpenAdmin = () => {
    if (typeof window !== 'undefined' && !isAdminPathActive()) {
      window.history.pushState(null, '', '/admin');
    }
    setActiveTab('admin');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleExitAdmin = () => {
    if (typeof window !== 'undefined' && isAdminPathActive()) {
      window.history.pushState(null, '', '/');
    }
    setActiveTab(isAuthenticated ? 'home' : 'login');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Ensure unrelated story/search overlays close whenever Games hub / active game rooms mount
  useEffect(() => {
    if (activeTab === 'games') {
      setViewingStory(null);
      setIsSearchOpen(false);
      setIsNotifOpen(false);
    }
  }, [activeTab]);

  const handleNavigate = (tab: NavTab) => {
    if (tab === 'admin') {
      handleOpenAdmin();
      return;
    }
    if (!isAuthenticated && tab !== 'login' && tab !== 'register') {
      setActiveTab('login');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (typeof window !== 'undefined' && isAdminPathActive()) {
      window.history.pushState(null, '', '/');
    }
    if (tab === 'games') {
      setViewingStory(null);
      setIsSearchOpen(false);
      setIsNotifOpen(false);
    }
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const isAdminScreen = activeTab === 'admin';

  // Minimal centered splash/loading screen while Firebase onAuthStateChanged verifies persistence
  if (isAuthLoading && !isAdminScreen) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-6 transition-colors duration-200">
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-lg p-2 flex items-center justify-center">
            <img
              src={APP_CONFIG.logoUrl}
              alt={APP_CONFIG.name}
              className="w-full h-full object-contain"
            />
          </div>
          <Loader2 className="w-6 h-6 animate-spin text-blue-600 dark:text-blue-400" />
        </div>
      </div>
    );
  }

  const renderActiveView = () => {
    switch (activeTab) {
      case 'home':
        return <HomeView onNavigate={handleNavigate} onOpenStoryViewer={(s) => setViewingStory(s)} />;
      case 'friends':
        return <FriendsView onNavigate={handleNavigate} />;
      case 'reels':
        return <ReelsView onNavigate={handleNavigate} />;
      case 'games':
        return <GamesView onNavigate={handleNavigate} />;
      case 'messages':
        return <MessagesView onNavigate={handleNavigate} />;
      case 'tournaments':
        return <TournamentsView onNavigate={handleNavigate} />;
      case 'wallet':
        return <WalletView onNavigate={handleNavigate} />;
      case 'profile':
        return <ProfileView onNavigate={handleNavigate} />;
      case 'settings':
        return (
          <SettingsView
            onNavigate={handleNavigate}
            onOpenAuth={() => setIsAuthOpen(true)}
          />
        );
      case 'login':
        return <LoginView onNavigate={handleNavigate} />;
      case 'register':
        return <RegisterView onNavigate={handleNavigate} />;
      case 'admin':
        return <AdminView onExitAdmin={handleExitAdmin} />;
      default:
        return isAuthenticated ? (
          <HomeView onNavigate={handleNavigate} onOpenStoryViewer={(s) => setViewingStory(s)} />
        ) : (
          <LoginView onNavigate={handleNavigate} />
        );
    }
  };

  const isAuthScreen = activeTab === 'login' || activeTab === 'register';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors duration-200 overflow-x-clip">
      {/* 1. Universal Top Bar */}
      <Navbar
        activeTab={activeTab}
        onNavigate={handleNavigate}
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenNotifications={() => setIsNotifOpen(true)}
        onOpenAuth={() => handleNavigate('login')}
        onOpenAdmin={handleOpenAdmin}
      />

      {/* 2. Responsive 3-Column Layout Container */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 flex gap-6 pb-20 sm:pb-24 lg:pb-8">
        {/* Left Desktop Sidebar (Desktop only, when authenticated) */}
        {isAuthenticated && !isAuthScreen && !isAdminScreen && (
          <div className="hidden lg:block">
            <Sidebar
              activeTab={activeTab}
              onNavigate={handleNavigate}
              onOpenCreatePost={() => setActiveTab('home')}
            />
          </div>
        )}

        {/* Center Main Viewport */}
        <main
          className={`flex-1 min-w-0 w-full ${
            activeTab === 'messages' ? 'py-3 sm:py-5 overflow-hidden' : 'py-4 sm:py-6'
          }`}
        >
          {renderActiveView()}
        </main>

        {/* Right Desktop Widgets (Hidden on Reels, Messages, Auth, and Admin for full workspace width) */}
        {isAuthenticated &&
          activeTab !== 'reels' &&
          activeTab !== 'messages' &&
          !isAuthScreen &&
          !isAdminScreen && (
            <RightWidgetPanel onNavigate={handleNavigate} />
          )}
      </div>

      {/* 3. Mobile Fixed Bottom Navigation (only when authenticated) */}
      {isAuthenticated && !isAdminScreen && (
        <BottomNav activeTab={activeTab} onNavigate={handleNavigate} />
      )}

      {/* 4. Global Modals and Slide-overs */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
      />

      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onNavigate={handleNavigate}
      />

      <NotificationsDrawer
        isOpen={isNotifOpen}
        onClose={() => setIsNotifOpen(false)}
        onNavigate={handleNavigate}
      />

      {activeTab !== 'games' && (
        <StoryViewerModal
          story={viewingStory}
          onClose={() => setViewingStory(null)}
        />
      )}
    </div>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SocialProvider>
          <MainLayout />
        </SocialProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
