-- ==============================================================================
-- JIT GROUP PLATFORM - COMPREHENSIVE SUPABASE POSTGRESQL DATABASE SCHEMA
-- Application: JIT GROUP (Social Media, Chat, WebRTC Calling & Multiplayer Gaming)
-- Target Platform: Supabase PostgreSQL (Postgres 15+)
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. PROFILES TABLE (Simple Contact Number Identity with 180-day inactivity tracking)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_number VARCHAR(30) UNIQUE NOT NULL,
    full_name VARCHAR(120) NOT NULL,
    address TEXT NOT NULL,
    bio TEXT DEFAULT 'JIT GROUP Member',
    avatar_url TEXT DEFAULT '/assets/aistudio/image_e64e54f2.png',
    cover_url TEXT,
    is_contact_number_public BOOLEAN DEFAULT FALSE,
    is_address_public BOOLEAN DEFAULT FALSE,
    reward_points INTEGER DEFAULT 100 CHECK (reward_points >= 0),
    streak_days INTEGER DEFAULT 1,
    friends_count INTEGER DEFAULT 0,
    followers_count INTEGER DEFAULT 0,
    following_count INTEGER DEFAULT 0,
    posts_count INTEGER DEFAULT 0,
    reels_count INTEGER DEFAULT 0,
    games_played INTEGER DEFAULT 0,
    games_won INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ DEFAULT NOW() -- Crucial for 180-day inactivity deletion
);

-- Index for instant contact number lookup
CREATE INDEX IF NOT EXISTS idx_profiles_contact_number ON public.profiles(contact_number);
CREATE INDEX IF NOT EXISTS idx_profiles_last_login ON public.profiles(last_login_at);

-- 2. USER SETTINGS TABLE
CREATE TABLE IF NOT EXISTS public.user_settings (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    theme VARCHAR(10) DEFAULT 'dark' CHECK (theme IN ('light', 'dark', 'system')),
    notify_messages BOOLEAN DEFAULT TRUE,
    notify_calls BOOLEAN DEFAULT TRUE,
    notify_games BOOLEAN DEFAULT TRUE,
    notify_tournaments BOOLEAN DEFAULT TRUE,
    notify_rewards BOOLEAN DEFAULT TRUE,
    allow_friend_requests BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. FRIENDSHIPS AND FOLLOWS
CREATE TABLE IF NOT EXISTS public.friendships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    friend_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'blocked')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_friendship UNIQUE (user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_users ON public.friendships(user_id, friend_id);

CREATE TABLE IF NOT EXISTS public.follows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    follower_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    following_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_follow UNIQUE (follower_id, following_id)
);

-- 4. POSTS & SOCIAL FEED
CREATE TABLE IF NOT EXISTS public.posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    category VARCHAR(30) DEFAULT 'all' CHECK (category IN ('all', 'friends', 'following', 'popular')),
    likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    shares_count INTEGER DEFAULT 0,
    is_pinned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_posts_author ON public.posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON public.posts(created_at DESC);

CREATE TABLE IF NOT EXISTS public.post_media (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
    media_url TEXT NOT NULL,
    media_type VARCHAR(10) DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.post_likes (
    post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES public.comments(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    likes_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. STORIES (Automatic 24h Expiration)
CREATE TABLE IF NOT EXISTS public.stories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    media_url TEXT NOT NULL,
    media_type VARCHAR(10) DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
    caption TEXT,
    view_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours')
);
CREATE INDEX IF NOT EXISTS idx_stories_expires ON public.stories(expires_at);

-- 6. REELS (Vertical Short Videos)
CREATE TABLE IF NOT EXISTS public.reels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    video_url TEXT NOT NULL,
    caption TEXT NOT NULL,
    music_title VARCHAR(120) DEFAULT 'JIT Original Audio',
    likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    shares_count INTEGER DEFAULT 0,
    views_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reels_views ON public.reels(views_count DESC);

-- 7. CHAT CONVERSATIONS & MESSAGES
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(10) DEFAULT 'direct' CHECK (type IN ('direct', 'group')),
    name VARCHAR(100), -- For groups
    avatar_url TEXT,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.conversation_members (
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    media_url TEXT,
    media_type VARCHAR(10) CHECK (media_type IN ('image', 'video', 'file')),
    status VARCHAR(20) DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id, created_at DESC);

-- 8. WEBRTC CALL SESSIONS
CREATE TABLE IF NOT EXISTS public.calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    caller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    call_type VARCHAR(10) DEFAULT 'voice' CHECK (call_type IN ('voice', 'video')),
    status VARCHAR(20) DEFAULT 'idle' CHECK (status IN ('idle', 'calling', 'incoming', 'connected', 'ended', 'rejected', 'missed')),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. MULTIPLAYER GAMES (Ludo, Tic Tac Toe, Quiz, Chess, Snake & Ladder, Carrom)
CREATE TABLE IF NOT EXISTS public.games (
    id VARCHAR(30) PRIMARY KEY,
    name VARCHAR(60) NOT NULL,
    category VARCHAR(40) NOT NULL,
    min_players INTEGER DEFAULT 2,
    max_players INTEGER DEFAULT 4,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE
);

INSERT INTO public.games (id, name, category, min_players, max_players, description) VALUES
('ludo', 'Ludo', 'Board Game', 2, 4, 'Classic 4-color board game with dice rolls, tokens, safe squares and captures.'),
('tictactoe', 'Tic Tac Toe', 'Quick Match', 2, 2, 'Strategic 3x3 grid duel with turn management and instant win detection.'),
('quiz', 'Quiz Battle', 'Trivia', 1, 4, 'Real-time multi-category trivia battle with speed-based points scoring.'),
('chess', 'Chess', 'Strategy', 2, 2, 'Standard 64-square grandmaster duel with full move validation, check and checkmate.'),
('snake_ladder', 'Snake & Ladder', 'Classic', 2, 4, 'Traditional board climbing race with snakes, ladders and randomized dice turns.'),
('carrom', 'Carrom', 'Arcade Physics', 2, 4, 'Physics-based carrom board simulation with striker aim, pockets and Queen cover.')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.game_rooms (
    room_code VARCHAR(12) PRIMARY KEY,
    game_id VARCHAR(30) NOT NULL REFERENCES public.games(id),
    host_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'waiting' CHECK (status IN ('waiting', 'in_progress', 'completed', 'abandoned')),
    game_state JSONB DEFAULT '{}'::jsonb, -- authoritatively synchronized
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.game_players (
    room_code VARCHAR(12) NOT NULL REFERENCES public.game_rooms(room_code) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    seat_index INTEGER NOT NULL,
    is_ready BOOLEAN DEFAULT FALSE,
    score INTEGER DEFAULT 0,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (room_code, user_id)
);

CREATE TABLE IF NOT EXISTS public.game_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_code VARCHAR(12) REFERENCES public.game_rooms(room_code) ON DELETE SET NULL,
    game_id VARCHAR(30) NOT NULL REFERENCES public.games(id),
    winner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reward_points_awarded INTEGER DEFAULT 0,
    completed_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. TOURNAMENTS
CREATE TABLE IF NOT EXISTS public.tournaments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_id VARCHAR(30) NOT NULL REFERENCES public.games(id),
    title VARCHAR(150) NOT NULL,
    entry_fee_points INTEGER DEFAULT 0,
    prize_pool_points INTEGER DEFAULT 0,
    total_slots INTEGER DEFAULT 16,
    registered_count INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'completed', 'cancelled')),
    start_date TIMESTAMPTZ NOT NULL,
    winner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tournament_participants (
    tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    registered_at TIMESTAMPTZ DEFAULT NOW(),
    rank INTEGER,
    PRIMARY KEY (tournament_id, user_id)
);

-- 11. VIRTUAL WALLET & REWARDS LEDGER (Server Authoritative)
CREATE TABLE IF NOT EXISTS public.wallets (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    points_balance INTEGER DEFAULT 100 CHECK (points_balance >= 0),
    streak_days INTEGER DEFAULT 1,
    last_daily_reward_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL, -- positive for credit, negative for debit
    type VARCHAR(40) NOT NULL CHECK (type IN ('daily_reward', 'game_reward', 'quiz_reward', 'achievement', 'tournament_entry', 'tournament_prize', 'initial_bonus')),
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON public.wallet_transactions(user_id, created_at DESC);

-- 12. ACHIEVEMENTS
CREATE TABLE IF NOT EXISTS public.achievements (
    code VARCHAR(50) PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    icon_name VARCHAR(50) DEFAULT 'Trophy',
    reward_points INTEGER DEFAULT 50
);

INSERT INTO public.achievements (code, title, description, icon_name, reward_points) VALUES
('first_post', 'First Broadcast', 'Shared your first thought with JIT community', 'Send', 50),
('first_friend', 'Networker', 'Connected with your first friend in JIT GROUP', 'Users', 50),
('game_victor', 'First Victory', 'Won your first multiplayer match in JIT Gaming Hub', 'Trophy', 100),
('quiz_champion', 'Quiz Prodigy', 'Scored 100% in a Quiz Battle match', 'Award', 200),
('streak_7', 'Dedicated Member', 'Logged in for 7 consecutive days', 'Flame', 150),
('tournament_star', 'Tournament Contender', 'Competed in an official JIT tournament', 'Medal', 300)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.user_achievements (
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    achievement_code VARCHAR(50) NOT NULL REFERENCES public.achievements(code),
    unlocked_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, achievement_code)
);

-- 13. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL,
    title VARCHAR(150) NOT NULL,
    message TEXT NOT NULL,
    action_url TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, created_at DESC);

-- 14. 180-DAY INACTIVE ACCOUNT CLEANUP PROCEDURE (Automated Server-Side Maintenance)
CREATE OR REPLACE FUNCTION delete_inactive_accounts()
RETURNS TABLE(deleted_count INTEGER) AS $$
DECLARE
    del_count INTEGER := 0;
BEGIN
    -- Delete profiles where last_login_at is older than 180 days
    -- Foreign key cascades cleanly handle posts, stories, reels, chats, memberships and wallets
    WITH deleted_rows AS (
        DELETE FROM public.profiles
        WHERE last_login_at < (NOW() - INTERVAL '180 days')
        RETURNING id
    )
    SELECT COUNT(*)::INTEGER INTO del_count FROM deleted_rows;
    
    RETURN QUERY SELECT del_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
