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

// Formate une date ISO en chaine lisible pour les separateurs de jour
function formatDate(isoString) {
    if (!isoString) return "";
    const date = new Date(isoString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return "Aujourd'hui";
    if (date.toDateString() === yesterday.toDateString()) return "Hier";

    const options = { weekday: "long", day: "numeric", month: "long" };
    if (date.getFullYear() !== today.getFullYear()) options.year = "numeric";
    return date.toLocaleDateString("fr-FR", options);
}

// Extrait la date (sans heure) d'une chaine ISO pour comparaison
function getDateKey(isoString) {
    if (!isoString) return "";
    return new Date(isoString).toDateString();
}

function renderConversationList(conversations, currentConversationId, onClickCallback, onSettingsCallback) {
    const list = document.getElementById("conversationList");
    list.innerHTML = "";

    if (conversations.length === 0) {
        const emptyP = document.createElement("p");
        emptyP.className = "empty-list-notice";
        emptyP.textContent = "Aucune discussion. Créez-en une avec '+' ci-dessous.";
        list.appendChild(emptyP);
        return;
    }

    conversations.forEach(conv => {
        const item = document.createElement("div");
        item.className = "conversation" + (conv.id === currentConversationId ? " active" : "");
        item.dataset.id = conv.id;
        item.dataset.name = conv.other_username;
        item.setAttribute("role", "button");
        item.setAttribute("tabindex", "0");

        const color = getAvatarColor(conv.other_username);

        // Affiche un apercu propre selon l'etat de verrouillage et de chiffrement
        let preview = "Nouvelle discussion";
        if (conv.has_password) {
            if (conv.unlocked && conv.last_message && !isEncryptedPayload(conv.last_message)) {
                preview = "🔒 " + conv.last_message;
            } else {
                preview = "🔒 Discussion protégée par mot de passe";
            }
        } else if (conv.last_message) {
            if (typeof isEncryptedPayload === "function" && isEncryptedPayload(conv.last_message)) {
                preview = "🔒 Message chiffré";
            } else {
                preview = conv.last_message;
            }
        }

        const avatarSpan = document.createElement("span");
        avatarSpan.className = `avatar ${color}`;
        avatarSpan.textContent = getInitials(conv.other_username);

        const infoSpan = document.createElement("span");
        infoSpan.className = "conversation-info";

        const strong = document.createElement("strong");
        strong.textContent = conv.other_username;

        const small = document.createElement("small");
        small.textContent = preview;

        infoSpan.appendChild(strong);
        infoSpan.appendChild(small);
        item.appendChild(avatarSpan);
        item.appendChild(infoSpan);

        // Bouton parametres au survol a droite
        const settingsBtn = document.createElement("button");
        settingsBtn.className = "conv-item-settings-btn";
        settingsBtn.innerHTML = "⚙";
        settingsBtn.title = `Paramètres de ${conv.other_username}`;
        settingsBtn.setAttribute("type", "button");
        settingsBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (onSettingsCallback) onSettingsCallback(conv.id);
        });
        item.appendChild(settingsBtn);

        item.addEventListener("click", () => onClickCallback(conv.id));
        item.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClickCallback(conv.id);
            }
        });

        list.appendChild(item);
    });
}

function renderMessages(messages, currentUser) {
    const zone = document.getElementById("messages");
    zone.innerHTML = "";

    if (messages.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-chat";
        empty.textContent = "Aucun message pour le moment. Dites bonjour ! 👋";
        zone.appendChild(empty);
        return;
    }

    // Affiche les messages avec separateurs de jour automatiques
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

    // Separateur de jour si la date change par rapport au dernier message affiche
    const newDateKey = getDateKey(msg.created_at);
    const allMessages = zone.querySelectorAll(".message");
    const lastMessage = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null;
    const lastDateKey = lastMessage ? lastMessage.dataset.date : null;

    if (newDateKey && newDateKey !== lastDateKey) {
        const sep = document.createElement("div");
        sep.className = "date-separator";
        const sepSpan = document.createElement("span");
        sepSpan.textContent = formatDate(msg.created_at);
        sep.appendChild(sepSpan);
        zone.appendChild(sep);
    }

    const isMe = currentUser && (msg.sender_id === currentUser.id || msg.sender_id === currentUser.userId);

    const div = document.createElement("div");
    div.className = `message ${isMe ? "sent" : "received"}`;
    div.dataset.msgId = msg.id;
    div.dataset.date = newDateKey;

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
    const unlock = document.getElementById("chatUnlockScreen");
    const messages = document.getElementById("messages");
    if (welcome) welcome.style.display = "flex";
    if (unlock) unlock.style.display = "none";
    if (messages) {
        messages.style.display = "none";
        messages.innerHTML = "";
    }
}

function hideWelcomeScreen() {
    const welcome = document.getElementById("welcomeScreen");
    if (welcome) welcome.style.display = "none";
}

function updateChatHeader(username) {
    const color = getAvatarColor(username);
    const headerAvatar = document.getElementById("headerAvatar");
    headerAvatar.className = `avatar ${color}`;
    headerAvatar.textContent = getInitials(username);
    document.getElementById("chatTitle").textContent = username;

    const statusBtn = document.getElementById("chatStatusBtn");
    const placeholder = document.getElementById("chatStatusPlaceholder");
    if (statusBtn) statusBtn.style.display = "inline-flex";
    if (placeholder) placeholder.style.display = "none";
}

function resetChatHeader() {
    const headerAvatar = document.getElementById("headerAvatar");
    headerAvatar.className = "avatar purple";
    headerAvatar.textContent = "--";
    document.getElementById("chatTitle").textContent = "Sélectionnez une discussion";

    const statusBtn = document.getElementById("chatStatusBtn");
    const placeholder = document.getElementById("chatStatusPlaceholder");
    if (statusBtn) statusBtn.style.display = "none";
    if (placeholder) placeholder.style.display = "";

    const lockBtn = document.getElementById("lockConvBtn");
    if (lockBtn) lockBtn.style.display = "none";
}

function setActiveSidebarConversation(convId) {
    document.querySelectorAll(".conversation").forEach(btn => {
        btn.classList.toggle("active", parseInt(btn.dataset.id) === convId);
    });
}
