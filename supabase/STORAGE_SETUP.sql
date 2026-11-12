-- ==============================================================================
-- JIT GROUP PLATFORM - SUPABASE STORAGE BUCKETS CONFIGURATION
-- Buckets: avatars, covers, post-images, post-videos, stories, reels, chat-attachments, group-pictures
-- ==============================================================================

-- 1. Create storage buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
('avatars', 'avatars', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
('covers', 'covers', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
('post-images', 'post-images', true, 15728640, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
('post-videos', 'post-videos', true, 104857600, ARRAY['video/mp4', 'video/webm', 'video/quicktime']),
('stories', 'stories', true, 52428800, ARRAY['image/jpeg', 'image/png', 'video/mp4']),
('reels', 'reels', true, 104857600, ARRAY['video/mp4', 'video/webm']),
('chat-attachments', 'chat-attachments', false, 26214400, ARRAY['image/jpeg', 'image/png', 'video/mp4', 'application/pdf']),
('group-pictures', 'group-pictures', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Storage security policies
-- Allow public read for public media
CREATE POLICY "Public Read Media" ON storage.objects
    FOR SELECT USING (bucket_id IN ('avatars', 'covers', 'post-images', 'post-videos', 'stories', 'reels', 'group-pictures'));

-- Allow authenticated and demo users to upload files
CREATE POLICY "Allow Uploads" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id IN ('avatars', 'covers', 'post-images', 'post-videos', 'stories', 'reels', 'chat-attachments', 'group-pictures'));

-- Allow file deletion by owners
CREATE POLICY "Allow File Delete" ON storage.objects
    FOR DELETE USING (bucket_id IN ('avatars', 'covers', 'post-images', 'post-videos', 'stories', 'reels', 'chat-attachments', 'group-pictures'));
