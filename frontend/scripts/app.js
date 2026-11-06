// Point d'entree principal : init, modales, envoi de messages et chiffrement

document.addEventListener("DOMContentLoaded", async () => {

    const token = localStorage.getItem("pvchat_token");

    // Variables d'etat globales
    let currentUser = null;
    let conversations = [];
    let currentConversationId = null;
    let searchTimeout = null;
    let settingsTargetConvId = null;

    // Mots de passe de session pour les conversations deverrouillees
    const unlockedPasswords = new Map();
    // Cle de chiffrement derivee du mot de passe pour chaque conversation (double chiffrement)
    const passwordDerivedKeys = new Map();

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

    // --- INITIALISATION CRYPTO E2EE ---
    let myPrivateKey = await getLocalPrivateKey();

    if (!myPrivateKey) {
        // Generer la paire de cles si elle n'existe pas localement
        const keyPair = await generateKeyPair();

        // Sauvegarder la cle privee dans le navigateur (ne sort jamais du client)
        await storePrivateKey(keyPair.privateKey);
        myPrivateKey = keyPair.privateKey;

        // Exporter et envoyer la cle publique au serveur
        try {
            const pubKeyString = await exportPublicKey(keyPair.publicKey);
            await apiSavePublicKey(pubKeyString);
        } catch (err) {
            console.error("Erreur lors de l'envoi de la cle publique au serveur :", err);
        }
    }

    renderProfileLoggedIn(currentUser);
    conversations = await apiGetConversations();
    renderConversationList(conversations, currentConversationId, openConversation, openConversationSettings);
    initWebSocket(currentUser, conversations, onNewMessage);

    // --- CONVERSATIONS ---

    async function ensureSharedKey(conv) {
        if (conv.sharedKey) return conv.sharedKey;
        const targetUserId = conv.other_user_id || conv.other_id;
        try {
            const targetPubKeyPem = await apiGetUserPublicKey(targetUserId);
            const targetPubKey = await importPublicKey(targetPubKeyPem);
            const myPrivKey = await getLocalPrivateKey();
            conv.sharedKey = await deriveSharedKey(myPrivKey, targetPubKey);
            return conv.sharedKey;
        } catch (err) {
            console.warn("Impossible de deriver la cle E2EE :", err);
            return null;
        }
    }

    // Derive une cle AES-GCM a partir d'un mot de passe (PBKDF2) pour le chiffrement local du mot de passe
    async function deriveKeyFromPassword(password, saltString) {
        const enc = new TextEncoder();
        const baseKey = await window.crypto.subtle.importKey(
            "raw",
            enc.encode(password),
            { name: "PBKDF2" },
            false,
            ["deriveKey"]
        );
        return await window.crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: enc.encode(saltString || "pvchat_salt_fixed"),
                iterations: 100000,
                hash: "SHA-256"
            },
            baseKey,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
    }

    async function openConversation(convId) {
        currentConversationId = parseInt(convId);
        const conv = conversations.find(c => c.id === currentConversationId);
        if (!conv) return;

        // Si la conversation a un mot de passe et n'est pas encore deverrouillee dans la session
        if (conv.has_password && !unlockedPasswords.has(currentConversationId)) {
            promptUnlockConversation(conv);
            return;
        }

        hideWelcomeScreen();
        updateChatHeader(conv.other_username);
        setActiveSidebarConversation(currentConversationId);

        document.getElementById("messageInput").disabled = false;
        document.getElementById("sendButton").disabled = false;
        document.getElementById("messageInput").placeholder = "Écrire un message...";

        // Calcule la cle E2EE partagee si pas encore fait
        await ensureSharedKey(conv);

        // Recupere et dechiffre les messages
        await loadAndDisplayMessages(conv);
    }

    async function loadAndDisplayMessages(conv) {
        const sessionPwd = unlockedPasswords.get(conv.id);
        const headers = authHeaders();
        if (sessionPwd) {
            headers["x-conversation-password"] = sessionPwd;
        }

        try {
            const res = await fetch(`${API_BASE}/conversations/${conv.id}/messages`, { headers });
            if (res.status === 423) {
                promptUnlockConversation(conv);
                return;
            }
            if (!res.ok) {
                renderMessages([], currentUser);
                return;
            }
            const messages = await res.json();

            // Dechiffrement E2EE de chaque message
            if (conv.sharedKey) {
                for (let msg of messages) {
                    try {
                        let text = await decryptMessage(msg.content, conv.sharedKey);
                        // Si un mot de passe est defini, tentative de dechiffrement avec la cle du mot de passe
                        const pwdKey = passwordDerivedKeys.get(conv.id);
                        if (pwdKey) {
                            try {
                                text = await decryptMessage(text, pwdKey);
                            } catch (e) {}
                        }
                        msg.content = text;
                    } catch (e) {
                        msg.content = "⚠️ [Message chiffré - Impossible de déchiffrer]";
                    }
                }
            }

            renderMessages(messages, currentUser);
        } catch (err) {
            console.error("Erreur chargement messages :", err);
        }
    }

    async function refreshConversations() {
        conversations = await apiGetConversations();
        renderConversationList(conversations, currentConversationId, openConversation, openConversationSettings);
    }

    // --- WEBSOCKET : message recu ---

    async function onNewMessage(msg) {
        let conv = conversations.find(c => c.id === msg.conversation_id);

        if (!conv) {
            await refreshConversations();
            conv = conversations.find(c => c.id === msg.conversation_id);
        }

        if (conv) {
            await ensureSharedKey(conv);
        }

        // Dechiffrement du contenu
        let decryptedText = msg.content;
        if (conv && conv.sharedKey) {
            try {
                decryptedText = await decryptMessage(msg.content, conv.sharedKey);
                const pwdKey = passwordDerivedKeys.get(conv.id);
                if (pwdKey) {
                    try {
                        decryptedText = await decryptMessage(decryptedText, pwdKey);
                    } catch (e) {}
                }
            } catch (e) {
                decryptedText = "⚠️ [Message chiffré - Impossible de déchiffrer]";
            }
        }
        msg.content = decryptedText;

        // Mise a jour de la vue si la conversation est ouverte
        if (currentConversationId && msg.conversation_id === currentConversationId) {
            appendMessageToDOM(msg, currentUser);
            scrollToBottom();
        }

        // Mise a jour de la liste dans la barre laterale
        if (conv) {
            conv.last_message = decryptedText;
            renderConversationList(conversations, currentConversationId, openConversation, openConversationSettings);
        }
    }

    // --- ENVOI DE MESSAGE ---

    async function sendMessage() {
        const input = document.getElementById("messageInput");
        const text = input.value.trim();
        if (!text || !currentConversationId) return;

        input.value = "";

        try {
            const conv = conversations.find(c => c.id === currentConversationId);
            let messageToSend = text;

            // Chiffrement avec cle E2EE
            if (conv) {
                await ensureSharedKey(conv);

                // Si mot de passe actif, sur-chiffrement avec la cle issue du mot de passe
                const pwdKey = passwordDerivedKeys.get(conv.id);
                if (pwdKey) {
                    messageToSend = await encryptMessage(messageToSend, pwdKey);
                }

                if (conv.sharedKey) {
                    messageToSend = await encryptMessage(messageToSend, conv.sharedKey);
                }
            }

            const newMsg = await apiSendMessage(currentConversationId, messageToSend);

            // Affiche en local le texte en clair directement
            newMsg.content = text;
            appendMessageToDOM(newMsg, currentUser);
            scrollToBottom();

            if (conv) {
                conv.last_message = text;
                renderConversationList(conversations, currentConversationId, openConversation, openConversationSettings);
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
            renderConversationList(conversations, conv.id, openConversation, openConversationSettings);
            openConversation(conv.id);
        } catch (err) {
            status.textContent = err.message || "Impossible de creer la conversation.";
            status.style.color = "#fc8181";
        }
    }

    // --- MODALE INFO & ETAT SERVEUR ---

    const infoButton = document.getElementById("infoButton");
    const infoModal = document.getElementById("infoModal");
    const closeInfoModal = document.getElementById("closeInfoModal");
    const confirmInfoModal = document.getElementById("confirmInfoModal");

    if (infoButton) {
        infoButton.addEventListener("click", () => {
            document.getElementById("infoServerHost").textContent = window.location.host;
            document.getElementById("infoServerProtocol").textContent = window.location.protocol.replace(":", "").toUpperCase();
            document.getElementById("infoWsStatus").textContent = getWebSocketStatus();
            infoModal.hidden = false;
        });
    }

    if (closeInfoModal) closeInfoModal.addEventListener("click", () => { infoModal.hidden = true; });
    if (confirmInfoModal) confirmInfoModal.addEventListener("click", () => { infoModal.hidden = true; });
    if (infoModal) {
        infoModal.addEventListener("click", (e) => {
            if (e.target === infoModal) infoModal.hidden = true;
        });
    }

    // --- MODALE ETAT DE CONNEXION ET DU CHIFFREMENT (SOUS LE PSEUDO) ---

    const chatStatusBtn = document.getElementById("chatStatusBtn");
    const cryptoStatusModal = document.getElementById("cryptoStatusModal");
    const closeCryptoStatusModal = document.getElementById("closeCryptoStatusModal");
    const closeCryptoStatusBtn = document.getElementById("closeCryptoStatusBtn");

    if (chatStatusBtn) {
        chatStatusBtn.addEventListener("click", () => {
            const conv = conversations.find(c => c.id === currentConversationId);

            document.getElementById("statusDomain").textContent = window.location.hostname || "localhost";
            document.getElementById("statusHttpProto").textContent = `${window.location.protocol.replace(":", "").toUpperCase()} (Port ${window.location.port || (window.location.protocol === "https:" ? "443" : "80")})`;
            document.getElementById("statusWsProto").textContent = window.location.protocol === "https:" ? "WSS (WebSocket Sécurisé)" : "WS (WebSocket)";
            document.getElementById("statusWsState").textContent = getWebSocketStatus();

            const targetPubKeyEl = document.getElementById("statusTargetPubKey");
            const sharedKeyEl = document.getElementById("statusSharedKey");
            const pwdLockEl = document.getElementById("statusPasswordLock");

            if (conv && conv.sharedKey) {
                targetPubKeyEl.textContent = "Vérifiée et active 🟢";
                targetPubKeyEl.className = "status-badge status-badge-ok";
                sharedKeyEl.textContent = "Dérivée (AES-GCM-256) 🔑";
                sharedKeyEl.className = "status-badge status-badge-ok";
            } else {
                targetPubKeyEl.textContent = "En attente d'échange 🟡";
                targetPubKeyEl.className = "status-badge status-badge-warn";
                sharedKeyEl.textContent = "En attente 🟡";
                sharedKeyEl.className = "status-badge status-badge-warn";
            }

            if (conv && conv.has_password) {
                pwdLockEl.textContent = "Activée (Double chiffrement PBKDF2) 🔒";
                pwdLockEl.style.color = "#c4b5fd";
            } else {
                pwdLockEl.textContent = "Désactivée (E2EE standard)";
                pwdLockEl.style.color = "var(--muted)";
            }

            cryptoStatusModal.hidden = false;
        });
    }

    if (closeCryptoStatusModal) closeCryptoStatusModal.addEventListener("click", () => { cryptoStatusModal.hidden = true; });
    if (closeCryptoStatusBtn) closeCryptoStatusBtn.addEventListener("click", () => { cryptoStatusModal.hidden = true; });
    if (cryptoStatusModal) {
        cryptoStatusModal.addEventListener("click", (e) => {
            if (e.target === cryptoStatusModal) cryptoStatusModal.hidden = true;
        });
    }

    // --- MODALE PARAMETRES DE CONVERSATION (DECLENCHEE DEPUIS LA SIDEBAR) ---

    const convSettingsModal = document.getElementById("convSettingsModal");
    const closeConvSettingsModal = document.getElementById("closeConvSettingsModal");
    const saveConvPasswordBtn = document.getElementById("saveConvPasswordBtn");
    const removeConvPasswordBtn = document.getElementById("removeConvPasswordBtn");
    const deleteConvBtn = document.getElementById("deleteConvBtn");
    const convPasswordInput = document.getElementById("convPasswordInput");
    const pwdStatusNotice = document.getElementById("pwdStatusNotice");
    const convSettingsFeedback = document.getElementById("convSettingsFeedback");

    const removePwdConfirmBox = document.getElementById("removePwdConfirmBox");
    const cancelRemovePwdBtn = document.getElementById("cancelRemovePwdBtn");
    const confirmRemovePwdBtn = document.getElementById("confirmRemovePwdBtn");

    const deleteConvConfirmBox = document.getElementById("deleteConvConfirmBox");
    const cancelDeleteConvBtn = document.getElementById("cancelDeleteConvBtn");
    const confirmDeleteConvBtn = document.getElementById("confirmDeleteConvBtn");

    function showSettingsFeedback(message, isError = false) {
        if (!convSettingsFeedback) return;
        convSettingsFeedback.textContent = message;
        convSettingsFeedback.className = `settings-feedback ${isError ? "settings-feedback-error" : "settings-feedback-success"}`;
        convSettingsFeedback.hidden = false;
    }

    function clearSettingsFeedback() {
        if (!convSettingsFeedback) return;
        convSettingsFeedback.hidden = true;
        convSettingsFeedback.textContent = "";
    }

    function openConversationSettings(convId) {
        settingsTargetConvId = parseInt(convId);
        const conv = conversations.find(c => c.id === settingsTargetConvId);
        if (!conv) return;

        document.getElementById("convSettingsTitle").textContent = `Paramètres — ${conv.other_username}`;
        convPasswordInput.value = "";
        clearSettingsFeedback();

        if (removePwdConfirmBox) removePwdConfirmBox.hidden = true;
        if (deleteConvConfirmBox) deleteConvConfirmBox.hidden = true;

        if (conv.has_password) {
            pwdStatusNotice.hidden = false;
            pwdStatusNotice.textContent = "Cette discussion est actuellement protégée par un mot de passe.";
            removeConvPasswordBtn.hidden = false;
            saveConvPasswordBtn.textContent = "Modifier le mot de passe";
        } else {
            pwdStatusNotice.hidden = true;
            removeConvPasswordBtn.hidden = true;
            saveConvPasswordBtn.textContent = "Définir le mot de passe";
        }

        convSettingsModal.hidden = false;
    }

    if (closeConvSettingsModal) {
        closeConvSettingsModal.addEventListener("click", () => {
            convSettingsModal.hidden = true;
        });
    }

    if (convSettingsModal) {
        convSettingsModal.addEventListener("click", (e) => {
            if (e.target === convSettingsModal) {
                convSettingsModal.hidden = true;
            }
        });
    }

    // Definir / modifier mot de passe de conversation (sans alert)
    if (saveConvPasswordBtn) {
        saveConvPasswordBtn.addEventListener("click", async () => {
            const pwd = convPasswordInput.value.trim();
            if (!pwd || pwd.length < 4) {
                showSettingsFeedback("Le mot de passe doit contenir au moins 4 caractères.", true);
                return;
            }

            try {
                await apiSetConversationPassword(settingsTargetConvId, pwd);
                const conv = conversations.find(c => c.id === settingsTargetConvId);
                if (conv) {
                    conv.has_password = true;
                    unlockedPasswords.set(settingsTargetConvId, pwd);
                    const derivedKey = await deriveKeyFromPassword(pwd, `conv_${settingsTargetConvId}`);
                    passwordDerivedKeys.set(settingsTargetConvId, derivedKey);
                }
                showSettingsFeedback("Mot de passe enregistré avec succès !", false);
                convPasswordInput.value = "";
                await refreshConversations();

                setTimeout(() => {
                    convSettingsModal.hidden = true;
                }, 1200);
            } catch (err) {
                showSettingsFeedback(err.message || "Erreur lors de l'enregistrement du mot de passe.", true);
            }
        });
    }

    // Supprimer mot de passe de conversation (confirmation integree, sans confirm)
    if (removeConvPasswordBtn) {
        removeConvPasswordBtn.addEventListener("click", () => {
            removePwdConfirmBox.hidden = false;
            clearSettingsFeedback();
        });
    }

    if (cancelRemovePwdBtn) {
        cancelRemovePwdBtn.addEventListener("click", () => {
            removePwdConfirmBox.hidden = true;
        });
    }

    if (confirmRemovePwdBtn) {
        confirmRemovePwdBtn.addEventListener("click", async () => {
            try {
                await apiSetConversationPassword(settingsTargetConvId, null);
                const conv = conversations.find(c => c.id === settingsTargetConvId);
                if (conv) {
                    conv.has_password = false;
                    unlockedPasswords.delete(settingsTargetConvId);
                    passwordDerivedKeys.delete(settingsTargetConvId);
                }
                removePwdConfirmBox.hidden = true;
                removeConvPasswordBtn.hidden = true;
                pwdStatusNotice.hidden = true;
                saveConvPasswordBtn.textContent = "Définir le mot de passe";
                showSettingsFeedback("Mot de passe supprimé avec succès.", false);
                await refreshConversations();

                setTimeout(() => {
                    convSettingsModal.hidden = true;
                }, 1200);
            } catch (err) {
                showSettingsFeedback(err.message || "Erreur lors de la suppression du mot de passe.", true);
            }
        });
    }

    // Supprimer la conversation de son compte (confirmation integree, sans confirm)
    if (deleteConvBtn) {
        deleteConvBtn.addEventListener("click", () => {
            deleteConvConfirmBox.hidden = false;
            clearSettingsFeedback();
        });
    }

    if (cancelDeleteConvBtn) {
        cancelDeleteConvBtn.addEventListener("click", () => {
            deleteConvConfirmBox.hidden = true;
        });
    }

    if (confirmDeleteConvBtn) {
        confirmDeleteConvBtn.addEventListener("click", async () => {
            try {
                await apiDeleteConversation(settingsTargetConvId);
                deleteConvConfirmBox.hidden = true;
                convSettingsModal.hidden = true;

                if (currentConversationId === settingsTargetConvId) {
                    currentConversationId = null;
                    showWelcomeScreen();
                    resetChatHeader();
                    document.getElementById("messageInput").disabled = true;
                    document.getElementById("sendButton").disabled = true;
                    document.getElementById("messageInput").placeholder = "Sélectionnez une conversation...";
                }

                await refreshConversations();
            } catch (err) {
                showSettingsFeedback(err.message || "Erreur lors de la suppression de la conversation.", true);
            }
        });
    }

    // --- MODALE DEVERROUILLAGE CONVERSATION ---

    let pendingUnlockConv = null;

    function promptUnlockConversation(conv) {
        pendingUnlockConv = conv;
        const modal = document.getElementById("unlockModal");
        const input = document.getElementById("unlockPasswordInput");
        const error = document.getElementById("unlockError");

        input.value = "";
        error.hidden = true;
        error.textContent = "";
        modal.hidden = false;
        input.focus();
    }

    const confirmUnlockBtn = document.getElementById("confirmUnlockBtn");
    const cancelUnlockBtn = document.getElementById("cancelUnlockBtn");
    const closeUnlockModal = document.getElementById("closeUnlockModal");
    const unlockPasswordInput = document.getElementById("unlockPasswordInput");
    const unlockError = document.getElementById("unlockError");

    async function attemptUnlock() {
        if (!pendingUnlockConv) return;
        const pwd = unlockPasswordInput.value.trim();
        if (!pwd) return;

        try {
            await apiUnlockConversation(pendingUnlockConv.id, pwd);
            unlockedPasswords.set(pendingUnlockConv.id, pwd);
            const derivedKey = await deriveKeyFromPassword(pwd, `conv_${pendingUnlockConv.id}`);
            passwordDerivedKeys.set(pendingUnlockConv.id, derivedKey);

            document.getElementById("unlockModal").hidden = true;

            const targetConv = pendingUnlockConv;
            pendingUnlockConv = null;
            openConversation(targetConv.id);
        } catch (err) {
            unlockError.textContent = "Mot de passe incorrect.";
            unlockError.hidden = false;
        }
    }

    if (confirmUnlockBtn) confirmUnlockBtn.addEventListener("click", attemptUnlock);
    if (unlockPasswordInput) {
        unlockPasswordInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                attemptUnlock();
            }
        });
    }

    if (cancelUnlockBtn) {
        cancelUnlockBtn.addEventListener("click", () => {
            document.getElementById("unlockModal").hidden = true;
            pendingUnlockConv = null;
        });
    }
    if (closeUnlockModal) {
        closeUnlockModal.addEventListener("click", () => {
            document.getElementById("unlockModal").hidden = true;
            pendingUnlockConv = null;
        });
    }

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

    document.getElementById("messageInput").disabled = true;
    document.getElementById("sendButton").disabled = true;
    document.getElementById("messageInput").placeholder = "Sélectionnez une conversation...";
}
