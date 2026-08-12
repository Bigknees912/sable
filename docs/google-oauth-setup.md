# Setting up Google sign-in (Google Cloud + Supabase)

The code for "Continue with Google" is already done — it calls Supabase's
Google OAuth provider (`src/lib/auth.js` → `signInWithGoogle`). What's left
is configuration you have to do yourself, because it requires a Google Cloud
project tied to your own account. It takes about 15 minutes. Do the steps in
order — the two systems hand values back and forth.

## What you'll end up with

- A **Client ID** and **Client Secret** from Google
- Those two values pasted into Supabase
- One **redirect URI** from Supabase pasted back into Google

---

## Part 1 — Google Cloud Console

### 1. Create (or pick) a project
1. Go to https://console.cloud.google.com/
2. Top bar → project dropdown → **New Project**. Name it something like
   `Sable Auth`. Create it, then make sure it's the selected project.

### 2. Configure the OAuth consent screen
1. Left menu → **APIs & Services → OAuth consent screen**.
2. User type: **External** → Create.
3. Fill in the required fields:
   - **App name**: `Sable` (this is what users see on the Google prompt)
   - **User support email**: your email
   - **App logo** (optional): your Sable logo
   - **Developer contact email**: your email
4. **Scopes**: click Save and Continue — the defaults (`email`, `profile`,
   `openid`) are all you need. Don't add more; extra scopes trigger Google's
   verification review.
5. **Test users**: while the app is in "Testing" mode, only emails you add
   here can sign in. Add your own email (and anyone testing). Save.
6. You can stay in **Testing** mode indefinitely for internal use. To let
   *any* Google user sign in, come back later and click **Publish app**
   (Google may ask for verification if you request sensitive scopes — you
   don't, so it's usually instant).

### 3. Create the OAuth client credentials
1. Left menu → **APIs & Services → Credentials**.
2. **+ Create Credentials → OAuth client ID**.
3. Application type: **Web application**.
4. Name: `Sable Web`.
5. **Authorized JavaScript origins** — add both:
   - `https://runsable.com`
   - `http://localhost:5173` (for local dev; add your Vercel preview URL too
     if you test there)
6. **Authorized redirect URIs** — leave this open for a second; you get the
   exact value from Supabase in Part 2, step 2. (It looks like
   `https://<your-project-ref>.supabase.co/auth/v1/callback`.)
7. Click **Create**. Google shows you a **Client ID** and **Client Secret** —
   keep this tab open, you'll copy both into Supabase next.

---

## Part 2 — Supabase

### 1. Enable the Google provider
1. Go to your project at https://supabase.com/dashboard (project
   `umtoseyxvszdxbuvuyuk`).
2. Left menu → **Authentication → Sign In / Providers** (older UIs:
   **Providers**).
3. Find **Google**, toggle it **on**.
4. Paste the **Client ID** and **Client Secret** from Google (Part 1, step 7).
5. **Save**.

### 2. Copy the redirect URI back to Google
1. On that same Google provider panel, Supabase shows a **Callback URL
   (redirect URI)** — copy it. It's
   `https://umtoseyxvszdxbuvuyuk.supabase.co/auth/v1/callback`.
2. Go back to the Google Cloud **Credentials** tab → open your `Sable Web`
   OAuth client → under **Authorized redirect URIs** click **Add URI**, paste
   that callback URL, and **Save**.

### 3. Set your Site URL and redirect allow-list
1. Supabase → **Authentication → URL Configuration**.
2. **Site URL**: `https://runsable.com`
3. **Redirect URLs**: add `https://runsable.com` and `http://localhost:5173`
   (and any Vercel preview URLs you use). Our code calls
   `signInWithOAuth({ redirectTo: window.location.origin })`, so the origin a
   user starts from must be in this list or Google will refuse the redirect.
4. Save.

---

## Part 3 — Test it

1. Deploy (or run `npm run dev` locally at `http://localhost:5173`).
2. Open the app's login screen → **Continue with Google**.
3. You should get Google's account picker, then land back in the app signed
   in. First-time Google users get a `profiles` row the same way email
   sign-ups do; they'll go through the same role-choice / onboarding step.

## If it doesn't work

- **"provider is not enabled"** → the Google toggle in Supabase isn't on, or
  you didn't Save. (Our app now shows a friendly "Google sign-in isn't
  finished being set up yet" message for this.)
- **`redirect_uri_mismatch`** from Google → the callback URL in Google's
  Authorized redirect URIs doesn't exactly match Supabase's. Copy it again,
  no trailing slash, https not http.
- **"Access blocked / app not verified"** → you're not in the Test users list
  (Testing mode), or publish the app.
- **Signed in but bounced back to login** → your Site URL / Redirect URLs in
  Supabase don't include the origin you started from.

## Note on the demo

`demo.html` (the backend-free preview) keeps its fake "Continue with Google"
button — it's a visual demo and never talks to Supabase. All of the above
applies to the real app at `index.html` / `runsable.com`.
