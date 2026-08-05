#!/bin/bash
# TimetableAI — Start both backend and frontend

echo "🎓 Starting TimetableAI..."

# Backend
echo "📦 Installing Python dependencies..."
cd "$(dirname "$0")/backend"
pip install -r requirements.txt -q

echo "🚀 Starting Flask backend on port 5000..."
python app.py &
BACKEND_PID=$!

# Frontend
echo "📦 Installing Node dependencies..."
cd ../frontend
npm install --silent

echo "🌐 Starting React frontend on port 3000..."
npm start &
FRONTEND_PID=$!

echo ""
echo "✅ TimetableAI is running!"
echo "   Frontend : http://localhost:3000"
echo "   Backend  : http://localhost:5000"
echo ""
echo "Press Ctrl+C to stop both servers."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo 'Stopped.'" INT
wait
