#!/bin/bash
# Start SnapSort backend — auto-activates venv

cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    source venv/bin/activate
    echo "Installing dependencies..."
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

echo ""
echo "═══════════════════════════════"
echo "  SnapSort Backend Starting"
echo "  http://localhost:5001"
echo "═══════════════════════════════"
echo ""

python app.py
