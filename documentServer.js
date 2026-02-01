const WebSocket = require("ws");
const http = require("http");
const { setupWSConnection } = require("y-websocket/bin/utils");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io"); // Import Socket.IO Server
require("dotenv").config();
const mongoose = require("mongoose");
const Message = require("./models/Message");
const { MongodbPersistence } = require("y-mongodb-provider");
const Y = require("yjs");

// Enable cross-origin support and production configuration
// Enable cross-origin support and production configuration
const PORT = process.env.PORT || 8080;
const MONGODB_URI = process.env.MONGODB_URI;

// Connect to MongoDB
if (MONGODB_URI) {
  mongoose
    .connect(MONGODB_URI)
    .then(() => console.log("Connected to MongoDB"))
    .catch((err) => console.error("MongoDB connection error:", err));
}

// HTTP server
const server = http.createServer((request, response) => {
  // Enable CORS headers
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Request-Method", "*");
  response.setHeader("Access-Control-Allow-Methods", "OPTIONS, GET, POST");
  response.setHeader("Access-Control-Allow-Headers", "*");

  if (request.method === "OPTIONS") {
    response.writeHead(200);
    response.end();
    return;
  }

  // Handle PeerJS requests (will be set up later after server is created)
  if (request.url.startsWith("/peerjs")) {
    // PeerJS middleware will handle this
    return;
  }

  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end("CollabHub document collaboration server is running");
});

server.on("request", (req, res) => {
  // Health check endpoint
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        connections: connections,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      }),
    );
    return;
  }

  // Handle PeerJS HTTP requests (WebSocket will be handled in upgrade event)
  // Note: PeerServer will be initialized later and will handle its own requests
});

// --- START: NEW CHAT SERVER LOGIC ---
const io = new Server(server, {
  cors: {
    origin: "*", // In production, restrict this to your app's URL
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  log(`Chat client connected: ${socket.id}`);

  // User joins a collaboration-specific chat room
  socket.on("join_room", (collabId) => {
    socket.join(collabId);
    log(`Socket ${socket.id} joined room: ${collabId}`);
  });

  // Listen for a new message from a client
  socket.on("send_message", (data) => {
    // Broadcast the message to all other clients in the same room
    socket.to(data.collabId).emit("receive_message", data);
  });

  // --- START: NEW TYPING INDICATOR LOGIC ---

  // Listen for a user typing
  socket.on("typing", ({ collabId, user }) => {
    socket.to(collabId).emit("user_typing", user);
  });

  // Listen for a user stopping typing
  socket.on("stop_typing", ({ collabId, user }) => {
    socket.to(collabId).emit("user_stopped_typing", user);
  });

  // --- END: NEW TYPING INDICATOR LOGIC ---

  // --- NEW: REACTION EVENT LISTENER ---
  socket.on("send_reaction", (data) => {
    // Broadcast the reaction to all clients in the room
    socket.to(data.collabId).emit("receive_reaction", data);
  });

  // Handle client disconnection
  socket.on("disconnect", () => {
    log(`Chat client disconnected: ${socket.id}`);
  });

  // --- START: VIDEO CONFERENCING SIGNALING ---
  socket.on("join-video-room", (roomId, peerId, userName) => {
    socket.join(roomId); // Ensure socket is in the room
    // Broadcast to others that a new user connected with their PeerJS ID and Name
    socket.to(roomId).emit("user-connected", { peerId, userName });

    // Handle disconnection for video specifically
    socket.on("disconnect", () => {
      socket.to(roomId).emit("user-disconnected", peerId);
    });
  });

  socket.on("leave-video-room", (roomId, peerId) => {
    socket.to(roomId).emit("user-disconnected", peerId);
  });
  // --- END: VIDEO CONFERENCING SIGNALING ---
});

// --- END: NEW CHAT SERVER LOGIC ---

// Create WebSocket server for Yjs
const wss = new WebSocket.Server({ noServer: true }); // Important: use noServer

// Add heartbeat interval for keeping connections alive
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

// Custom logging
const logToFile =
  process.env.NODE_ENV === "production" && process.env.LOG_TO_FILE === "true";
const logDir = path.join(__dirname, "logs");

if (logToFile && !fs.existsSync(logDir)) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch (err) {
    console.error(
      "Could not create log directory, logging to console only:",
      err.message,
    );
  }
}

const log = (message) => {
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] ${message}`;

  console.log(formattedMessage);

  if (logToFile) {
    try {
      fs.appendFileSync(
        path.join(logDir, "document-server.log"),
        formattedMessage + "\n",
      );
    } catch (err) {
      console.error("Could not write to log file:", err.message);
    }
  }
};

// Track client connections
let connections = 0;

// Initialize MongoDB persistence once if URI is available
let mdb = null;
if (MONGODB_URI) {
  try {
    mdb = new MongodbPersistence(MONGODB_URI, {
      collectionName: "yjs-documents",
      flushSize: 100,
      multipleCollections: false,
    });
    log("MongoDB persistence initialized for YJS documents");
  } catch (err) {
    log(`Warning: Could not initialize MongoDB persistence: ${err.message}`);
  }
}

// Handle WebSocket connections for Yjs
wss.on("connection", (conn, req) => {
  connections++;

  conn.isAlive = true;
  conn.on("pong", () => {
    conn.isAlive = true;
  });

  // Extract document ID from URL path
  const docName = req.url.slice(1).split("?")[0];

  // Setup Y-WebSocket connection
  setupWSConnection(conn, req, {
    gc: true,
    pingTimeout: 30000,
    docName: docName,
  });

  // Persistence logic - only if MongoDB is available
  if (mdb) {
    const { setPersistence } = require("y-websocket/bin/utils");
    setPersistence({
      bindState: async (docName, ydoc) => {
        const persistedYdoc = await mdb.getYDoc(docName);
        const newUpdates = Y.encodeStateAsUpdate(ydoc);
        mdb.storeUpdate(docName, newUpdates);
        Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedYdoc));

        ydoc.on("update", async (update) => {
          mdb.storeUpdate(docName, update);
        });
      },
      writeState: async (docName, ydoc) => {
        // This is called when the connection is closed or periodically
        await mdb.storeUpdate(docName, Y.encodeStateAsUpdate(ydoc));
      },
    });
  }

  // Log connection
  const clientIP = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  log(
    `New connection from ${clientIP} to document: ${docName} (${connections} total)`,
  );

  // Handle disconnect
  conn.on("close", () => {
    connections--;
    log(`Connection closed. Active connections: ${connections}`);
  });
});

// Upgrade HTTP connections to WebSocket
server.on("upgrade", (request, socket, head) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);

  // Filter out Socket.IO and PeerJS paths - only handle YJS documents
  if (pathname !== "/socket.io/" && !pathname.startsWith("/peerjs")) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  }
  // PeerJS handles its own WebSocket connections internally
  // Socket.IO handles its own connections automatically
});

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();

    ws.isAlive = false;
    ws.ping(() => {});
  });
}, HEARTBEAT_INTERVAL);

wss.on("close", () => {
  clearInterval(interval);
});

// Handle errors
server.on("error", (err) => {
  log(`Server error: ${err.message}`);
});

// Start server
server.listen(PORT, () => {
  log(`Document collaboration server running on port ${PORT}`);
  log(`Environment: ${process.env.NODE_ENV || "development"}`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  log("Shutting down server...");
  wss.close(() => {
    log("WebSocket server closed");
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  log("Received SIGTERM. Shutting down server...");
  wss.close(() => {
    log("WebSocket server closed");
    process.exit(0);
  });
});

// --- NEW: PEERJS SERVER INTEGRATION ---
const { PeerServer } = require("peer");

// Attach PeerJS to the existing HTTP server (not on separate port)
const peerServer = PeerServer({
  server: server, // Attach to our existing HTTP server
  path: "/peerjs",
  proxied: true,
  allow_discovery: true,
});

peerServer.on("connection", (client) => {
  log(`PeerJS Client connected: ${client.getId()}`);
});

peerServer.on("disconnect", (client) => {
  log(`PeerJS Client disconnected: ${client.getId()}`);
});

log(`PeerJS Server integrated on /peerjs path`);
// --- END: PEERJS SERVER INTEGRATION ---
