const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 10000;
const waiting = new Set();
const partnerOf = new Map();

app.use(express.static(path.join(__dirname, "..", "client")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "client", "index.html"));
});

function removeFromQueue(socket) {
  waiting.delete(socket.id);
}

function disconnectPair(socket, notify = true) {
  const partnerId = partnerOf.get(socket.id);
  partnerOf.delete(socket.id);

  if (partnerId) {
    partnerOf.delete(partnerId);
    const partner = io.sockets.sockets.get(partnerId);
    if (partner && notify) {
      partner.emit("partner-left");
    }
  }
}

function findPartner(socket) {
  if (!socket.connected || partnerOf.has(socket.id)) return;

  for (const id of waiting) {
    if (id === socket.id) continue;
    const candidate = io.sockets.sockets.get(id);
    if (!candidate || !candidate.connected || partnerOf.has(id)) {
      waiting.delete(id);
      continue;
    }

    waiting.delete(id);
    partnerOf.set(socket.id, id);
    partnerOf.set(id, socket.id);

    socket.emit("matched", { initiator: true });
    candidate.emit("matched", { initiator: false });
    return;
  }

  waiting.add(socket.id);
  socket.emit("waiting");
}

io.on("connection", (socket) => {
  socket.on("find-stranger", () => {
    removeFromQueue(socket);
    disconnectPair(socket, true);
    findPartner(socket);
  });

  socket.on("next-stranger", () => {
    removeFromQueue(socket);
    disconnectPair(socket, true);
    findPartner(socket);
  });

  socket.on("stop", () => {
    removeFromQueue(socket);
    disconnectPair(socket, true);
    socket.emit("stopped");
  });

  // WebRTC signaling — never send media through the server.
  for (const event of ["offer", "answer", "ice-candidate"]) {
    socket.on(event, (payload) => {
      const partnerId = partnerOf.get(socket.id);
      if (!partnerId) return;
      const partner = io.sockets.sockets.get(partnerId);
      if (partner) partner.emit(event, payload);
    });
  }

  socket.on("chat-message", (text) => {
    const partnerId = partnerOf.get(socket.id);
    if (!partnerId) return;
    const partner = io.sockets.sockets.get(partnerId);
    if (!partner) return;

    const clean = String(text || "").trim().slice(0, 1000);
    if (clean) partner.emit("chat-message", clean);
  });

  socket.on("disconnect", () => {
    removeFromQueue(socket);
    disconnectPair(socket, true);
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Random Video Chat running on port ${PORT}`);
});
