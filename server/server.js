import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const waiting = [];

app.use(express.static(path.join(__dirname, "../client")));
app.get("/health", (_req, res) => res.json({ ok: true }));

function removeFromQueue(id) {
  const i = waiting.indexOf(id);
  if (i !== -1) waiting.splice(i, 1);
}

function unpair(socket) {
  const peerId = socket.data.peerId;
  socket.data.peerId = null;

  if (!peerId) return null;

  const peer = io.sockets.sockets.get(peerId);
  if (peer) {
    peer.data.peerId = null;
    peer.emit("peer-left");
  }
  return peer;
}

function pair(socket) {
  removeFromQueue(socket.id);

  while (waiting.length) {
    const otherId = waiting.shift();
    const other = io.sockets.sockets.get(otherId);

    if (!other || other.id === socket.id || other.data.peerId) continue;

    socket.data.peerId = other.id;
    other.data.peerId = socket.id;

    socket.emit("matched", { initiator: true, peerId: other.id });
    other.emit("matched", { initiator: false, peerId: socket.id });
    return;
  }

  waiting.push(socket.id);
  socket.emit("waiting");
}

io.on("connection", (socket) => {
  socket.on("find", () => pair(socket));

  socket.on("signal", ({ to, data }) => {
    if (!to || !data) return;
    const peer = io.sockets.sockets.get(to);
    if (peer && peer.data.peerId === socket.id) {
      peer.emit("signal", { from: socket.id, data });
    }
  });

  socket.on("chat-message", (text) => {
    const peerId = socket.data.peerId;
    if (!peerId || typeof text !== "string") return;

    const clean = text.trim().slice(0, 500);
    if (!clean) return;

    const peer = io.sockets.sockets.get(peerId);
    if (peer && peer.data.peerId === socket.id) {
      peer.emit("chat-message", { text: clean });
    }
  });

  socket.on("next", () => {
    removeFromQueue(socket.id);
    const peer = unpair(socket);
    if (peer) pair(peer);
    pair(socket);
  });

  socket.on("stop", () => {
    removeFromQueue(socket.id);
    unpair(socket);
  });

  socket.on("disconnect", () => {
    removeFromQueue(socket.id);
    unpair(socket);
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log(`Random Video Chat running on http://localhost:${process.env.PORT || 3000}`);
});
