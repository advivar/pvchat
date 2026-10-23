// Point d'entree principal : init, modales, envoi de messages

document.addEventListener("DOMContentLoaded", async () => {

    const token = localStorage.getItem("pvchat_token");

    // Variables d'etat globales
    let currentUser = null;
    let conversations = [];
    let currentConversationId = null;
    let searchTimeout = null;

    // --- INIT ---

    if (!token) {
        renderProfileLoggedOut();
        return;
    }

    currentUser = await apiGetMe();
    if (!currentUser) {
        localStorage.removeItem("pvchat_token");
        renderProfileLoggedOut();
        return;
    }

    renderProfileLoggedIn(currentUser);
    conversations = await apiGetConversations();
    renderConversationList(conversations, currentConversationId, openConversation);
    initWebSocket(currentUser, conversations, onNewMessage);

    // --- CONVERSATIONS ---

    async function openConversation(convId) {
        currentConversationId = parseInt(convId);
        hideWelcomeScreen();

        const conv = conversations.find(c => c.id === currentConversationId);
        if (conv) updateChatHeader(conv.other_username);

        setActiveSidebarConversation(currentConversationId);

        document.getElementById("messageInput").disabled = false;
        document.getElementById("sendButton").disabled = false;
        document.getElementById("messageInput").placeholder = "Écrire un message...";

        const messages = await apiGetMessages(currentConversationId);
        renderMessages(messages, currentUser);
    }

    async function refreshConversations() {
        conversations = await apiGetConversations();
        renderConversationList(conversations, currentConversationId, openConversation);
    }

    // --- WEBSOCKET : message recu ---

    function onNewMessage(msg) {
        // Si on est dans cette conversation, on affiche le message
        if (currentConversationId && msg.conversation_id === currentConversationId) {
            appendMessageToDOM(msg, currentUser);
            scrollToBottom();
        }

        // Met a jour le preview dans la liste
        const conv = conversations.find(c => c.id === msg.conversation_id);
        if (conv) {
            conv.last_message = msg.content;
            renderConversationList(conversations, currentConversationId, openConversation);
        } else {
            // On a recu un message d'une nouvelle conversation
            refreshConversations();
        }
    }

    // --- ENVOI DE MESSAGE ---

    async function sendMessage() {
        const input = document.getElementById("messageInput");
        const text = input.value.trim();
        if (!text || !currentConversationId) return;

        input.value = "";

        try {
            const newMsg = await apiSendMessage(currentConversationId, text);
            appendMessageToDOM(newMsg, currentUser);
            scrollToBottom();

            // Met a jour le preview
            const conv = conversations.find(c => c.id === currentConversationId);
            if (conv) {
                conv.last_message = text;
                renderConversationList(conversations, currentConversationId, openConversation);
            }
        } catch (err) {
            console.error("Erreur envoi :", err);
        }
    }

    document.getElementById("sendButton").addEventListener("click", sendMessage);
    document.getElementById("messageInput").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // --- RECHERCHE DANS LA SIDEBAR ---

    document.getElementById("searchInput").addEventListener("input", () => {
        const q = document.getElementById("searchInput").value.toLowerCase();
        document.querySelectorAll(".conversation").forEach(btn => {
            btn.hidden = !(btn.dataset.name || "").toLowerCase().includes(q);
        });
    });

    // --- MODALE NOUVELLE CONVERSATION ---

    document.getElementById("newConversation").addEventListener("click", () => {
        const modal = document.getElementById("newChatModal");
        modal.hidden = false;
        document.getElementById("userSearchInput").value = "";
        document.getElementById("userSearchResults").innerHTML = "";
        document.getElementById("searchStatus").textContent = "";
        document.getElementById("userSearchInput").focus();
    });

    document.getElementById("closeNewChatModal").addEventListener("click", () => {
        document.getElementById("newChatModal").hidden = true;
    });

    document.getElementById("newChatModal").addEventListener("click", (e) => {
        if (e.target === document.getElementById("newChatModal")) {
            document.getElementById("newChatModal").hidden = true;
        }
    });

    document.getElementById("userSearchInput").addEventListener("input", () => {
        clearTimeout(searchTimeout);
        const query = document.getElementById("userSearchInput").value.trim();
        const results = document.getElementById("userSearchResults");
        const status = document.getElementById("searchStatus");

        if (!query) {
            results.innerHTML = "";
            status.textContent = "";
            return;
        }

        searchTimeout = setTimeout(async () => {
            status.textContent = "Recherche...";
            status.style.color = "var(--muted)";
            try {
                const users = await apiSearchUsers(query);
                results.innerHTML = "";

                if (users.length === 0) {
                    status.textContent = "Aucun utilisateur trouvé.";
                    return;
                }

                status.textContent = "";
                users.forEach(user => {
                    const item = document.createElement("div");
                    item.className = "autocomplete-item";
                    const color = getAvatarColor(user.username);

                    const avatarDiv = document.createElement("div");
                    avatarDiv.className = `avatar ${color}`;
                    avatarDiv.textContent = getInitials(user.username);

                    const strong = document.createElement("strong");
                    strong.textContent = user.username;

                    item.appendChild(avatarDiv);
                    item.appendChild(strong);

                    item.addEventListener("click", () => selectUserForChat(user.id));
                    results.appendChild(item);
                });
            } catch (err) {
                status.textContent = "Erreur de connexion.";
                status.style.color = "#fc8181";
            }
        }, 250);
    });

    async function selectUserForChat(targetUserId) {
        const status = document.getElementById("searchStatus");
        try {
            status.textContent = "Ouverture de la conversation...";
            status.style.color = "var(--muted)";

            const conv = await apiCreateConversation(targetUserId);

            document.getElementById("newChatModal").hidden = true;

            // Recharge et ouvre directement la bonne conversation
            conversations = await apiGetConversations();
            renderConversationList(conversations, conv.id, openConversation);
            openConversation(conv.id);
        } catch (err) {
            status.textContent = err.message || "Impossible de creer la conversation.";
            status.style.color = "#fc8181";
        }
    }

    // --- MODALE INFO ---

    document.getElementById("infoButton").addEventListener("click", () => {
        document.getElementById("infoModal").hidden = false;
    });
    document.getElementById("closeInfoModal").addEventListener("click", () => {
        document.getElementById("infoModal").hidden = true;
    });
    document.getElementById("confirmInfoModal").addEventListener("click", () => {
        document.getElementById("infoModal").hidden = true;
    });
    document.getElementById("infoModal").addEventListener("click", (e) => {
        if (e.target === document.getElementById("infoModal")) {
            document.getElementById("infoModal").hidden = true;
        }
    });

});

// --- PROFIL SIDEBAR ---

function renderProfileLoggedOut() {
    const profileSection = document.getElementById("profileSection");
    profileSection.innerHTML = "";

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "auth-actions";

    const loginLink = document.createElement("a");
    loginLink.href = "login.html";
    loginLink.className = "auth-btn auth-btn-primary";
    loginLink.textContent = "Connexion";

    const registerLink = document.createElement("a");
    registerLink.href = "register.html";
    registerLink.className = "auth-btn auth-btn-secondary";
    registerLink.textContent = "Inscription";

    actionsDiv.appendChild(loginLink);
    actionsDiv.appendChild(registerLink);
    profileSection.appendChild(actionsDiv);

    document.getElementById("messageInput").disabled = true;
    document.getElementById("sendButton").disabled = true;
    document.getElementById("messageInput").placeholder = "Connectez-vous pour discuter...";
}

function renderProfileLoggedIn(user) {
    const color = getAvatarColor(user.username);
    const profileSection = document.getElementById("profileSection");
    profileSection.innerHTML = "";

    const avatarDiv = document.createElement("div");
    avatarDiv.className = `avatar ${color}`;
    avatarDiv.textContent = getInitials(user.username);

    const infoDiv = document.createElement("div");
    infoDiv.className = "profile-info";

    const strong = document.createElement("strong");
    strong.textContent = user.username;

    const small = document.createElement("small");
    small.textContent = "En ligne";

    infoDiv.appendChild(strong);
    infoDiv.appendChild(small);

    const logoutBtn = document.createElement("button");
    logoutBtn.id = "logoutButton";
    logoutBtn.className = "logout-button";
    logoutBtn.textContent = "Déconnexion";
    logoutBtn.addEventListener("click", () => {
        localStorage.removeItem("pvchat_token");
        localStorage.removeItem("pvchat_username");
        window.location.reload();
    });

    profileSection.appendChild(avatarDiv);
    profileSection.appendChild(infoDiv);
    profileSection.appendChild(logoutBtn);

    // Active la zone de saisie seulement quand une conv est ouverte
    document.getElementById("messageInput").disabled = true;
    document.getElementById("sendButton").disabled = true;
    document.getElementById("messageInput").placeholder = "Sélectionnez une conversation...";
}
