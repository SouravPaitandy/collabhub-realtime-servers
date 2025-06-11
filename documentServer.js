const WebSocket = require('ws');
const http = require('http');
const { setupWSConnection } = require('y-websocket/bin/utils');
const path = require('path');
const fs = require('fs');

// Enable cross-origin support and production configuration
const PORT = process.env.PORT || 8080;

// HTTP server
const server = http.createServer((request, response) => {
  // Enable CORS headers
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Request-Method', '*');
  response.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET');
  response.setHeader('Access-Control-Allow-Headers', '*');
  
  if (request.method === 'OPTIONS') {
    response.writeHead(200);
    response.end();
    return;
  }

  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end('CollabHub document collaboration server is running');
});

// Add this to your HTTP server around line 10-20
server.on('request', (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      connections: connections,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    }));
    return;
  }
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Add heartbeat interval for keeping connections alive
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

// Custom logging
const logToFile = process.env.NODE_ENV === 'production' && process.env.LOG_TO_FILE === 'true';
const logDir = path.join(__dirname, 'logs');

if (logToFile && !fs.existsSync(logDir)) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch (err) {
    console.error('Could not create log directory, logging to console only:', err.message);
  }
}

const log = (message) => {
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] ${message}`;
  
  console.log(formattedMessage);
  
  if (logToFile) {
    try {
      fs.appendFileSync(
        path.join(logDir, 'document-server.log'), 
        formattedMessage + '\n'
      );
    } catch (err) {
      console.error('Could not write to log file:', err.message);
    }
  }
};

// Track client connections
let connections = 0;

// Handle WebSocket connections
wss.on('connection', (conn, req) => {
  connections++;

  conn.isAlive = true;
  conn.on('pong', () => {
    conn.isAlive = true;
  });
  
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

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    
    ws.isAlive = false;
    ws.ping(() => {});
  });
}, HEARTBEAT_INTERVAL);

wss.on('close', () => {
  clearInterval(interval);
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