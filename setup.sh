#!/bin/bash
# SnapSort — One-command setup script
# Usage: chmod +x setup.sh && ./setup.sh

set -e

echo "═══════════════════════════════════════"
echo "  SnapSort Setup"
echo "═══════════════════════════════════════"

# ─── Backend ───
echo ""
echo "→ Setting up Python backend..."
cd backend

if [ ! -d "venv" ]; then
    echo "  Creating virtual environment..."
    python3 -m venv venv
fi

echo "  Activating venv..."
source venv/bin/activate

echo "  Installing Python dependencies (this may take a few minutes)..."
pip install --upgrade pip
pip install -r requirements.txt

echo "  ✓ Backend ready"
deactivate
cd ..

# ─── Frontend ───
echo ""
echo "→ Setting up React frontend..."
cd frontend

if [ ! -d "node_modules" ]; then
    echo "  Installing npm dependencies..."
    npm install
fi

echo "  ✓ Frontend ready"
cd ..

# ─── Done ───
echo ""
echo "═══════════════════════════════════════"
echo "  ✓ Setup complete!"
echo "═══════════════════════════════════════"
echo ""
echo "  To start:"
echo ""
echo "  Terminal 1 (Backend):"
echo "    cd backend"
echo "    source venv/bin/activate"
echo "    python app.py"
echo ""
echo "  Terminal 2 (Frontend):"
echo "    cd frontend"
echo "    npm run dev"
echo ""
echo "  Then open: http://localhost:5173"
echo ""
echo "  Don't forget to configure Firebase!"
echo "  Edit: frontend/src/firebase.js"
echo "═══════════════════════════════════════"
