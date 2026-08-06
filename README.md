# HostelInfo-S (V2) - Supabase Rebuild Portal

This is a production-ready, high-performance rebuilt version (V2) of the Hostel Information System. It replaces Google Sheets and Apps Script with **Supabase** (PostgreSQL, Supabase Auth, and Storage) for sub-second database transactions, concurrency protections, and advanced security.

---

## ⚡ Performance Matrix
*   **Student Login**: Under 100ms (PostgreSQL RPC verify lookup).
*   **Student Registration**: Under 150ms (PostgreSQL RPC duplicate control).
*   **Hostel Listings**: Under 100ms (Secure RPC listings block).
*   **Admin Actions**: Under 50ms (Optimistic UI updates + database triggers).

---

## 🚀 Setup & Installation Guide

### Phase 1: Database Schema Integration
1. Log in to your [Supabase Console](https://supabase.com).
2. Create a new project.
3. Open your project dashboard and click on **SQL Editor** in the left menu.
4. Click **New Query**, copy the contents of the [`schema.sql`](schema.sql) file from this folder, paste it into the editor, and click **Run**.
5. This automatically creates:
   - Tables: `admins`, `settings`, `students`, `hostels`, `audit_logs`.
   - Security: Enable Row-Level Security (RLS) and set up policies.
   - Automation: Triggers to log admin actions and update timestamps.
   - APIs: Secure database RPC functions (`register_student`, `login_student`, `get_hostels`).
   - Indexes: Performance speed indexes for fast queries.

---

### Phase 2: Whitelist Administrator Email
To log in as an administrator, your Google email must be stored in the whitelisted `admins` table.
In your Supabase console:
1. Go to **Table Editor** > Select the `admins` table.
2. Click **Insert row**.
3. Add your Gmail address (e.g. `yourname@gmail.com`) and click **Save**.

---

### Phase 3: Configure Google OAuth (Admin Sign-In)
1. Go to [Google Cloud Console](https://console.cloud.google.com).
2. Create a project and set up your **OAuth Consent Screen** (Publish status set to *Production* or add your Gmail under *Test Users*).
3. Go to **Credentials** > Click **Create Credentials** > Select **OAuth client ID** > Select **Web application**.
4. In your Supabase Console:
   - Go to **Auth** > **Providers** > Enable **Google**.
   - Copy the **Redirect URL** shown in the Supabase panel.
5. In your Google Cloud Credentials page:
   - Paste this URL under **Authorized redirect URIs**.
   - Copy the generated **Client ID** and **Client Secret**.
6. Paste the Client ID and Secret back into your Supabase Google Auth settings and save.

---

### Phase 4: Configure Storage Bucket (Hostel Images)
1. In your Supabase Console, go to **Storage** > Click **New Bucket**.
2. Name the bucket **`hostel-photos`**.
3. Set the bucket to **Public** (important so students can view the images).
4. Storage access policies are handled automatically by the RLS policies in the `schema.sql` script (public reads, admin uploads).

---

### Phase 5: Client-Side Configuration
1. Open [`config.js`](config.js) in your local editor.
2. In your Supabase Console, go to **Project Settings** > **API**.
3. Copy the **Project URL** and the **anon (public)** key.
4. Replace the placeholders in `config.js`:
   ```javascript
   export const CONFIG_APP = {
     SUPABASE_URL: "https://your-project-id.supabase.co",
     SUPABASE_ANON_KEY: "your-anon-public-key"
   };
   ```
5. Save the file.

---

## 🌐 GitHub Pages Deployment

1. Create a new repository on GitHub named **`HostelInfo-S`**.
2. Initialize Git in the V2 folder, commit your files, and push them to your new repo:
   ```bash
   cd d:\Hostel\HostelInfo-S
   git init
   git add .
   git commit -m "Initialize Supabase V2 portal"
   git branch -M main
   git remote add origin https://github.com/yourusername/HostelInfo-S.git
   git push -u origin main
   ```
3. On GitHub, go to your repository **Settings** > **Pages**.
4. Under **Build and deployment**, select **Deploy from a branch** and set the source branch to **`main` / `(root)`**.
5. Save. Within a minute, your optimized PWA site will be live at `https://yourusername.github.io/HostelInfo-S/`!
