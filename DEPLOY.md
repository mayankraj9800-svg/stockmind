# Deployment Guide — StockMind AI Pro
# Deploy backend to Render + frontend to Netlify

═══════════════════════════════════════════
STEP 1 — Upload code to GitHub (required)
═══════════════════════════════════════════

1. Go to github.com → Sign up (free)
2. Click "New repository" → name it "stockmind"
3. Make it Private → Create repository
4. Download GitHub Desktop from desktop.github.com
5. Install it → Sign in with GitHub
6. Click "Add existing repository" → select your stockmind_v2 folder
7. Click "Publish repository"

Your code is now on GitHub.

═══════════════════════════════════════════
STEP 2 — Deploy Backend to Render
═══════════════════════════════════════════

1. Go to render.com → Sign up with GitHub (free)
2. Click "New +" → "Web Service"
3. Connect your "stockmind" GitHub repo
4. Set these settings:
   - Name: stockmind-backend
   - Root directory: backend
   - Runtime: Node
   - Build command: npm install
   - Start command: node server.js
   - Plan: Free

5. Click "Advanced" → "Add Environment Variable":
   - Key: ALLOWED_ORIGINS
   - Value: https://your-app.netlify.app  ← update this after Netlify deploy

6. Click "Create Web Service"
7. Wait 2-3 minutes for it to deploy
8. Copy your Render URL (looks like: https://stockmind-backend.onrender.com)

═══════════════════════════════════════════
STEP 3 — Update frontend with Render URL
═══════════════════════════════════════════

1. Open frontend/index.html
2. Find this line:
   'https://stockmind-backend.onrender.com/api'
3. Replace "stockmind-backend" with your actual Render app name

═══════════════════════════════════════════
STEP 4 — Deploy Frontend to Netlify
═══════════════════════════════════════════

1. Go to netlify.com → Sign up with GitHub (free)
2. Click "Add new site" → "Import an existing project"
3. Connect GitHub → select "stockmind" repo
4. Set these settings:
   - Base directory: frontend
   - Build command: (leave empty)
   - Publish directory: frontend
5. Click "Deploy site"
6. Wait 1 minute
7. Copy your Netlify URL (looks like: https://stockmind-abc123.netlify.app)

═══════════════════════════════════════════
STEP 5 — Update Render with Netlify URL
═══════════════════════════════════════════

1. Go to Render dashboard → stockmind-backend
2. Click "Environment"
3. Update ALLOWED_ORIGINS to your Netlify URL:
   https://stockmind-abc123.netlify.app
4. Click "Save Changes" → Render redeploys automatically

═══════════════════════════════════════════
STEP 6 — Add domains to Firebase
═══════════════════════════════════════════

1. Go to console.firebase.google.com
2. Authentication → Settings → Authorized domains
3. Click "Add domain"
4. Add your Netlify URL: stockmind-abc123.netlify.app
5. Click Add

═══════════════════════════════════════════
STEP 7 — Share with everyone!
═══════════════════════════════════════════

Share your Netlify URL with anyone:
https://stockmind-abc123.netlify.app

They just:
1. Open the link
2. Sign in with Google
3. Enter their own Finnhub + Groq keys once
4. Use the app forever — from any device!

═══════════════════════════════════════════
IMPORTANT NOTES
═══════════════════════════════════════════

- Render free tier sleeps after 15 mins of inactivity
  → First load after sleep takes ~30 seconds (normal)
  → Upgrade to $7/month Render plan to avoid this

- Firebase free tier: 50,000 reads/day — more than enough
- Netlify free tier: 100GB bandwidth/month — more than enough
- Both Finnhub and Groq: users use their own keys, your limits never touched
