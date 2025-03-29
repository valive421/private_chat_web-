document.addEventListener("DOMContentLoaded", function () {
    let inputMessage = document.querySelector('input[name="message"]');
    let messageBody = document.getElementById("chatbox");
    let sendMessageForm = document.querySelector("form");
    let sent_by = document.getElementById("sent_by").innerText.trim();
    let receiver = document.querySelectorAll("#sent_to")[0].innerText;
  console.log(document.querySelectorAll("#sent_to")[0].innerText);
    document.querySelectorAll("#sent_to").forEach(button => {
        button.addEventListener("click", function () {
            receiver = this.innerText.trim();
            console.log("Chat with:", receiver);
            loadChatHistory(receiver);
        });
    });

    let loc = window.location;
    let wsStart = loc.protocol === "https:" ? "wss://" : "ws://";
    let socket = new WebSocket(wsStart + loc.host + loc.pathname+"chat/");
    console.log(wsStart + loc.host + loc.pathname+"chat/");

    socket.onopen = () => console.log("WebSocket Connected");
    socket.onerror = e => console.log("WebSocket Error:", e);
    socket.onclose = e => console.log("WebSocket Closed:", e);

    socket.onmessage = function (e) {
        let recData = JSON.parse(e.data);
        newMessage(recData.message, "receiver");
    };

    sendMessageForm.addEventListener("submit", function (e) {
        e.preventDefault();
        let message = inputMessage.value.trim();
        if (message === "" || !receiver) return;

        let data = JSON.stringify({
            "message": message,
            "sent_by": sent_by,
            "send_to": receiver
        });

        if (socket.readyState === WebSocket.OPEN) {
            socket.send(data);
        } else {
            console.error("WebSocket not open.");
        }

        inputMessage.value = "";
        newMessage(message, "sender");
    });

    function newMessage(message, senderType = "sender",time=new Date().toLocaleTimeString()) {
        if (message.trim() === "") return;

        let messageElement = document.createElement("div");
        messageElement.classList.add("chat-message", senderType);
        messageElement.innerHTML = `
            <div class="msg_cotainer ${senderType}">
                ${message}
                <span class="msg_time">${time}</span>
            </div>
        `;

        messageBody.appendChild(messageElement);
        messageBody.scrollTop = messageBody.scrollHeight;
    }
    function loadChatHistory(receiver) {
        fetch(`/chat/${receiver}/`, {
            headers: {
                "X-Requested-With": "XMLHttpRequest"  // 
            }
        })
        .then(response => response.json())  // Expect JSON response
        .then(data => {
            messageBody.innerHTML = "";
            data.messages.forEach(msg => newMessage(msg.content, msg.sender === sent_by ? "sender" : "receiver",msg.timestamp));
        })
        .catch(error => console.error("Error loading chat history:", error));
    }
    
})    