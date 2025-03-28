let callAlert = document.getElementById("callAlert");
let callerName = document.getElementById("callerName");
let acceptBtn = document.getElementById("acceptCall");
let declineBtn = document.getElementById("declineCall");
let sent_by = document.getElementById("sent_by").innerText.trim();

let localVideo = document.getElementById("localVideo");
let remoteVideo = document.getElementById("remoteVideo");

let peerConnection;
let localStream;
let recipient = "";

const configuration = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
let loc1 = window.location;
let wsStart1 = loc1.protocol === "https:" ? "wss://" : "ws://";
let callSocket = new WebSocket(wsStart1 + loc1.host + loc1.pathname+"video/");
console.log(wsStart1 + loc1.host + loc1.pathname+"video/");

callSocket.onopen = () => console.log("Call WebSocket Connected");
callSocket.onerror = e => console.log("Call WebSocket Error:", e);
callSocket.onclose = e => console.log("Call WebSocket Closed:", e);

callSocket.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    console.log("Received WebSocket message:", data);

    if (data.action === "call") {
        recipient = data.caller;
        console.log("Received Data:", data);
        console.log("Caller:", data.caller);

        
        // ✅ Update UI dynamically to show the caller's name
        document.getElementById("callerName").innerText = `${data.caller} is calling...`;
        callAlert.style.display = "block";

        acceptBtn.onclick = () => acceptCall();
        declineBtn.onclick = () => declineCall();
    }

    if (data.action === "accept") {
        console.log("Call accepted, starting WebRTC connection.");
        startCall();
    }

    if (data.action === "decline") {
        console.log("Call declined by recipient.");
        alert("Call declined");
    }

    if (["offer", "answer", "candidate"].includes(data.action)) {
        await handleSignal(data);
    }
};


function initiateCall(username) {
    recipient = username;
    console.log(`Calling ${recipient}...`);
    callSocket.send(JSON.stringify({ action: "call", recipient, caller: sent_by }));
}

async function acceptCall() {
    callAlert.style.display = "none";
    console.log("Call accepted.");
    callSocket.send(JSON.stringify({ action: "accept", recipient }));
    await startCall();
}

function declineCall() {
    callAlert.style.display = "none";
    console.log("Call declined.");
    callSocket.send(JSON.stringify({ action: "decline", recipient }));
}

async function startCall() {
    if (!peerConnection) {
        console.log("Initializing peer connection...");
        peerConnection = new RTCPeerConnection(configuration);
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        localVideo.srcObject = localStream;

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                callSocket.send(JSON.stringify({ action: "candidate", recipient, candidate: event.candidate }));
            }
        };

        peerConnection.ontrack = (event) => {
            remoteVideo.srcObject = event.streams[0];
        };
    }

    if (!peerConnection.localDescription) {
        console.log("Creating and sending offer...");
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        callSocket.send(JSON.stringify({ action: "offer", recipient, offer }));
    }
}

async function handleSignal(data) {
    if (!peerConnection) {
        console.log("No peer connection, starting call...");
        await startCall();
    }

    if (data.action === "offer") {
        console.log("Received offer, setting remote description...");
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        callSocket.send(JSON.stringify({ action: "answer", recipient, answer }));
    }

    if (data.action === "answer") {
        console.log("Received answer, setting remote description...");
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    }

    if (data.action === "candidate") {
        console.log("Received ICE candidate, adding...");
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
}
