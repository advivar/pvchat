// WebSocket : connexion temps reel et reception des messages

let socket = null;
let _wsCallbacks = { onNewMessage: null, onWsEvent: null };

export function initWebSocket(currentUser, conversations, onNewMessage, onWsEvent) {
    const token = localStorage.getItem("pvchat_token");
    if (!token) return;

    // Mise a jour des callbacks (utile lors de la reconnexion)
    _wsCallbacks.onNewMessage = onNewMessage;
    _wsCallbacks.onWsEvent = onWsEvent;

    // Ferme l'ancienne connexion proprement
    if (socket && socket.readyState !== WebSocket.CLOSED) {
        try { socket.close(); } catch {}
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;

    socket = new WebSocket(wsUrl);

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === "new_message" && _wsCallbacks.onNewMessage) {
                _wsCallbacks.onNewMessage(data.message);
            } else if (_wsCallbacks.onWsEvent) {
                _wsCallbacks.onWsEvent(data);
            }
        } catch (e) {
            console.error("WS message invalide :", e);
        }
    };

    socket.onclose = (event) => {
        // Token refuse par le serveur -> deconnexion immediate
        if (event.code === 4001 || event.code === 4002) {
            localStorage.removeItem("pvchat_token");
            window.location.reload();
            return;
        }

        // Reconnexion automatique si toujours authentifie (backoff 3s)
        if (localStorage.getItem("pvchat_token")) {
            setTimeout(() => initWebSocket(currentUser, conversations, _wsCallbacks.onNewMessage, _wsCallbacks.onWsEvent), 3000);
        }
    };

    socket.onerror = () => {};
}

export function closeWebSocket() {
    if (socket) {
        socket.close();
        socket = null;
    }
}

export function getWebSocketStatus() {
    if (!socket) return "Déconnecté 🔴";
    switch (socket.readyState) {
        case WebSocket.OPEN: return "Connecté en temps réel 🟢";
        case WebSocket.CONNECTING: return "Connexion en cours 🟡";
        default: return "Déconnecté 🔴";
    }
}
