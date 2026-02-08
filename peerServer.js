const { PeerServer } = require("peer");
require("dotenv").config();

const PORT = process.env.PEER_PORT || 9000;

// Create standalone PeerJS server
const peerServer = PeerServer({
  port: PORT,
  path: "/",
  allow_discovery: true,
});

peerServer.on("connection", (client) => {
  console.log(`[PeerJS] Client connected: ${client.getId()}`);
});

peerServer.on("disconnect", (client) => {
  console.log(`[PeerJS] Client disconnected: ${client.getId()}`);
});

peerServer.on("error", (error) => {
  console.error(`[PeerJS] Error: ${error.message}`);
});

console.log(`[PeerJS] Standalone server running on port ${PORT}`);
