const socket = io();

const localVideo = document.querySelector("#local");
const remoteVideo = document.querySelector("#remote");
const remotePlaceholder = document.querySelector("#remotePlaceholder");
const statusEl = document.querySelector("#status");
const startBtn = document.querySelector("#start");
const nextBtn = document.querySelector("#next");
const stopBtn = document.querySelector("#stop");
const chatState = document.querySelector("#chatState");
const messagesEl = document.querySelector("#messages");
const chatForm = document.querySelector("#chatForm");
const chatInput = document.querySelector("#chatInput");
const sendBtn = document.querySelector("#sendBtn");

let stream = null;
let pc = null;
let peerId = null;
let started = false;
let pendingCandidates = [];

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

function setChat(enabled) {
  chatInput.disabled = !enabled;
  sendBtn.disabled = !enabled;
  chatState.textContent = enabled ? "Connected" : "Not connected";
}

function clearChat(message = "Messages will appear here when you're matched.") {
  messagesEl.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "empty-chat";
  empty.textContent = message;
  messagesEl.appendChild(empty);
}

function addMessage(text, who) {
  const empty = messagesEl.querySelector(".empty-chat");
  if (empty) empty.remove();

  const div = document.createElement("div");
  div.className = `msg ${who}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function startCamera() {
  if (stream) return;
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user" },
    audio: true
  });
  localVideo.srcObject = stream;
}

function closePeer() {
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.close();
  }
  pc = null;
  peerId = null;
  pendingCandidates = [];
  remoteVideo.srcObject = null;
  remotePlaceholder.style.display = "grid";
  setChat(false);
}

async function flushCandidates() {
  if (!pc || !pc.remoteDescription) return;
  for (const candidate of pendingCandidates) {
    try { await pc.addIceCandidate(candidate); } catch {}
  }
  pendingCandidates = [];
}

function makePeer(initiator) {
  if (pc) pc.close();

  pc = new RTCPeerConnection(rtcConfig);

  stream.getTracks().forEach(track => pc.addTrack(track, stream));

  pc.ontrack = event => {
    remoteVideo.srcObject = event.streams[0];
    remotePlaceholder.style.display = "none";
  };

  pc.onicecandidate = event => {
    if (event.candidate && peerId) {
      socket.emit("signal", {
        to: peerId,
        data: { candidate: event.candidate }
      });
    }
  };

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === "connected") {
      statusEl.textContent = "Connected!";
      remotePlaceholder.style.display = "none";
    } else if (["failed", "disconnected"].includes(pc.connectionState)) {
      statusEl.textContent = "Connection interrupted.";
    }
  };

  if (initiator) {
    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer))
      .then(() => {
        socket.emit("signal", {
          to: peerId,
          data: { description: pc.localDescription }
        });
      })
      .catch(() => {
        statusEl.textContent = "Could not start video connection.";
      });
  }
}

socket.on("waiting", () => {
  statusEl.textContent = "Looking for a stranger…";
  nextBtn.disabled = true;
  setChat(false);
});

socket.on("matched", ({ initiator, peerId: matchedPeerId }) => {
  peerId = matchedPeerId;
  statusEl.textContent = "Matched! Connecting video…";
  nextBtn.disabled = false;
  clearChat("You're matched. Say hello!");
  setChat(true);
  makePeer(initiator);
});

socket.on("signal", async ({ from, data }) => {
  if (!peerId) peerId = from;
  if (from !== peerId) return;

  if (!pc) makePeer(false);

  try {
    if (data.description) {
      await pc.setRemoteDescription(data.description);
      await flushCandidates();

      if (data.description.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("signal", {
          to: peerId,
          data: { description: pc.localDescription }
        });
      }
    } else if (data.candidate) {
      if (pc.remoteDescription) {
        await pc.addIceCandidate(data.candidate);
      } else {
        pendingCandidates.push(data.candidate);
      }
    }
  } catch {
    statusEl.textContent = "Video connection failed. Try Next.";
  }
});

socket.on("chat-message", ({ text }) => addMessage(text, "stranger"));

socket.on("peer-left", () => {
  closePeer();
  if (started) {
    statusEl.textContent = "Stranger left. Finding another…";
    socket.emit("find");
  } else {
    statusEl.textContent = "Stranger left.";
  }
});

startBtn.onclick = async () => {
  try {
    await startCamera();
    started = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusEl.textContent = "Looking for a stranger…";
    socket.emit("find");
  } catch {
    statusEl.textContent = "Please allow camera and microphone access.";
  }
};

nextBtn.onclick = () => {
  if (!started) return;
  closePeer();
  clearChat("Looking for someone new…");
  statusEl.textContent = "Finding another stranger…";
  socket.emit("next");
};

stopBtn.onclick = () => {
  started = false;
  closePeer();

  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  localVideo.srcObject = null;
  startBtn.disabled = false;
  nextBtn.disabled = true;
  stopBtn.disabled = true;
  clearChat();
  statusEl.textContent = "Stopped. Press Start to reconnect.";
  socket.emit("stop");
};

chatForm.onsubmit = event => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !peerId) return;

  addMessage(text, "you");
  socket.emit("chat-message", text);
  chatInput.value = "";
  chatInput.focus();
};
