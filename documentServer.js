const WebSocket = require('ws');
const http = require('http');
const { setupWSConnection } = require('y-websocket/bin/utils');
const path = require('path');
const fs = require('fs');

// Enable cross-origin support and production configuration
const PORT = process.env.PORT || 1234;

// Create HTTP server
const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end('CollabHub document collaboration server is running');
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Custom logging
const logToFile = process.env.NODE_ENV === 'production';
const logDir = path.join(__dirname, '..', 'logs');

if (logToFile && !fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const log = (message) => {
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] ${message}`;
  
  console.log(formattedMessage);
  
  if (logToFile) {
    fs.appendFileSync(
      path.join(logDir, 'document-server.log'), 
      formattedMessage + '\n'
    );
  }
};

// Track client connections
let connections = 0;

// Handle WebSocket connections
wss.on('connection', (conn, req) => {
  connections++;
  
  // Extract document ID from URL path
  const docName = req.url.slice(1).split('?')[0];
  
  // Setup Y-WebSocket connection
  setupWSConnection(conn, req, { 
    gc: true,
    pingTimeout: 30000,
    docName: docName
  });
  
  // Log connection
  const clientIP = req.headers['x-forwarded-for'] || 
                   req.socket.remoteAddress;
  
  log(`New connection from ${clientIP} to document: ${docName} (${connections} total)`);
  
  // Handle disconnect
  conn.on('close', () => {
    connections--;
    log(`Connection closed. Active connections: ${connections}`);
  });
});

// Handle errors
server.on('error', (err) => {
  log(`Server error: ${err.message}`);
});

// Start server
server.listen(PORT, () => {
  log(`Document collaboration server running on port ${PORT}`);
  log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  log('Shutting down server...');
  wss.close(() => {
    log('WebSocket server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  log('Received SIGTERM. Shutting down server...');
  wss.close(() => {
    log('WebSocket server closed');
    process.exit(0);
  });
});