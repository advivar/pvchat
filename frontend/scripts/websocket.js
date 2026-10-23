// WebSocket : connexion temps reel et reception des messages

let socket = null;

function initWebSocket(currentUser, conversations, onNewMessage) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    socket = new WebSocket(wsUrl);

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === "new_message") {
                onNewMessage(data.message);
            }
        } catch (e) {
            console.error("WS message invalide", e);
        }
    };

    // Reconnexion auto si coupure
    socket.onclose = () => {
        setTimeout(() => initWebSocket(currentUser, conversations, onNewMessage), 3000);
    };
}

function closeWebSocket() {
    if (socket) socket.close();
}
