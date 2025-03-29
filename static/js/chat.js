document.addEventListener("DOMContentLoaded", function () {
    // DOM Elements
    const inputMessage = document.querySelector('input[name="message"]');
    const messageBody = document.getElementById("chatbox");
    const sendMessageForm = document.querySelector("form");
    const sent_by = document.getElementById("sent_by").innerText.trim();
    
    // State management
    let receiver = null;
    const pendingMessages = {};

    // Initialize user list with data attributes
    document.querySelectorAll("#sent_to").forEach(button => {
        const username = button.innerText.trim();
        button.innerHTML = `
            <span class="username">${username}</span>
            <span class="notification-badge" style="display: none;">0</span>
        `;
        button.dataset.username = username;
        pendingMessages[username] = 0;
    });

    // Set initial receiver
    const firstUserBtn = document.querySelector("#sent_to");
    if (firstUserBtn) {
        receiver = firstUserBtn.dataset.username;
        loadChatHistory(receiver);
    }

    // User selection handler
    document.querySelectorAll("#sent_to").forEach(button => {
        button.addEventListener("click", function (e) {
            e.preventDefault();
            const newReceiver = this.dataset.username;
            
            if (newReceiver !== receiver) {
                // Clear notifications for selected user
                receiver = newReceiver;
                pendingMessages[receiver] = 0;
                updateUserBadge(receiver, 0);
                loadChatHistory(receiver);
            }
        });
    });

    // WebSocket setup
    const loc = window.location;
    const wsStart = loc.protocol === "https:" ? "wss://" : "ws://";
    const socket = new WebSocket(wsStart + loc.host + loc.pathname + "chat/");

    socket.onopen = () => console.log("WebSocket Connected");
    socket.onerror = e => console.log("WebSocket Error:", e);
    socket.onclose = e => console.log("WebSocket Closed:", e);

    socket.onmessage = function (e) {
        const recData = JSON.parse(e.data);
        const sender = recData.sent_by;

        if (sender === receiver) {
            // Display message for active chat
            newMessage(recData.message, "receiver", recData.timestamp);
        } else {
            // Update notification badge
            pendingMessages[sender] = (pendingMessages[sender] || 0) + 1;
            updateUserBadge(sender, pendingMessages[sender]);
        }
    };

    // Message submission handler
    sendMessageForm.addEventListener("submit", function (e) {
        e.preventDefault();
        const message = inputMessage.value.trim();
        
        if (message && receiver) {
            const data = JSON.stringify({
                message: message,
                sent_by: sent_by,
                send_to: receiver
            });

            if (socket.readyState === WebSocket.OPEN) {
                socket.send(data);
                newMessage(message, "sender", new Date().toLocaleTimeString());
                inputMessage.value = "";
            }
        }
    });

    // Message rendering function
    function newMessage(message, senderType, time) {
        const messageElement = document.createElement("div");
        messageElement.classList.add("chat-message", senderType);
        messageElement.innerHTML = `
            <div class="msg_container ${senderType}">
                ${message}
                <span class="msg_time">${time}</span>
            </div>
        `;
        messageBody.appendChild(messageElement);
        messageBody.scrollTop = messageBody.scrollHeight;
    }

    // Chat history loader
    function loadChatHistory(targetUser) {
        fetch(`/chat/${targetUser}/`, {
            headers: { "X-Requested-With": "XMLHttpRequest" }
        })
        .then(response => response.json())
        .then(data => {
            messageBody.innerHTML = "";
            data.messages.forEach(msg => {
                const isSender = msg.sender === sent_by;
                newMessage(msg.content, isSender ? "sender" : "receiver", msg.timestamp);
            });
        })
        .catch(error => console.error("Error loading chat:", error));
    }

    // Badge updater
    function updateUserBadge(username, count) {
        document.querySelectorAll("#sent_to").forEach(button => {
            if (button.dataset.username === username) {
                const badge = button.querySelector(".notification-badge");
                badge.textContent = count;
                badge.style.display = count > 0 ? "inline-block" : "none";
            }
        });
    }
});