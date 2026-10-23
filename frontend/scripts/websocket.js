// WebSocket : connexion temps reel et reception des messages

let socket = null;

function initWebSocket(currentUser, conversations, onNewMessage) {
    const token = localStorage.getItem("pvchat_token");
    if (!token) return;

    // Ferme l'ancienne connexion si elle existait
    if (socket) {
        try { socket.close(); } catch (e) {}
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    // Authentification via token dans la query string
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;

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

    socket.onclose = (event) => {
        // Si le token est refuse par le serveur, on deconnecte
        if (event.code === 4001 || event.code === 4002) {
            localStorage.removeItem("pvchat_token");
            window.location.reload();
            return;
        }

        // Sinon reconnexion auto apres 3s si toujours connecte
        if (localStorage.getItem("pvchat_token")) {
            setTimeout(() => initWebSocket(currentUser, conversations, onNewMessage), 3000);
        }
    };

    socket.onerror = () => {
        // En cas d'erreur reseau
    };
}

function closeWebSocket() {
    if (socket) {
        socket.close();
        socket = null;
    }
}
