// Gestion de l'affichage des conversations, messages et profils

import { isEncryptedPayload } from './crypto.js';
import { parseMarkdown, stripMarkdown, updateToolbarDisabledState, syncInputHighlights } from './chat/format.js';

const AVATAR_COLORS = ["purple", "blue", "green", "orange"];

export function getInitials(name) {
    if (!name) return "?";
    return name.slice(0, 2).toUpperCase();
}

// Couleur stable basee sur le nom (meme nom = meme couleur)
export function getAvatarColor(name) {
    let sum = 0;
    for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
    return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

export function formatTime(isoString) {
    if (!isoString) return "";
    return new Date(isoString).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Formate une date ISO en chaine lisible pour les separateurs de jour
export function formatDate(isoString) {
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
export function getDateKey(isoString) {
    if (!isoString) return "";
    return new Date(isoString).toDateString();
}

export function renderConversationList(conversations, currentConversationId, onClickCallback, onSettingsCallback) {
    const list = document.getElementById("conversationList");
    if (!list) return;
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
            if (conv.unlocked && conv.last_message && !isEncryptedPayload(conv.last_message) && !conv.last_message.startsWith("🔒 [Message") && !conv.last_message.startsWith("⚠️")) {
                preview = "🔒 " + stripMarkdown(conv.last_message);
            } else {
                preview = "🔒 Discussion protégée par mot de passe";
            }
        } else if (conv.last_message) {
            if (isEncryptedPayload(conv.last_message) || conv.last_message.startsWith("🔒 [Message") || conv.last_message.startsWith("⚠️")) {
                preview = "🔒 Message chiffré";
            } else {
                preview = stripMarkdown(conv.last_message);
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
        settingsBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
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

export function renderMessages(messages, currentUser) {
    const zone = document.getElementById("messages");
    if (!zone) return;
    zone.innerHTML = "";

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

export function appendMessageToDOM(msg, currentUser) {
    const zone = document.getElementById("messages");
    if (!zone) return;

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
    if (msg.content && (msg.content.startsWith("🔒 [Message") || msg.content.startsWith("⚠️ [Message"))) {
        bubble.classList.add("message-bubble-notice");
        bubble.textContent = msg.content;
    } else {
        bubble.innerHTML = parseMarkdown(msg.content);
    }

    const time = document.createElement("span");
    time.className = "message-time";
    time.textContent = formatTime(msg.created_at);

    content.appendChild(bubble);
    content.appendChild(time);
    div.appendChild(content);
    zone.appendChild(div);
}

export function scrollToBottom() {
    const zone = document.getElementById("messages");
    if (zone) zone.scrollTop = zone.scrollHeight;
}

export function openMobileChat() {
    const app = document.querySelector(".app");
    if (app) app.classList.add("mobile-chat-open");
}

export function closeMobileChat() {
    const app = document.querySelector(".app");
    if (app) app.classList.remove("mobile-chat-open");
}

export function showWelcomeScreen() {
    const welcome = document.getElementById("welcomeScreen");
    const unlock = document.getElementById("chatUnlockScreen");
    const messages = document.getElementById("messages");
    if (welcome) welcome.style.display = "flex";
    if (unlock) unlock.style.display = "none";
    if (messages) {
        messages.style.display = "none";
        messages.innerHTML = "";
    }
    closeMobileChat();
    updateToolbarDisabledState(true);
    const inp = document.getElementById("messageInput");
    if (inp) syncInputHighlights(inp);
}

export function hideWelcomeScreen() {
    const welcome = document.getElementById("welcomeScreen");
    if (welcome) welcome.style.display = "none";
}

export function updateChatHeader(username) {
    const color = getAvatarColor(username);
    const headerAvatar = document.getElementById("headerAvatar");
    if (headerAvatar) {
        headerAvatar.className = `avatar ${color}`;
        headerAvatar.textContent = getInitials(username);
    }
    const chatTitle = document.getElementById("chatTitle");
    if (chatTitle) chatTitle.textContent = username;

    const statusBtn = document.getElementById("chatStatusBtn");
    const placeholder = document.getElementById("chatStatusPlaceholder");
    if (statusBtn) statusBtn.style.display = "inline-flex";
    if (placeholder) placeholder.style.display = "none";
}

export function resetChatHeader() {
    const headerAvatar = document.getElementById("headerAvatar");
    if (headerAvatar) {
        headerAvatar.className = "avatar purple";
        headerAvatar.textContent = "--";
    }
    const chatTitle = document.getElementById("chatTitle");
    if (chatTitle) chatTitle.textContent = "Sélectionnez une discussion";

    const statusBtn = document.getElementById("chatStatusBtn");
    const placeholder = document.getElementById("chatStatusPlaceholder");
    if (statusBtn) statusBtn.style.display = "none";
    if (placeholder) placeholder.style.display = "";

    const lockBtn = document.getElementById("lockConvBtn");
    if (lockBtn) lockBtn.style.display = "none";
}

export function setActiveSidebarConversation(convId) {
    document.querySelectorAll(".conversation").forEach(btn => {
        btn.classList.toggle("active", parseInt(btn.dataset.id) === convId);
    });
}

export function renderProfileLoggedOut() {
    const profileSection = document.getElementById("profileSection");
    if (!profileSection) return;
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

    const inp = document.getElementById("messageInput");
    const btn = document.getElementById("sendButton");
    if (inp) {
        inp.disabled = true;
        inp.placeholder = "Connectez-vous pour discuter...";
        syncInputHighlights(inp);
    }
    if (btn) btn.disabled = true;
    updateToolbarDisabledState(true);
}

export function renderProfileLoggedIn(user) {
    const profileSection = document.getElementById("profileSection");
    if (!profileSection) return;
    profileSection.innerHTML = "";

    const color = getAvatarColor(user.username);

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
        localStorage.removeItem("pvchat_user_id");
        window.location.reload();
    });

    profileSection.appendChild(avatarDiv);
    profileSection.appendChild(infoDiv);
    profileSection.appendChild(logoutBtn);

    const inp = document.getElementById("messageInput");
    const btn = document.getElementById("sendButton");
    if (inp) {
        inp.disabled = true;
        inp.placeholder = "Sélectionnez une conversation...";
        syncInputHighlights(inp);
    }
    if (btn) btn.disabled = true;
    updateToolbarDisabledState(true);
}
