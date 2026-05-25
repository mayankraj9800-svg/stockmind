# Firebase Setup Guide — StockMind AI Pro

This takes about 5 minutes. Do it once.

---

## Step 1 — Create a Firebase project

1. Go to **console.firebase.google.com**
2. Click **"Add project"**
3. Name it `stockmind` (or anything you like)
4. Disable Google Analytics (not needed) → **Create project**

---

## Step 2 — Enable Google Sign-In

1. In Firebase Console → **Authentication** → **Get started**
2. Click **Google** under Sign-in providers
3. Toggle **Enable**
4. Set a support email (your email)
5. Click **Save**

---

## Step 3 — Create Firestore Database

1. In Firebase Console → **Firestore Database** → **Create database**
2. Choose **Start in production mode**
3. Pick any location → **Enable**
4. Go to **Rules** tab and replace with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

5. Click **Publish**

This means each user can ONLY read/write their own data.

---

## Step 4 — Get your Firebase config

1. In Firebase Console → **Project Settings** (gear icon) → **Your apps**
2. Click **"</> Web"** → Register app → name it `stockmind-web`
3. Copy the `firebaseConfig` object shown

---

## Step 5 — Put the config in the frontend

Open `frontend/index.html` and find this block near the top:

```javascript
const firebaseConfig = {
  apiKey:            "REPLACE_WITH_YOUR_FIREBASE_API_KEY",
  authDomain:        "REPLACE_WITH_YOUR_AUTH_DOMAIN",
  projectId:         "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket:     "REPLACE_WITH_YOUR_STORAGE_BUCKET",
  messagingSenderId: "REPLACE_WITH_YOUR_MESSAGING_SENDER_ID",
  appId:             "REPLACE_WITH_YOUR_APP_ID",
};
```

Replace the placeholder values with the ones from Firebase.

---

## Step 6 — Add authorized domain (for local dev)

1. Firebase Console → **Authentication** → **Settings** → **Authorized domains**
2. `localhost` should already be there
3. If opening as a file (file://) add: `localhost` — that's enough for local testing

---

## That's it!

Double-click `START.bat` → users sign in with Google → they enter their keys once → 
keys are saved to their Google account forever → every device they use auto-loads their keys.

---

## What gets stored per user in Firestore

| Field | Description |
|-------|-------------|
| `email` | Their Google email |
| `finnhubKey` | Their Finnhub API key |
| `groqKey` | Their Groq API key |
| `watchlist` | Their saved stocks |
| `portfolio` | Their portfolio positions |
| `analysisHistory` | Last 50 AI analyses |
| `updatedAt` | Last active timestamp |

Only the user themselves can access their own document — enforced by Firestore security rules.
