/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
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

const MainLayout: React.FC = () => {
  const { currentUser, isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState<NavTab>('home');

  // Modal states
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [viewingStory, setViewingStory] = useState<Story | null>(null);

  const handleNavigate = (tab: NavTab) => {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

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
      default:
        return <HomeView onNavigate={handleNavigate} onOpenStoryViewer={(s) => setViewingStory(s)} />;
    }
  };

  const isAuthScreen = activeTab === 'login' || activeTab === 'register';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors duration-200">
      {/* 1. Universal Top Bar */}
      <Navbar
        activeTab={activeTab}
        onNavigate={handleNavigate}
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenNotifications={() => setIsNotifOpen(true)}
        onOpenAuth={() => handleNavigate('login')}
      />

      {/* 2. Responsive 3-Column Layout Container */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 flex gap-6 pb-24 sm:pb-28 lg:pb-8">
        {/* Left Desktop Sidebar (Desktop only) */}
        {!isAuthScreen && (
          <div className="hidden lg:block">
            <Sidebar
              activeTab={activeTab}
              onNavigate={handleNavigate}
              onOpenCreatePost={() => setActiveTab('home')}
            />
          </div>
        )}

        {/* Center Main Viewport */}
        <main className="flex-1 py-6 min-w-0">
          {renderActiveView()}
        </main>

        {/* Right Desktop Widgets (Only on large screens, not on Reels or Auth views) */}
        {activeTab !== 'reels' && !isAuthScreen && (
          <RightWidgetPanel onNavigate={handleNavigate} />
        )}
      </div>

      {/* 3. Mobile Fixed Bottom Navigation */}
      <BottomNav activeTab={activeTab} onNavigate={handleNavigate} />

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

      <StoryViewerModal
        story={viewingStory}
        onClose={() => setViewingStory(null)}
      />
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
