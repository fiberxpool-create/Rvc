const socket = io();

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const remotePlaceholder = document.getElementById("remotePlaceholder");
const statusEl = document.getElementById("status");

const startBtn = document.getElementById("startBtn");
const nextBtn = document.getElementById("nextBtn");
const stopBtn = document.getElementById("stopBtn");

const messages = document.getElementById("messages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

let localStream = null;
let peer = null;
let pendingCandidates = [];
let matched = false;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

function setStatus(text) {
  statusEl.textContent = text;
}

function addSystem(text) {
  messages.innerHTML = "";
  const div = document.createElement("div");
  div.className = "system";
  div.textContent = text;
  messages.appendChild(div);
}

function addMessage(text, mine) {
  const div = document.createElement("div");
  div.className = "message" + (mine ? " me" : "");
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function closePeer() {
  if (peer) {
    peer.ontrack = null;
    peer.onicecandidate = null;
    peer.onconnectionstatechange = null;
    peer.close();
    peer = null;
  }
  pendingCandidates = [];
  remoteVideo.srcObject = null;
  remotePlaceholder.style.display = "grid";
}

async function ensureMedia() {
  if (localStream) return localStream;

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera and microphone require HTTPS.");
  }

  localStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  });

  localVideo.srcObject = localStream;
  await localVideo.play().catch(() => {});
  return localStream;
}

function createPeer() {
  closePeer();

  peer = new RTCPeerConnection(rtcConfig);

  for (const track of localStream.getTracks()) {
    peer.addTrack(track, localStream);
  }

  peer.ontrack = async (event) => {
    const stream = event.streams[0] || new MediaStream([event.track]);
    remoteVideo.srcObject = stream;
    remotePlaceholder.style.display = "none";
    try { await remoteVideo.play(); } catch (_) {}
    setStatus("Connected");
  };

  peer.onicecandidate = (event) => {
    if (event.candidate) socket.emit("ice-candidate", event.candidate);
  };

  peer.onconnectionstatechange = () => {
    if (!peer) return;
    const state = peer.connectionState;
    if (state === "connected") {
      setStatus("Connected");
      remotePlaceholder.style.display = "none";
    } else if (state === "connecting") {
      setStatus("Connecting videoâ€¦");
    } else if (state === "failed") {
      setStatus("Video connection failed â€” press Next");
    } else if (state === "disconnected") {
      setStatus("Video disconnected");
    }
  };

  return peer;
}

async function flushCandidates() {
  if (!peer || !peer.remoteDescription) return;
  for (const candidate of pendingCandidates.splice(0)) {
    try { await peer.addIceCandidate(candidate); } catch (_) {}
  }
}

async function startSearching(mode = "start") {
  try {
    await ensureMedia();
    closePeer();
    matched = false;
    startBtn.disabled = true;
    nextBtn.disabled = true;
    stopBtn.disabled = false;
    chatInput.disabled = true;
    sendBtn.disabled = true;
    remotePlaceholder.style.display = "grid";

    addSystem(mode === "next" ? "Finding a new personâ€¦" : "Finding a random personâ€¦");
    setStatus("Searchingâ€¦");
    socket.emit(mode === "next" ? "next-stranger" : "find-stranger");
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Camera/microphone permission failed");
    startBtn.disabled = false;
  }
}

socket.on("connect", () => {
  setStatus("Ready");
});

socket.on("waiting", () => {
  matched = false;
  setStatus("Waiting for a strangerâ€¦");
  addSystem("Waiting for a strangerâ€¦");
});

socket.on("matched", async ({ initiator }) => {
  matched = true;
  nextBtn.disabled = false;
  stopBtn.disabled = false;
  chatInput.disabled = false;
  sendBtn.disabled = false;
  messages.innerHTML = "";
  addSystem("You're matched. Say hello!");
  setStatus("Matched â€” starting videoâ€¦");

  createPeer();

  if (initiator) {
    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      socket.emit("offer", peer.localDescription);
    } catch (err) {
      console.error("Offer error:", err);
      setStatus("Could not start video");
    }
  }
});

socket.on("offer", async (offer) => {
  try {
    if (!localStream) await ensureMedia();
    if (!peer) createPeer();

    await peer.setRemoteDescription(new RTCSessionDescription(offer));
    await flushCandidates();

    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit("answer", peer.localDescription);
  } catch (err) {
    console.error("Answer error:", err);
    setStatus("Could not answer video call");
  }
});

socket.on("answer", async (answer) => {
  try {
    if (!peer) return;
    await peer.setRemoteDescription(new RTCSessionDescription(answer));
    await flushCandidates();
  } catch (err) {
    console.error("Remote answer error:", err);
  }
});

socket.on("ice-candidate", async (candidate) => {
  try {
    if (!peer || !peer.remoteDescription) {
      pendingCandidates.push(candidate);
      return;
    }
    await peer.addIceCandidate(candidate);
  } catch (err) {
    console.error("ICE error:", err);
  }
});

socket.on("partner-left", () => {
  matched = false;
  closePeer();
  chatInput.disabled = true;
  sendBtn.disabled = true;
  nextBtn.disabled = true;
  stopBtn.disabled = false;
  setStatus("Stranger left");
  addSystem("The stranger left. Press Next to find someone else.");
});

socket.on("stopped", () => {
  matched = false;
  closePeer();
  startBtn.disabled = false;
  nextBtn.disabled = true;
  stopBtn.disabled = true;
  chatInput.disabled = true;
  sendBtn.disabled = true;
  setStatus("Stopped");
  addSystem("Press Start to find a random person.");
});

socket.on("chat-message", (text) => {
  addMessage(text, false);
});

startBtn.addEventListener("click", () => startSearching("start"));
nextBtn.addEventListener("click", () => startSearching("next"));

stopBtn.addEventListener("click", () => {
  socket.emit("stop");
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !matched) return;
  addMessage(text, true);
  socket.emit("chat-message", text);
  chatInput.value = "";
  chatInput.focus();
});
