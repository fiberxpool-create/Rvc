import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const waiting = [];

app.use(express.static(path.join(__dirname, "../client")));
app.get("/health", (_req, res) => res.json({ ok: true }));

function removeFromQueue(id) {
  const i = waiting.indexOf(id);
  if (i >= 0) waiting.splice(i, 1);
}

function pair(socket) {
  removeFromQueue(socket.id);
  while (waiting.length) {
    const otherId = waiting.shift();
    const other = io.sockets.sockets.get(otherId);
    if (other && other.id !== socket.id) {
      socket.data.peerId = other.id;
      other.data.peerId = socket.id;
      socket.emit("matched", { initiator: true });
      other.emit("matched", { initiator: false });
      return;
    }
  }
  waiting.push(socket.id);
  socket.emit("waiting");
}

io.on("connection", socket => {
  socket.on("find", () => pair(socket));

  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("next", () => {
    const peerId = socket.data.peerId;
    socket.data.peerId = null;
    removeFromQueue(socket.id);
    if (peerId) {
      const peer = io.sockets.sockets.get(peerId);
      if (peer) {
        peer.data.peerId = null;
        peer.emit("peer-left");
        pair(peer);
      }
    }
    pair(socket);
  });

  socket.on("disconnect", () => {
    removeFromQueue(socket.id);
    const peerId = socket.data.peerId;
    if (peerId) {
      const peer = io.sockets.sockets.get(peerId);
      if (peer) {
        peer.data.peerId = null;
        peer.emit("peer-left");
        pair(peer);
      }
    }
  });
});

server.listen(process.env.PORT || 3000, () =>
  console.log(`Random Video Chat running on http://localhost:${process.env.PORT || 3000}`)
);
