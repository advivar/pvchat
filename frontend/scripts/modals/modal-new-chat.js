// Modale de création d'une nouvelle discussion et autocomplétion des utilisateurs

import { apiSearchUsers, apiCreateConversation } from '../api.js';
import { getAvatarColor, getInitials } from '../ui.js';
import { refreshConversations } from '../chat/messages.js';

let searchTimeout = null;
let _openConversationCallback = null;

export function initNewChatModal(openConversationCallback) {
    _openConversationCallback = openConversationCallback;

    const newConvBtn = document.getElementById("newConversation");
    const modal = document.getElementById("newChatModal");
    const closeBtn = document.getElementById("closeNewChatModal");
    const searchInput = document.getElementById("userSearchInput");

    if (!modal) return;

    if (newConvBtn) {
        newConvBtn.addEventListener("click", () => {
            modal.hidden = false;
            if (searchInput) {
                searchInput.value = "";
                searchInput.focus();
            }
            const results = document.getElementById("userSearchResults");
            const status = document.getElementById("searchStatus");
            if (results) results.innerHTML = "";
            if (status) status.textContent = "";
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener("click", () => { modal.hidden = true; });
    }

    modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.hidden = true;
    });

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            clearTimeout(searchTimeout);
            const query = searchInput.value.trim();
            const results = document.getElementById("userSearchResults");
            const status = document.getElementById("searchStatus");

            if (!query) {
                if (results) results.innerHTML = "";
                if (status) status.textContent = "";
                return;
            }

            searchTimeout = setTimeout(async () => {
                if (status) {
                    status.textContent = "Recherche...";
                    status.style.color = "var(--muted)";
                }
                try {
                    const users = await apiSearchUsers(query);
                    if (results) results.innerHTML = "";

                    if (users.length === 0) {
                        if (status) status.textContent = "Aucun utilisateur trouvé.";
                        return;
                    }

                    if (status) status.textContent = "";

                    users.forEach(user => {
                        const item = document.createElement("div");
                        item.className = "autocomplete-item";

                        const avatarDiv = document.createElement("div");
                        avatarDiv.className = `avatar ${getAvatarColor(user.username)}`;
                        avatarDiv.textContent = getInitials(user.username);

                        const strong = document.createElement("strong");
                        strong.textContent = user.username;

                        item.appendChild(avatarDiv);
                        item.appendChild(strong);
                        item.addEventListener("click", () => selectUserForChat(user.id));
                        results.appendChild(item);
                    });
                } catch {
                    if (status) {
                        status.textContent = "Erreur de connexion.";
                        status.style.color = "#fc8181";
                    }
                }
            }, 250);
        });
    }
}

async function selectUserForChat(targetUserId) {
    const status = document.getElementById("searchStatus");
    const modal = document.getElementById("newChatModal");

    try {
        if (status) {
            status.textContent = "Ouverture de la conversation...";
            status.style.color = "var(--muted)";
        }

        const conv = await apiCreateConversation(targetUserId);
        if (modal) modal.hidden = true;

        await refreshConversations();
        if (_openConversationCallback) {
            _openConversationCallback(conv.id);
        }
    } catch (err) {
        if (status) {
            status.textContent = err.message || "Impossible de créer la conversation.";
            status.style.color = "#fc8181";
        }
    }
}
