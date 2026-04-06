# SnapSort — AI-Powered Trip Photo Sorter

Upload everyone's trip photos to one group. **DeepFace** detects and recognizes real faces, automatically sorting photos by person. **Firebase** handles real-time cross-device sync.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────┐
│  React Frontend │────▶│  Flask Backend   │────▶│   DeepFace   │
│  (Vite + React) │     │  (Python API)    │     │  (AI Engine) │
└────────┬────────┘     └──────────────────┘     └──────────────┘
         │
         ▼
┌─────────────────┐
│    Firebase      │
│  Realtime DB     │
│  (Group Sync)    │
└─────────────────┘
```

## Quick Start

### 1. Firebase Setup (5 min)
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project (name it anything)
3. Go to **Build → Realtime Database → Create Database**
4. Choose **Start in test mode**
5. Go to **Project Settings → General → Your apps → Web app**
6. Click "Add app" → Register → Copy the config object
7. Paste config into `frontend/src/firebase.js`

### 2. Backend Setup (Python + DeepFace)
```bash
cd backend

# Create a virtual environment (REQUIRED on macOS/Linux)
python3 -m venv venv

# Activate it
# macOS / Linux:
source venv/bin/activate
# Windows:
# venv\Scripts\activate

# Install dependencies (inside venv, no errors)
pip install -r requirements.txt

# Run the server (first run downloads ~500MB of AI models)
python app.py
```
Backend runs on `http://localhost:5000`

> **Troubleshooting:**
> - If you see `externally-managed-environment` error → you forgot to activate the venv
> - If `pip install` is slow → DeepFace pulls TensorFlow (~400MB), be patient
> - If you get OpenCV errors on Mac → `brew install opencv` then retry
> - To deactivate venv when done: `deactivate`

### 3. Frontend Setup (React + Vite)
```bash
cd frontend
npm install
npm run dev
```
Frontend runs on `http://localhost:5173`

### Quick Test
```bash
# In a new terminal, test if backend is working:
curl http://localhost:5001/api/health
# Should return: {"engine":"DeepFace","status":"ok"}
```

## How It Works

1. **Create Group** → Get a 6-digit invite code
2. **Share Code** → Friends join from any device
3. **Upload Photos** → Sent to Flask backend → DeepFace detects faces
4. **Face Matching** → DeepFace.verify() compares face pairs
5. **Auto-Sort** → Photos grouped by person, synced via Firebase
6. **Download** → Get your photos or everyone's

## Deploying

### Backend (Railway / Render / VPS)
```bash
cd backend
# Set environment variable:
export FLASK_ENV=production
gunicorn app:app --bind 0.0.0.0:5000
```

### Frontend (Vercel)
```bash
cd frontend
# Update VITE_API_URL in .env to your backend URL
npm run build
# Deploy dist/ to Vercel
```

## Tech Stack
- **DeepFace** — Face detection (RetinaFace) + verification (VGG-Face)
- **Firebase Realtime DB** — Cross-device group sync
- **Flask + Flask-CORS** — Python API backend
- **React + Vite** — Frontend
