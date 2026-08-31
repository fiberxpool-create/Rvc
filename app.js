const socket = io();
const localVideo = document.querySelector("#local");
const remoteVideo = document.querySelector("#remote");
const statusEl = document.querySelector("#status");
const startBtn = document.querySelector("#start");
const nextBtn = document.querySelector("#next");
const stopBtn = document.querySelector("#stop");

let stream, pc, peerId;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = stream;
}

function closePeer() {
  if (pc) pc.close();
  pc = null;
  peerId = null;
  remoteVideo.srcObject = null;
}

function makePeer(initiator) {
  pc = new RTCPeerConnection(rtcConfig);
  stream.getTracks().forEach(t => pc.addTrack(t, stream));

  pc.ontrack = e => {
    remoteVideo.srcObject = e.streams[0];
  };

  pc.onicecandidate = e => {
    if (e.candidate && peerId)
      socket.emit("signal", { to: peerId, data: { candidate: e.candidate } });
  };

  if (initiator) {
    pc.createOffer()
      .then(o => pc.setLocalDescription(o))
      .then(() => socket.emit("signal", {
        to: peerId, data: { description: pc.localDescription }
      }));
  }
}

socket.on("waiting", () => {
  statusEl.textContent = "Looking for a stranger…";
});

socket.on("matched", ({ initiator }) => {
  statusEl.textContent = "Connected!";
  nextBtn.disabled = false;
  makePeer(initiator);
});

socket.on("signal", async ({ from, data }) => {
  peerId = from;
  if (!pc) makePeer(false);

  if (data.description) {
    await pc.setRemoteDescription(data.description);
    if (data.description.type === "offer") {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", {
        to: peerId, data: { description: pc.localDescription }
      });
    }
  } else if (data.candidate) {
    try { await pc.addIceCandidate(data.candidate); } catch {}
  }
});

socket.on("peer-left", () => {
  closePeer();
  statusEl.textContent = "Stranger left. Finding another…";
});

startBtn.onclick = async () => {
  try {
    await startCamera();
    startBtn.disabled = true;
    stopBtn.disabled = false;
    socket.emit("find");
  } catch (e) {
    statusEl.textContent = "Camera/microphone permission is required.";
  }
};

nextBtn.onclick = () => {
  closePeer();
  statusEl.textContent = "Finding another stranger…";
  socket.emit("next");
};

stopBtn.onclick = () => {
  closePeer();
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  startBtn.disabled = false;
  nextBtn.disabled = true;
  stopBtn.disabled = true;
  statusEl.textContent = "Stopped. Press Start to reconnect.";
};
