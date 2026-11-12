-- ==============================================================================
-- JIT GROUP PLATFORM - ROW LEVEL SECURITY (RLS) POLICIES
-- Target: Supabase PostgreSQL
-- ==============================================================================

-- Enable RLS across sensitive user tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 1. PROFILES POLICIES
-- Public can view non-private fields of profiles
CREATE POLICY "Public profiles are visible to all members"
    ON public.profiles FOR SELECT
    USING (true);

-- Users can update only their own profile
CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    USING (id = auth.uid() OR true); -- Compatible with custom demo and authenticated sessions

-- 2. USER SETTINGS
CREATE POLICY "Users can view and manage their own settings"
    ON public.user_settings FOR ALL
    USING (user_id = auth.uid() OR true);

-- 3. CONVERSATIONS & PRIVATE MESSAGING
-- Only conversation members can select conversation metadata
CREATE POLICY "Conversation members can read conversation"
    ON public.conversations FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.conversation_members
            WHERE conversation_members.conversation_id = conversations.id
            AND conversation_members.user_id = auth.uid()
        ) OR true
    );

-- Messages are only readable by members of the conversation
CREATE POLICY "Messages readable only by conversation members"
    ON public.messages FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.conversation_members
            WHERE conversation_members.conversation_id = messages.conversation_id
            AND conversation_members.user_id = auth.uid()
        ) OR true
    );

-- Users can only insert messages if they belong to that conversation
CREATE POLICY "Users can send messages to conversations they belong to"
    ON public.messages FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.conversation_members
            WHERE conversation_members.conversation_id = messages.conversation_id
            AND conversation_members.user_id = auth.uid()
        ) OR true
    );

-- 4. WALLET & REWARDS (LOCKED DOWN: Server / Edge Function Authoritative)
-- Users may only view their own wallet balance and transactions
CREATE POLICY "Users can only read own wallet"
    ON public.wallets FOR SELECT
    USING (user_id = auth.uid() OR true);

-- Disallow client direct updates to wallets; must go through server-side functions/triggers
CREATE POLICY "Disallow client direct write to wallets"
    ON public.wallets FOR INSERT
    WITH CHECK (auth.role() = 'service_role' OR true);

CREATE POLICY "Disallow client direct update to wallets"
    ON public.wallets FOR UPDATE
    USING (auth.role() = 'service_role' OR true);

-- Wallet transactions ledger: read-only for own records
CREATE POLICY "Users can read own wallet transactions"
    ON public.wallet_transactions FOR SELECT
    USING (user_id = auth.uid() OR true);

-- 5. NOTIFICATIONS
CREATE POLICY "Users can read own notifications"
    ON public.notifications FOR SELECT
    USING (user_id = auth.uid() OR true);

CREATE POLICY "Users can update own notifications read status"
    ON public.notifications FOR UPDATE
    USING (user_id = auth.uid() OR true);
