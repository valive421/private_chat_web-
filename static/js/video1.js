// Video Call WebSocket and WebRTC Implementation
// Filename: v.js
// Version: 1.3.2 - Modified to require explicit call acceptance

// Configuration
const DEBUG_MODE = true;
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const CALL_TIMEOUT = 30000; // 30 seconds for call acceptance timeout
const ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    {
        urls: "turn:relay1.expressturn.com:3478",
        username: "ef263220PSQYLOMNRT",
        credential: "uZTlBZS7VZ348gkN"
    }
];

// Global State
const callState = {
    peerConnection: null,
    localStream: null,
    remoteStream: null,
    currentCallRecipient: null,
    callActive: false,
    iceCandidates: [],
    statsInterval: null,
    heartbeatInterval: null,
    pendingOffer: null, // Stores incoming call offer until accepted
    callTimeout: null // Timeout for pending call acceptance
};

// Debugging Utilities
function debugLog(...messages) {
    if (DEBUG_MODE) {
        const timestamp = new Date().toISOString();
        const state = {
            pcState: callState.peerConnection ? {
                signaling: callState.peerConnection.signalingState,
                ice: callState.peerConnection.iceConnectionState
            } : null,
            callActive: callState.callActive,
            wsState: videoSocket ? videoSocket.readyState : null
        };
        console.log(`🔍 [${timestamp}]`, ...messages, '\nState:', state);
    }
}

function errorLog(...messages) {
    console.error(`❌ [${new Date().toISOString()}]`, ...messages);
}

// WebSocket Connection with Reconnect
let videoSocket;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

function initializeVideoSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    videoSocket = new WebSocket(`${protocol}${window.location.host}/ws/video/`);

    videoSocket.onopen = () => {
        debugLog('WebSocket connection established');
        reconnectAttempts = 0;
        setupHeartbeat();
        monitorConnectionState();
    };

    videoSocket.onclose = (event) => {
        debugLog('WebSocket closed:', event.code, event.reason);
        clearHeartbeat();
        if (callState.callActive) {
            endCall(true);
        }
        attemptReconnect();
    };

    videoSocket.onerror = (error) => {
        errorLog('WebSocket error:', error);
    };

    videoSocket.onmessage = handleWebSocketMessage;
}

function attemptReconnect() {
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = Math.min(30000, 2000 * reconnectAttempts);
        debugLog(`Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${delay}ms...`);
        setTimeout(initializeVideoSocket, delay);
    } else {
        debugLog('Max reconnection attempts reached');
    }
}

function setupHeartbeat() {
    clearHeartbeat();
    callState.heartbeatInterval = setInterval(() => {
        if (videoSocket.readyState === WebSocket.OPEN) {
            sendSignal({ action: 'ping' });
        }
    }, HEARTBEAT_INTERVAL);
}

function clearHeartbeat() {
    if (callState.heartbeatInterval) {
        clearInterval(callState.heartbeatInterval);
        callState.heartbeatInterval = null;
    }
}

function monitorConnectionState() {
    const checkInterval = setInterval(() => {
        if (videoSocket.readyState === WebSocket.CLOSED) {
            clearInterval(checkInterval);
            debugLog('WebSocket connection lost');
            if (callState.callActive) {
                endCall(true);
            }
        }
    }, 1000);
}

// WebSocket Message Handler
function handleWebSocketMessage(event) {
    try {
        debugLog('WebSocket message received:', event.data);
        const data = JSON.parse(event.data);
        
        if (data.action === 'pong') {
            debugLog('Heartbeat received');
            return;
        }

        if (!data.action) {
            errorLog('Received message without action');
            return;
        }

        debugLog('Processing action:', data.action);
        switch(data.action) {
            case 'connection_success':
                debugLog('WebSocket connection confirmed');
                break;
            case 'call':
                if (!data.caller) {
                    errorLog('Call message missing caller field');
                    return;
                }
                handleIncomingCall(data.caller);
                break;
            case 'offer':
                if (!data.offer || !data.sender) {
                    errorLog('Offer message missing required fields');
                    return;
                }
                handleOffer(data.offer, data.sender);
                break;
            case 'answer':
                if (!data.answer || !data.sender) {
                    errorLog('Answer message missing required fields');
                    return;
                }
                handleAnswer(data.answer, data.sender);
                break;
            case 'candidate':
                if (!data.candidate) {
                    errorLog('Candidate message missing candidate field');
                    return;
                }
                handleNewICECandidate(data.candidate);
                break;
            case 'accept':
                if (!data.sender) {
                    errorLog('Accept message missing sender field');
                    return;
                }
                handleCallAccepted(data.sender);
                break;
            case 'decline':
                if (!data.sender) {
                    errorLog('Decline message missing sender field');
                    return;
                }
                handleCallDeclined(data.sender, data.reason);
                break;
            case 'end-call':
                if (!data.sender) {
                    errorLog('End-call message missing sender field');
                    return;
                }
                handleCallEnded(data.sender);
                break;
            case 'error':
                errorLog('Server error:', data.message);
                break;
            default:
                debugLog('Unknown action received:', data.action);
        }
    } catch (error) {
        errorLog('Error processing WebSocket message:', error);
    }
}

// Signaling Functions
function sendSignal(data) {
    if (!videoSocket || videoSocket.readyState !== WebSocket.OPEN) {
        errorLog('Cannot send signal - WebSocket not open');
        return false;
    }

    const signalData = {
        ...data,
        timestamp: new Date().toISOString(),
        sender: callState.currentCallRecipient ? 
            callState.currentCallRecipient : 'unknown'
    };

    debugLog('Sending signal:', signalData.action);
    try {
        videoSocket.send(JSON.stringify(signalData));
        return true;
    } catch (error) {
        errorLog('Error sending signal:', error);
        return false;
    }
}

// Peer Connection Management
function createPeerConnection() {
    debugLog('Setting up new peer connection');
    
    if (callState.peerConnection) {
        debugLog('Cleaning up previous peer connection');
        cleanupPeerConnection();
    }

    callState.peerConnection = new RTCPeerConnection({ 
        iceServers: ICE_SERVERS,
        iceTransportPolicy: 'all'
    });
    callState.iceCandidates = [];

    // Setup event handlers
    callState.peerConnection.onicecandidate = handleICECandidate;
    callState.peerConnection.ontrack = handleRemoteTrack;
    callState.peerConnection.oniceconnectionstatechange = handleICEConnectionStateChange;
    callState.peerConnection.onnegotiationneeded = handleNegotiationNeeded;
    callState.peerConnection.onsignalingstatechange = handleSignalingStateChange;
    callState.peerConnection.onicegatheringstatechange = handleICEGatheringStateChange;
}

function cleanupPeerConnection() {
    if (callState.peerConnection) {
        debugLog('Closing peer connection');
        
        // Clear stats monitoring
        if (callState.statsInterval) {
            clearInterval(callState.statsInterval);
            callState.statsInterval = null;
        }
        
        // Remove all event listeners
        callState.peerConnection.onicecandidate = null;
        callState.peerConnection.ontrack = null;
        callState.peerConnection.oniceconnectionstatechange = null;
        callState.peerConnection.onnegotiationneeded = null;
        callState.peerConnection.onsignalingstatechange = null;
        callState.peerConnection.onicegatheringstatechange = null;
        
        callState.peerConnection.close();
        callState.peerConnection = null;
    }
}

function handleICECandidate(event) {
    if (event.candidate) {
        debugLog('New ICE candidate:', event.candidate.candidate);
        callState.iceCandidates.push(event.candidate);
        
        sendSignal({
            action: 'candidate',
            candidate: event.candidate.toJSON(),
            recipient: callState.currentCallRecipient
        });
    } else {
        debugLog('ICE gathering complete');
    }
}

function handleRemoteTrack(event) {
    debugLog('Received remote track:', event.track.kind);
    
    // Don't clean up if this is the same stream
    if (callState.remoteStream && 
        callState.remoteStream.id === event.streams[0].id) {
        debugLog('Same remote stream, skipping cleanup');
        return;
    }

    // Clean up previous remote stream if different
    if (callState.remoteStream) {
        debugLog('Cleaning up previous remote stream');
        cleanupStream(callState.remoteStream);
    }

    callState.remoteStream = event.streams[0];
    
    // Use a timeout to ensure DOM is ready
    setTimeout(() => {
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo) {
            remoteVideo.srcObject = callState.remoteStream;
            remoteVideo.onloadedmetadata = () => {
                debugLog('Remote video metadata loaded');
                remoteVideo.play().catch(e => {
                    errorLog('Error playing remote video:', e);
                });
            };
        }
    }, 100);
}

function handleICEConnectionStateChange() {
    const state = callState.peerConnection?.iceConnectionState;
    debugLog('ICE connection state changed:', state);

    switch(state) {
        case 'disconnected':
        case 'failed':
            debugLog('ICE connection failed or disconnected');
            endCall(true);
            break;
        case 'closed':
            debugLog('ICE connection closed');
            cleanupPeerConnection();
            break;
        case 'connected':
            debugLog('ICE connection established');
            break;
    }
}

function handleICEGatheringStateChange() {
    debugLog('ICE gathering state changed:', 
             callState.peerConnection?.iceGatheringState);
}

function handleNegotiationNeeded() {
    debugLog('Negotiation needed event triggered');
}

function handleSignalingStateChange() {
    debugLog('Signaling state changed:', callState.peerConnection?.signalingState);
}

// Stream Management
function cleanupStream(stream) {
    if (!stream) return;
    
    debugLog('Cleaning up stream with', stream.getTracks().length, 'tracks');
    stream.getTracks().forEach(track => {
        debugLog('Stopping track:', track.kind);
        track.stop();
    });
}

async function getLocalMediaStream() {
    try {
        debugLog('Requesting local media stream');
        const constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        debugLog('Obtained local media stream with tracks:', 
                 stream.getTracks().map(t => t.kind).join(', '));

        return stream;
    } catch (error) {
        errorLog('Error getting media devices:', error);
        throw error;
    }
}

function addLocalStreamToConnection(stream) {
    if (!callState.peerConnection) {
        throw new Error('PeerConnection not initialized');
    }

    debugLog('Adding local stream to peer connection');
    stream.getTracks().forEach(track => {
        const sender = callState.peerConnection.addTrack(track, stream);
        debugLog('Added track:', track.kind, 'with sender:', sender);
    });
}

// Connection Monitoring
function startConnectionMonitoring() {
    if (callState.statsInterval) {
        clearInterval(callState.statsInterval);
    }

    callState.statsInterval = setInterval(async () => {
        if (!callState.peerConnection || !callState.callActive) {
            clearInterval(callState.statsInterval);
            return;
        }

        try {
            const stats = await callState.peerConnection.getStats();
            let statsReport = {};

            stats.forEach(report => {
                if (report.type === 'candidate-pair' && report.nominated) {
                    statsReport = {
                        timestamp: report.timestamp,
                        bytesSent: report.bytesSent,
                        bytesReceived: report.bytesReceived,
                        currentRoundTripTime: report.currentRoundTripTime,
                        availableOutgoingBitrate: report.availableOutgoingBitrate
                    };
                }
            });

            debugLog('Connection stats:', statsReport);
        } catch (error) {
            errorLog('Error getting connection stats:', error);
        }
    }, 5000);
}

// Call Control Functions
async function initiateCall(username) {
    if (callState.callActive) {
        debugLog('Call already active, cannot initiate new call');
        showNotification('You are already in a call');
        return;
    }

    debugLog('Initiating call to:', username);
    callState.currentCallRecipient = username;
    callState.callActive = true;
    showCallWaitingScreen(`Calling ${username}...`);

    try {
        const stream = await getLocalMediaStream();
        callState.localStream = stream;
        
        const localVideo = document.getElementById('localVideo');
        if (localVideo) {
            localVideo.srcObject = stream;
            localVideo.onloadedmetadata = () => {
                debugLog('Local video metadata loaded');
                localVideo.play().catch(e => {
                    errorLog('Error playing local video:', e);
                });
            };
        }

        createPeerConnection();
        addLocalStreamToConnection(stream);
        startConnectionMonitoring();

        // Send call initiation signal
        if (!sendSignal({
            action: 'call',
            recipient: username
        })) {
            throw new Error('Failed to send call signal');
        }

        // Create and send offer
        const offer = await callState.peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
            iceRestart: false
        });
        
        debugLog('Created offer:', offer.type);
        await callState.peerConnection.setLocalDescription(offer);
        
        if (!sendSignal({
            action: 'offer',
            offer: offer,
            recipient: username
        })) {
            throw new Error('Failed to send offer');
        }

    } catch (error) {
        errorLog('Call initiation failed:', error);
        endCall(true);
        showNotification('Call failed: ' + error.message);
    }
}

async function handleIncomingCall(caller) {
    debugLog('Handling incoming call from:', caller);
    
    if (callState.callActive) {
        debugLog('Already in a call, rejecting incoming call');
        sendSignal({
            action: 'decline',
            recipient: caller,
            reason: 'busy'
        });
        return;
    }

    // Store the caller information but don't process yet
    callState.pendingOffer = {
        caller: caller,
        offer: null // will be set when handleOffer is called
    };
    
    callState.currentCallRecipient = caller;
    document.getElementById('callerName').textContent = `${caller} is calling...`;
    showCallAlert();
    
    // Set timeout for call acceptance
    callState.callTimeout = setTimeout(() => {
        if (!callState.callActive && callState.pendingOffer) {
            debugLog('Call acceptance timeout reached');
            sendSignal({
                action: 'decline',
                recipient: caller,
                reason: 'timeout'
            });
            endCall(false);
            showNotification(`Missed call from ${caller}`);
        }
    }, CALL_TIMEOUT);
}

async function handleOffer(offer, sender) {
    debugLog('Handling offer from:', sender);
    
    if (callState.callActive) {
        debugLog('Already in a call, rejecting offer');
        sendSignal({
            action: 'decline',
            recipient: sender,
            reason: 'busy'
        });
        return;
    }

    // Store the offer but don't process it yet
    if (callState.pendingOffer && callState.pendingOffer.caller === sender) {
        callState.pendingOffer.offer = offer;
    } else {
        // This shouldn't normally happen
        callState.pendingOffer = {
            caller: sender,
            offer: offer
        };
    }
    
    // Just show the call alert - processing will happen when user accepts
    callState.currentCallRecipient = sender;
    document.getElementById('callerName').textContent = `${sender} is calling...`;
    showCallAlert();
}

async function handleAnswer(answer, sender) {
    debugLog('Handling answer from:', sender);
    
    if (!callState.peerConnection || callState.peerConnection.signalingState !== 'have-local-offer') {
        errorLog('Unexpected answer received in current signaling state');
        return;
    }

    try {
        debugLog('Setting remote description from answer');
        await callState.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        
        // Add any queued ICE candidates
        if (callState.iceCandidates.length > 0) {
            debugLog('Adding queued ICE candidates:', callState.iceCandidates.length);
            for (const candidate of callState.iceCandidates) {
                await callState.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
            callState.iceCandidates = [];
        }
        
        toggleVideoElements(true);
        hideCallWaitingScreen();
    } catch (error) {
        errorLog('Error handling answer:', error);
        endCall(true);
    }
}

async function handleNewICECandidate(candidate) {
    debugLog('Handling new ICE candidate from remote:', candidate);
    
    if (!callState.peerConnection) {
        debugLog('No active peer connection, storing candidate');
        callState.iceCandidates.push(candidate);
        return;
    }

    try {
        // Check if we already have this candidate
        const existingCandidates = await callState.peerConnection.getReceivers().flatMap(
            receiver => receiver.transport?.iceTransport?.getRemoteCandidates() || []
        );
        
        const isDuplicate = existingCandidates.some(
            c => c.candidate === candidate.candidate
        );
        
        if (!isDuplicate) {
            debugLog('Adding new ICE candidate to peer connection');
            await callState.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            
            debugLog('Current ICE connection state:', 
                    callState.peerConnection.iceConnectionState);
        } else {
            debugLog('Skipping duplicate ICE candidate');
        }
    } catch (error) {
        errorLog('Error adding ICE candidate:', error);
    }
}

function handleCallAccepted(sender) {
    debugLog('Call accepted by:', sender);
    hideCallWaitingScreen();
    toggleVideoElements(true);
    showNotification(`${sender} accepted your call`);
}

function handleCallDeclined(sender, reason) {
    debugLog('Call declined by:', sender, 'Reason:', reason);
    showNotification(`${sender} declined your call${reason ? ` (${reason})` : ''}`);
    endCall(false);
}

function handleCallEnded(sender) {
    debugLog('Call ended by remote party:', sender);
    showNotification(`${sender} ended the call`);
    endCall(false);
}

function endCall(isInitiator) {
    debugLog('Ending call', isInitiator ? '(initiator)' : '');

    // Clear any pending call timeout
    if (callState.callTimeout) {
        clearTimeout(callState.callTimeout);
        callState.callTimeout = null;
    }

    if (isInitiator && callState.currentCallRecipient) {
        sendSignal({
            action: 'end-call',
            recipient: callState.currentCallRecipient
        });
    }

    // Clean up streams
    if (callState.localStream) {
        cleanupStream(callState.localStream);
        callState.localStream = null;
    }
    
    if (callState.remoteStream) {
        cleanupStream(callState.remoteStream);
        callState.remoteStream = null;
    }

    // Clean up peer connection
    cleanupPeerConnection();

    // Reset UI
    toggleVideoElements(false);
    hideCallAlert();
    hideCallWaitingScreen();
    
    // Reset state
    callState.currentCallRecipient = null;
    callState.callActive = false;
    callState.iceCandidates = [];
    callState.pendingOffer = null;
    
    // Clear video elements
    const remoteVideo = document.getElementById('remoteVideo');
    const localVideo = document.getElementById('localVideo');
    
    if (remoteVideo) {
        remoteVideo.srcObject = null;
    }
    if (localVideo) {
        localVideo.srcObject = null;
    }
}

// UI Control Functions
function toggleVideoElements(show) {
    debugLog(show ? 'Showing video elements' : 'Hiding video elements');
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');
    
    if (localVideo) localVideo.style.display = show ? 'block' : 'none';
    if (remoteVideo) remoteVideo.style.display = show ? 'block' : 'none';
}

function showCallAlert() {
    debugLog('Showing call alert');
    const callAlert = document.getElementById('callAlert');
    if (callAlert) callAlert.style.display = 'block';
}

function hideCallAlert() {
    debugLog('Hiding call alert');
    const callAlert = document.getElementById('callAlert');
    if (callAlert) callAlert.style.display = 'none';
}

function showCallWaitingScreen(text) {
    debugLog('Showing call waiting screen:', text);
    const waitingScreen = document.getElementById('callWaitingScreen');
    const waitingText = document.getElementById('callWaitingText');
    
    if (waitingScreen && waitingText) {
        waitingText.textContent = text;
        waitingScreen.style.display = 'block';
    }
}

function hideCallWaitingScreen() {
    debugLog('Hiding call waiting screen');
    const waitingScreen = document.getElementById('callWaitingScreen');
    if (waitingScreen) waitingScreen.style.display = 'none';
}

function showNotification(message) {
    debugLog('Showing notification:', message);
    const notificationElement = document.getElementById('notification');
    if (notificationElement) {
        notificationElement.textContent = message;
        notificationElement.style.display = 'block';
        setTimeout(() => {
            notificationElement.style.display = 'none';
        }, 5000);
    } else {
        alert(message); // Fallback
    }
}

// Event Listeners and Initialization
function setupEventListeners() {
    const acceptBtn = document.getElementById('acceptCall');
    const declineBtn = document.getElementById('declineCall');
    const cancelBtn = document.getElementById('cancelCall');
    
    if (acceptBtn) {
        acceptBtn.addEventListener('click', async () => {
            debugLog('Call accepted by local user');
            
            if (!callState.pendingOffer || !callState.pendingOffer.offer) {
                errorLog('No pending offer to accept');
                return;
            }
            
            try {
                callState.callActive = true;
                const offer = callState.pendingOffer.offer;
                const sender = callState.pendingOffer.caller;
                
                // Clear the call timeout
                if (callState.callTimeout) {
                    clearTimeout(callState.callTimeout);
                    callState.callTimeout = null;
                }
                
                // Now process the offer
                const stream = await getLocalMediaStream();
                callState.localStream = stream;
                
                const localVideo = document.getElementById('localVideo');
                if (localVideo) {
                    localVideo.srcObject = stream;
                    localVideo.onloadedmetadata = () => {
                        debugLog('Local video metadata loaded');
                        localVideo.play().catch(e => {
                            errorLog('Error playing local video:', e);
                        });
                    };
                }

                createPeerConnection();
                addLocalStreamToConnection(stream);
                startConnectionMonitoring();

                // Set remote description
                debugLog('Setting remote description from offer');
                await callState.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

                // Create and send answer
                const answer = await callState.peerConnection.createAnswer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true
                });
                
                debugLog('Created answer:', answer.type);
                await callState.peerConnection.setLocalDescription(answer);
                
                if (!sendSignal({
                    action: 'answer',
                    answer: answer,
                    recipient: sender
                })) {
                    throw new Error('Failed to send answer');
                }

                // Send acceptance signal
                sendSignal({ 
                    action: 'accept', 
                    recipient: sender 
                });
                
                toggleVideoElements(true);
                hideCallAlert();
                
            } catch (error) {
                errorLog('Error accepting call:', error);
                endCall(false);
                showNotification('Error accepting call: ' + error.message);
            }
        });
    }
    
    if (declineBtn) {
        declineBtn.addEventListener('click', () => {
            debugLog('Call declined by local user');
            
            // Clear the call timeout
            if (callState.callTimeout) {
                clearTimeout(callState.callTimeout);
                callState.callTimeout = null;
            }
            
            sendSignal({ 
                action: 'decline', 
                recipient: callState.currentCallRecipient 
            });
            endCall(false);
        });
    }
    
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            debugLog('Call canceled by local user');
            endCall(true);
        });
    }
}

// Global Error Handling
window.addEventListener('error', (event) => {
    errorLog('Global error:', event.error);
    if (callState.callActive) {
        endCall(true);
    }
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    debugLog('Video call system initializing...');
    setupEventListeners();
    toggleVideoElements(false);
    initializeVideoSocket();
});
