// Gestion de l'affichage des conversations et des messages

const AVATAR_COLORS = ["purple", "blue", "green", "orange"];

function getInitials(name) {
    if (!name) return "?";
    return name.slice(0, 2).toUpperCase();
}

// Couleur stable basee sur le nom (meme nom = meme couleur)
function getAvatarColor(name) {
    let sum = 0;
    for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
    return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

function formatTime(isoString) {
    if (!isoString) return "";
    return new Date(isoString).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function renderConversationList(conversations, currentConversationId, onClickCallback) {
    const list = document.getElementById("conversationList");
    list.innerHTML = "";

    if (conversations.length === 0) {
        list.innerHTML = `<p class="empty-list-notice">Aucune discussion. Créez-en une avec "+" ci-dessous.</p>`;
        return;
    }

    conversations.forEach(conv => {
        const btn = document.createElement("button");
        btn.className = "conversation" + (conv.id === currentConversationId ? " active" : "");
        btn.dataset.id = conv.id;
        btn.dataset.name = conv.other_username;

        const color = getAvatarColor(conv.other_username);
        const preview = conv.last_message || "Nouvelle discussion";

        btn.innerHTML = `
            <span class="avatar ${color}">${getInitials(conv.other_username)}</span>
            <span class="conversation-info">
                <strong>${conv.other_username}</strong>
                <small>${preview}</small>
            </span>
        `;
        btn.addEventListener("click", () => onClickCallback(conv.id));
        list.appendChild(btn);
    });
}

function renderMessages(messages, currentUser) {
    const zone = document.getElementById("messages");
    zone.innerHTML = "";

    const sep = document.createElement("div");
    sep.className = "date-separator";
    sep.innerHTML = "<span>Discussion</span>";
    zone.appendChild(sep);

    if (messages.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-chat";
        empty.textContent = "Aucun message pour le moment. Dites bonjour ! 👋";
        zone.appendChild(empty);
        return;
    }

    messages.forEach(msg => appendMessageToDOM(msg, currentUser));
    scrollToBottom();
}

function appendMessageToDOM(msg, currentUser) {
    const zone = document.getElementById("messages");

    // Pas de doublon
    if (zone.querySelector(`[data-msg-id="${msg.id}"]`)) return;

    // Retire le placeholder "aucun message"
    const empty = zone.querySelector(".empty-chat");
    if (empty) empty.remove();

    const isMe = currentUser && (msg.sender_id === currentUser.id || msg.sender_id === currentUser.userId);

    const div = document.createElement("div");
    div.className = `message ${isMe ? "sent" : "received"}`;
    div.dataset.msgId = msg.id;

    if (!isMe) {
        const color = getAvatarColor(msg.sender_name || "?");
        const avatar = document.createElement("div");
        avatar.className = `avatar ${color} message-avatar`;
        avatar.textContent = getInitials(msg.sender_name);
        div.appendChild(avatar);
    }

    const content = document.createElement("div");
    content.className = "message-content";

    if (!isMe) {
        const author = document.createElement("div");
        author.className = "message-author";
        author.textContent = msg.sender_name;
        content.appendChild(author);
    }

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.textContent = msg.content;

    const time = document.createElement("span");
    time.className = "message-time";
    time.textContent = formatTime(msg.created_at);

    content.appendChild(bubble);
    content.appendChild(time);
    div.appendChild(content);
    zone.appendChild(div);
}

function scrollToBottom() {
    const zone = document.getElementById("messages");
    zone.scrollTop = zone.scrollHeight;
}

function showWelcomeScreen() {
    const welcome = document.getElementById("welcomeScreen");
    if (welcome) welcome.style.display = "";
}

function hideWelcomeScreen() {
    const welcome = document.getElementById("welcomeScreen");
    if (welcome) welcome.style.display = "none";
}

function updateChatHeader(username) {
    const color = getAvatarColor(username);
    document.getElementById("headerAvatar").className = `avatar ${color}`;
    document.getElementById("headerAvatar").textContent = getInitials(username);
    document.getElementById("chatTitle").textContent = username;
    document.getElementById("chatStatus").textContent = "Discussion privée";
}

function setActiveSidebarConversation(convId) {
    document.querySelectorAll(".conversation").forEach(btn => {
        btn.classList.toggle("active", parseInt(btn.dataset.id) === convId);
    });
}
