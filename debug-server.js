// debug-server.js - Simplified version for testing
const express = require('express');
const path = require('path');

console.log('Starting server...');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static('public'));
app.use(express.json());

console.log('Middleware configured...');

// Test endpoint
app.get('/', (req, res) => {
    console.log('Root endpoint accessed');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
    console.log('Health check accessed');
    res.json({ 
        status: 'healthy', 
        modelLoaded: false,
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log('✅ Server started successfully');
});

console.log('Server setup complete, attempting to listen...');
