# JIT GROUP
### Complete Social Media, Chat, Calling & Multiplayer Gaming Platform
**Jharna Institute of Technology Campus Community Hub**

---

## 1. Project Overview & Brand Identity

**JIT GROUP** is a unified campus social network, real-time messaging, WebRTC HD voice/video calling, and online multiplayer gaming application. 

- **App Logo**: Official swirling emblem representing the Jharna Institute of Technology (`/assets/aistudio/image_e64e54f2.png`).
- **Identity Flow**: Passwordless, OTP-free contact number lookup and demo registration.
- **Data Protection**: Contact numbers and campus hostel addresses are private by default.
- **Account Maintenance**: Automated 180-day inactivity deletion policy without requiring manual admin approval.

---

## 2. Technology Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide React, Motion.
- **Backend & Database**: Supabase PostgreSQL 15, Supabase Realtime, Supabase Storage, Supabase Edge Functions.
- **Signaling & Calling**: WebRTC with STUN/TURN and Supabase Realtime broadcast signaling.
- **Design System**: Mobile-first responsive layout (thumb-zone ergonomics) with reactive Light and Dark themes.

---

## 3. Implementation Status Checklist

### Phase 1: Foundation, Branding, Layout, Themes & Supabase (COMPLETED)
- [x] **Fresh Project Architecture**: Modular structure (`/src/types`, `/src/context`, `/src/views`, `/src/components`, `/src/lib`, `/supabase`).
- [x] **Official Branding**: Embedded JIT logo (`/assets/aistudio/image_e64e54f2.png`), custom brand constants, favicon, and meta tags.
- [x] **Responsive Layout**: Top Bar Contract (3 zones), desktop Left Sidebar & Right Widget Panel (1440px desktop baseline), and mobile fixed Bottom Tab Bar ($44\text{px}+$ touch hitboxes).
- [x] **Light & Dark Themes**: Dual-theme switcher with persistent localStorage and Tailwind v4 `@custom-variant dark`.
- [x] **Supabase Client & Config**: Dynamic client with connection health check, interactive credential editor modal, and schema documentation.
- [x] **Full PostgreSQL Schema**: 30 tables defined in `/supabase/schema.sql` covering profiles, friendships, feeds, stories, reels, chats, calls, 6 games, tournaments, wallets, and achievements.
- [x] **Row Level Security**: Policies in `/supabase/rls.sql` protecting private messages, contact numbers, and server-authoritative wallets.
- [x] **180-Day Automated Inactivity Cleanup**: Implemented in `/supabase/schema.sql` (`delete_inactive_accounts()`) and `/supabase/functions/inactive-account-cleanup/index.ts`.
- [x] **Supabase Storage Configuration**: Provisioning script `/supabase/STORAGE_SETUP.sql` for 8 media buckets.

### Phase 2: Registration, Contact-Number Lookup & Profiles (READY FOR PHASE 2 EXPANSION)
- [x] Contact Number Registration & Lookup modal with 180-day inactivity notice.
- [x] Dynamic profile viewing with cover photos, avatars, and private number toggles.
- [ ] Direct cloud sync validation on remote Supabase instances.

### Phases 3 - 6: Social Feed, Reels, WebRTC Calling, 6 Games, Tournaments & Wallet
- Interactive functional previews implemented in views with local state synchronization.

---

## 4. Local Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/jit-group.git
   cd jit-group
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Add your Supabase credentials:
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
   ```

4. **Start Development Server**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

---

## 5. Supabase Database & Storage Deployment

1. Open your [Supabase Dashboard](https://supabase.com).
2. Go to **SQL Editor** -> **New Query**.
3. Paste and run `/supabase/schema.sql` to generate all 30 tables and functions.
4. Paste and run `/supabase/rls.sql` to apply Row Level Security.
5. Paste and run `/supabase/STORAGE_SETUP.sql` to initialize the 8 storage buckets.
6. In **Project Settings** -> **API**, copy your URL and Anon Key into the in-app **Supabase DB** configuration modal.

---

## 6. 180-Day Inactive Account Cleanup Setup

To enable the automated daily cleanup without manual admin intervention:

```sql
-- In Supabase SQL Editor
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
    'daily-jit-inactive-cleanup',
    '0 3 * * *',
    $$ SELECT public.delete_inactive_accounts(); $$
);
```

Or deploy `/supabase/functions/inactive-account-cleanup/index.ts` to Supabase Edge Functions.
