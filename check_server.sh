#!/bin/bash
echo "🔍 Checking Auto-SBC Server Status..."
echo ""

# Check if process is running
if ps aux | grep uvicorn | grep -v grep > /dev/null; then
    echo "✅ Server process is running"
    PID=$(ps aux | grep uvicorn | grep -v grep | awk '{print $2}')
    echo "   Process ID: $PID"
else
    echo "❌ Server process is not running"
    exit 1
fi

# Check if port is responding
if curl -s http://127.0.0.1:8000/allPlayers.csv | head -1 | grep -q "id,name"; then
    echo "✅ Server is responding on http://127.0.0.1:8000"
    PLAYER_COUNT=$(curl -s http://127.0.0.1:8000/allPlayers.csv | wc -l)
    echo "   Player database: $((PLAYER_COUNT - 1)) players loaded"
else
    echo "❌ Server is not responding properly"
    exit 1
fi

echo ""
echo "🎉 Auto-SBC Server is running perfectly!"
echo "📊 Tampermonkey script can now use local database for:"
echo "   • Player prices"
echo "   • Concept players" 
echo "   • SBC solving"
echo ""
echo "💡 To stop the server: kill $PID"