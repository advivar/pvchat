// Point d'entree principal : init, messagerie, chiffrement E2EE et parametres

document.addEventListener("DOMContentLoaded", async () => {

    const token = localStorage.getItem("pvchat_token");

    // --- ETAT GLOBAL ---
    let currentUser = null;
    let conversations = [];
    let currentConversationId = null;
    let searchTimeout = null;
    let settingsTargetConvId = null;

    // Cles cryptographiques ECDH de l'utilisateur courant
    let myPrivateKey = null;
    let myPublicKeyBase64 = null;

    // ID de la conversation actuellement deverrouillee en local dans cette session de consultation
    // Des qu'on change de conversation ou qu'on clique sur Verrouiller, ce verrou retombe.
    let unlockedConversationId = null;
    let unlockedConversationPassword = null;

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
    // Normalisation de l'ID utilisateur
    currentUser.id = currentUser.id || currentUser.userId;
    currentUser.userId = currentUser.id;

    // --- INITIALISATION CRYPTO E2EE ---
    const myUserId = currentUser.id;
    myPrivateKey = await getLocalPrivateKey(myUserId);

    let remotePubKey = null;
    try {
        remotePubKey = await apiGetUserPublicKey(myUserId);
    } catch (e) {
        console.warn("Cle publique distante absente ou erreur :", e);
    }

    // Verifier la coherence de la paire de cles
    const isKeyCoherent = await verifyKeyPair(myPrivateKey, remotePubKey);

    if (!myPrivateKey || !remotePubKey || !isKeyCoherent) {
        console.log("Generation d'une nouvelle paire de cles ECDH propre...");
        const keyPair = await generateKeyPair();
        await storePrivateKey(keyPair.privateKey, myUserId);
        myPrivateKey = keyPair.privateKey;
        try {
            myPublicKeyBase64 = await exportPublicKey(keyPair.publicKey);
            await apiSavePublicKey(myPublicKeyBase64);
        } catch (err) {
            console.error("Erreur envoi cle publique :", err);
        }
    } else {
        myPublicKeyBase64 = remotePubKey;
    }

    renderProfileLoggedIn(currentUser);
    conversations = await apiGetConversations();
    _syncUnlockedState();
    renderConversationList(conversations, currentConversationId, openConversation, openConversationSettings);
    updateConversationPreviews();

    // Connexion WebSocket temps reel
    initWebSocket(currentUser, conversations, onNewMessage, onWsEvent);

    // --- HELPERS ---

    function _syncUnlockedState() {
        conversations.forEach(c => {
            c.unlocked = Boolean(c.id === unlockedConversationId);
        });
    }

    function updateLockBtnVisibility(conv) {
        const lockBtn = document.getElementById("lockConvBtn");
        if (!lockBtn) return;
        if (conv && conv.has_password && unlockedConversationId === conv.id) {
            lockBtn.style.display = "inline-flex";
        } else {
            lockBtn.style.display = "none";
        }
    }

    // --- WEBSOCKET EVENTS ---

    function onWsEvent(data) {
        if (data.type === "conversation_password_changed") {
            const conv = conversations.find(c => c.id === data.conversation_id);
            if (!conv) return;

            conv.has_password = data.has_password;

            if (!data.has_password) {
                // Mot de passe supprime
                conv.unlocked = true;
                if (currentConversationId === conv.id) {
                    unlockedConversationId = conv.id;
                    updateLockBtnVisibility(conv);
                    hideInlineUnlockScreen();
                    const messagesZone = document.getElementById("messages");
                    if (messagesZone) messagesZone.style.display = "flex";
                    document.getElementById("messageInput").disabled = false;
                    document.getElementById("sendButton").disabled = false;
                    document.getElementById("messageInput").placeholder = "Écrire un message...";
                    loadAndDisplayMessages(conv);
                }
            } else {
                // Mot de passe applique ou change
                if (unlockedConversationId === conv.id) {
                    unlockedConversationId = null;
                }
                conv.unlocked = false;
                if (currentConversationId === conv.id) {
                    updateLockBtnVisibility(conv);
                    showInlineUnlockScreen(conv);
                }
            }
            renderConversationList(conversations, currentConversationId, openConversation, openConversationSettings);
        }
    }

    // --- CLE E2EE PARTAGEE ---

    // Derive (ou reutilise) la sharedKey ECDH pour une conversation
    async function ensureSharedKey(conv) {
        const targetUserId = conv.other_user_id || conv.other_id;
        if (!targetUserId) return null;
        try {
            const targetPubKeyPem = await apiGetUserPublicKey(targetUserId);
            // Recalculer si la cle du contact a change ou si absente
            if (!conv.sharedKey || conv._targetPubKeyPem !== targetPubKeyPem) {
                conv._targetPubKeyPem = targetPubKeyPem;
                const targetPubKey = await importPublicKey(targetPubKeyPem);
                const currentId = currentUser.id || currentUser.userId;
                const myPrivKey = myPrivateKey || (await getLocalPrivateKey(currentId));
                if (!myPrivKey) {
                    console.warn("Cle privee locale absente pour userId", currentId);
                    return null;
                }
                conv.sharedKey = await deriveSharedKey(myPrivKey, targetPubKey);
            }
            return conv.sharedKey;
        } catch (err) {
            console.warn("Impossible de deriver la cle E2EE :", err);
            return null;
        }
    }

    // Dechiffre les apercus de la liste des conversations (uniquement si autorise)
    async function updateConversationPreviews() {
        let updated = false;
        for (const conv of conversations) {
            if (conv.has_password && unlockedConversationId !== conv.id) continue;
            if (!conv.last_message || !isEncryptedPayload(conv.last_message)) continue;
            try {
                await ensureSharedKey(conv);
                const text = await decryptConversationMessage(conv.last_message, conv.sharedKey);
                if (!isEncryptedPayload(text) && !text.startsWith("⚠️")) {
                    conv.last_message = text;
                    updated = true;
                }
            } catch {}
        }
        if (updated) {
            renderConversationList(conversations, currentConversationId, openConversation, openConversationSettings);
        }
    }

    // --- OUVERTURE D'UNE CONVERSATION ---

    async function openConversation(convId) {
        const nextId = parseInt(convId);
        if (isNaN(nextId)) return;

        // Regle de securite locale : naviguer vers une autre conversation reverrouille immediatement la precedente
        if (currentConversationId && currentConversationId !== nextId) {
            unlockedConversationId = null;
            unlockedConversationPassword = null;
            _syncUnlockedState();
        }

        currentConversationId = nextId;
        const conv = conversations.find(c => c.id === currentConversationId);
        if (!conv) return;

        hideWelcomeScreen();
        updateChatHeader(conv.other_username);
        setActiveSidebarConversation(currentConversationId);

        // Conversation protegee par mot de passe et actuellement verrouillee
        const isLocked = Boolean(conv.has_password && unlockedConversationId !== conv.id);
        if (isLocked) {
            conv.unlocked = false;
            updateLockBtnVisibility(conv);
            showInlineUnlockScreen(conv);
            renderConversationList(conversations, currentConversationId, openConversation, openConversationSettings);
            return;
        }

        // Conversation accessible (sans mot de passe ou deverrouillee)
        conv.unlocked = true;
        updateLockBtnVisibility(conv);
        hideInlineUnlockScreen();
        const messagesZone = document.getElementById("messages");
        if (messagesZone) messagesZone.style.display = "flex";

        document.getElementById("messageInput").disabled = false;
        document.getElementById("sendButton").disabled = false;
        document.getElementById("messageInput").placeholder = "Écrire un message...";

        await ensureSharedKey(conv);
        await loadAndDisplayMessages(conv);
        renderConversationList(conversations, currentConversationId, openConversation, openConversationSettings);
    }

    // --- ECRAN DE DEVERROUILLAGE INLINE ---

    function showInlineUnlockScreen(conv) {
        hideWelcomeScreen();
        const messagesZone = document.getElementById("messages");
        if (messagesZone) {
            messagesZone.style.display = "none";
            messagesZone.innerHTML = "";
        }
        const unlockScreen = document.getElementById("chatUnlockScreen");
        if (unlockScreen) unlockScreen.style.display = "flex";

        const pwdInput = document.getElementById("inlineUnlockPassword");
        const errorEl = document.getElementById("inlineUnlockError");
        if (pwdInput) {
            pwdInput.value = "";
            pwdInput.type = "password";
            setTimeout(() => pwdInput.focus(), 60);
        }
        const toggleBtn = document.getElementById("inlineUnlockToggleBtn");
        if (toggleBtn) toggleBtn.textContent = "👁️";
        if (errorEl) { errorEl.style.display = "none"; errorEl.textContent = ""; }

        document.getElementById("messageInput").disabled = true;
        document.getElementById("sendButton").disabled = true;
        document.getElementById("messageInput").placeholder = "Discussion verrouillée — Déverrouillez pour écrire...";
    }

    function hideInlineUnlockScreen() {
        const unlockScreen = document.getElementById("chatUnlockScreen");
        if (unlockScreen) unlockScreen.style.display = "none";
        const errorEl = document.getElementById("inlineUnlockError");
        if (errorEl) { errorEl.style.display = "none"; errorEl.textContent = ""; }
    }

    async function attemptInlineUnlock() {
        if (!currentConversationId) return;
        const conv = conversations.find(c => c.id === currentConversationId);
        if (!conv) return;

        const pwdInput = document.getElementById("inlineUnlockPassword");
        const errorEl = document.getElementById("inlineUnlockError");
        const pwd = pwdInput ? pwdInput.value.trim() : "";

        if (!pwd) {
            if (errorEl) {
                errorEl.textContent = "Veuillez entrer le mot de passe de la discussion.";
                errorEl.style.display = "block";
            }
            return;
        }

        const unlockBtn = document.getElementById("inlineUnlockBtn");
        if (unlockBtn) { unlockBtn.disabled = true; unlockBtn.textContent = "Vérification..."; }

        try {
            // Verifier le mot de passe aupres du backend
            await apiUnlockConversation(conv.id, pwd);

            // Mettre en etat deverrouille pour cette vue
            unlockedConversationId = conv.id;
            unlockedConversationPassword = pwd;
            conv.unlocked = true;
            updateLockBtnVisibility(conv);

            hideInlineUnlockScreen();
            const messagesZone = document.getElementById("messages");
            if (messagesZone) messagesZone.style.display = "flex";

            document.getElementById("messageInput").disabled = false;
            document.getElementById("sendButton").disabled = false;
            document.getElementById("messageInput").placeholder = "Écrire un message...";

            // Deriver la cle partagee ECDH puis charger les messages
            await ensureSharedKey(conv);
            await loadAndDisplayMessages(conv);

            // Met a jour les apercus dans la sidebar
            await updateConversationPreviews();
            renderConversationList(conversations, currentConversationId, openConversation, openConversationSettings);
        } catch (err) {
            if (errorEl) {
                errorEl.textContent = err.message || "Mot de passe incorrect.";
                errorEl.style.display = "block";
            }
            if (pwdInput) pwdInput.select();
        } finally {
            if (unlockBtn) { unlockBtn.disabled = false; unlockBtn.textContent = "Déverrouiller la discussion"; }
        }
    }

    const inlineUnlockBtn = document.getElementById("inlineUnlockBtn");
    const inlineUnlockPassword = document.getElementById("inlineUnlockPassword");
    const inlineUnlockToggleBtn = document.getElementById("inlineUnlockToggleBtn");
    const lockConvBtn = document.getElementById("lockConvBtn");

    if (lockConvBtn) {
        lockConvBtn.addEventListener("click", () => {
            if (!currentConversationId) return;
            const conv = conversations.find(c => c.id === currentConversationId);
            if (!conv) return;
            unlockedConversationId = null;
            unlockedConversationPassword = null;
            conv.unlocked = false;
            updateLockBtnVisibility(conv);
            showInlineUnlockScreen(conv);
            renderConversationList(conversations, currentConversationId, openConversation, openConversationSettings);
        });
    }

    if (inlineUnlockBtn) inlineUnlockBtn.addEventListener("click", attemptInlineUnlock);

    if (inlineUnlockPassword) {
        inlineUnlockPassword.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); attemptInlineUnlock(); }
        });
    }

    if (inlineUnlockToggleBtn) {
        inlineUnlockToggleBtn.addEventListener("click", () => {
            const isHidden = inlineUnlockPassword.type === "password";
            inlineUnlockPassword.type = isHidden ? "text" : "password";
            inlineUnlockToggleBtn.textContent = isHidden ? "🙈" : "👁️";
        });
    }

    // --- CHARGEMENT ET DECHIFFREMENT DES MESSAGES ---

    async function loadAndDisplayMessages(conv) {
        try {
            const headers = authHeaders();
            if (unlockedConversationPassword) {
                headers["x-conversation-password"] = unlockedConversationPassword;
            }

            const res = await fetch(`${API_BASE}/conversations/${conv.id}/messages`, {
                headers
            });

            if (!res.ok) {
                console.warn(`Erreur recuperation messages HTTP ${res.status}`);
                renderMessages([], currentUser);
                return;
            }

            const messages = await res.json();

            // S'assurer que la cle partagee E2EE est disponible
            await ensureSharedKey(conv);

            // Dechiffrement de chaque message avec la cle partagee ECDH
            for (const msg of messages) {
                msg.content = await decryptConversationMessage(msg.content, conv.sharedKey);
            }

            if (messages.length > 0) {
                conv.last_message = messages[messages.length - 1].content;
            }

            renderMessages(messages, currentUser);
        } catch (err) {
            console.error("Erreur chargement messages :", err);
            renderMessages([], currentUser);
        }
    }

    async function refreshConversations() {
        const newConversations = await apiGetConversations();
        // Conserver les cles partagees et etats calcules
        newConversations.forEach(newConv => {
            const existing = conversations.find(c => c.id === newConv.id);
            if (existing && existing.sharedKey) {
                newConv.sharedKey = existing.sharedKey;
                newConv._targetPubKeyPem = existing._targetPubKeyPem;
            }
            newConv.unlocked = Boolean(newConv.id === unlockedConversationId);
        });
        conversations = newConversations;
        renderConversationList(conversations, currentConversationId, openConversation, openConversationSettings);
        updateConversationPreviews();
    }

    // --- WEBSOCKET : NOUVEAU MESSAGE RECU ---

    async function onNewMessage(msg) {
        let conv = conversations.find(c => c.id === msg.conversation_id);

        if (!conv) {
            await refreshConversations();
            conv = conversations.find(c => c.id === msg.conversation_id);
        }

        if (conv) await ensureSharedKey(conv);

        // Dechiffrement E2EE avec la cle partagee ECDH
        const decryptedText = await decryptConversationMessage(
            msg.content,
            conv ? conv.sharedKey : null
        );
        msg.content = decryptedText;

        // Affichage dans la vue si la conversation est ouverte et non verrouillee
        if (currentConversationId && msg.conversation_id === currentConversationId) {
            const isLocked = Boolean(conv && conv.has_password && unlockedConversationId !== conv.id);
            if (!isLocked) {
                appendMessageToDOM(msg, currentUser);
                scrollToBottom();
            }
        }

        // Mise a jour de l'apercu dans la sidebar
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

            if (conv) {
                await ensureSharedKey(conv);
                // Chiffrement E2EE exclusivement avec la cle partagee ECDH
                if (conv.sharedKey) {
                    messageToSend = await encryptMessage(text, conv.sharedKey);
                }
            }

            const newMsg = await apiSendMessage(currentConversationId, messageToSend);

            // Affiche immediatement en clair cote envoyeur
            newMsg.content = text;
            appendMessageToDOM(newMsg, currentUser);
            scrollToBottom();

            if (conv) {
                conv.last_message = text;
                renderConversationList(conversations, currentConversationId, openConversation, openConversationSettings);
            }
        } catch (err) {
            console.error("Erreur envoi message :", err);
        }
    }

    document.getElementById("sendButton").addEventListener("click", sendMessage);
    document.getElementById("messageInput").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
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

        if (!query) { results.innerHTML = ""; status.textContent = ""; return; }

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

            await refreshConversations();
            openConversation(conv.id);
        } catch (err) {
            status.textContent = err.message || "Impossible de créer la conversation.";
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
        infoModal.addEventListener("click", (e) => { if (e.target === infoModal) infoModal.hidden = true; });
    }

    // --- MODALE ETAT DU CHIFFREMENT & INSPECTION DES CLES ---

    const chatStatusBtn = document.getElementById("chatStatusBtn");
    const cryptoStatusModal = document.getElementById("cryptoStatusModal");
    const closeCryptoStatusModal = document.getElementById("closeCryptoStatusModal");
    const closeCryptoStatusBtn = document.getElementById("closeCryptoStatusBtn");
    const revealKeysBtn = document.getElementById("revealKeysBtn");
    const hideKeysBtn = document.getElementById("hideKeysBtn");
    const cryptoAccountPassword = document.getElementById("cryptoAccountPassword");
    const revealKeysError = document.getElementById("revealKeysError");
    const keysAuthGate = document.getElementById("keysAuthGate");
    const keysDisplayArea = document.getElementById("keysDisplayArea");

    function hideKeysDisplay() {
        if (keysDisplayArea) keysDisplayArea.style.display = "none";
        if (hideKeysBtn) hideKeysBtn.style.display = "none";
        if (keysAuthGate) keysAuthGate.style.display = "flex";
        if (cryptoAccountPassword) cryptoAccountPassword.value = "";
        if (revealKeysError) { revealKeysError.style.display = "none"; revealKeysError.textContent = ""; }
        const ids = ["keyMyPublic", "keyMyPrivate", "keyContactPublic", "keyShared"];
        ids.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = "--"; });
    }

    if (chatStatusBtn) {
        chatStatusBtn.addEventListener("click", () => {
            const conv = conversations.find(c => c.id === currentConversationId);

            document.getElementById("statusDomain").textContent = window.location.hostname || "localhost";
            document.getElementById("statusHttpProto").textContent =
                `${window.location.protocol.replace(":", "").toUpperCase()} (Port ${window.location.port || (window.location.protocol === "https:" ? "443" : "80")})`;
            document.getElementById("statusWsProto").textContent =
                window.location.protocol === "https:" ? "WSS (WebSocket Sécurisé)" : "WS (WebSocket)";
            document.getElementById("statusWsState").textContent = getWebSocketStatus();

            const activeContactEl = document.getElementById("statusActiveContact");
            const targetPubKeyEl = document.getElementById("statusTargetPubKey");
            const sharedKeyEl = document.getElementById("statusSharedKey");
            const pwdLockEl = document.getElementById("statusPasswordLock");

            activeContactEl.textContent = conv ? `@${conv.other_username}` : "Aucune discussion active";

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
                pwdLockEl.textContent = "Activée (accès local protégé) 🔒";
                pwdLockEl.style.color = "#c4b5fd";
            } else {
                pwdLockEl.textContent = "Désactivée (E2EE standard)";
                pwdLockEl.style.color = "var(--muted)";
            }

            hideKeysDisplay();
            cryptoStatusModal.hidden = false;
        });
    }

    if (closeCryptoStatusModal) {
        closeCryptoStatusModal.addEventListener("click", () => { cryptoStatusModal.hidden = true; hideKeysDisplay(); });
    }
    if (closeCryptoStatusBtn) {
        closeCryptoStatusBtn.addEventListener("click", () => { cryptoStatusModal.hidden = true; hideKeysDisplay(); });
    }
    if (cryptoStatusModal) {
        cryptoStatusModal.addEventListener("click", (e) => {
            if (e.target === cryptoStatusModal) { cryptoStatusModal.hidden = true; hideKeysDisplay(); }
        });
    }

    // Affichage des cles apres verification du mot de passe compte
    if (revealKeysBtn) {
        revealKeysBtn.addEventListener("click", async () => {
            const pwd = cryptoAccountPassword ? cryptoAccountPassword.value : "";
            if (!pwd) {
                if (revealKeysError) {
                    revealKeysError.textContent = "Veuillez entrer votre mot de passe de compte.";
                    revealKeysError.style.display = "block";
                }
                return;
            }

            revealKeysBtn.disabled = true;
            revealKeysBtn.textContent = "Vérification...";
            if (revealKeysError) revealKeysError.style.display = "none";

            try {
                await apiVerifyAccountPassword(pwd);

                if (keysAuthGate) keysAuthGate.style.display = "none";
                if (keysDisplayArea) keysDisplayArea.style.display = "flex";
                if (hideKeysBtn) hideKeysBtn.style.display = "inline-flex";

                // Cle publique
                document.getElementById("keyMyPublic").textContent = myPublicKeyBase64 || "Introuvable";

                // Cle privee
                if (myPrivateKey) {
                    document.getElementById("keyMyPrivate").textContent = await exportPrivateKey(myPrivateKey);
                } else {
                    document.getElementById("keyMyPrivate").textContent = "Introuvable (reconnectez-vous)";
                }

                const conv = conversations.find(c => c.id === currentConversationId);

                // Cle publique du contact
                const contactWrap = document.getElementById("keyContactPublicWrap");
                if (conv && conv._targetPubKeyPem) {
                    document.getElementById("keyContactPublic").textContent = conv._targetPubKeyPem;
                    if (contactWrap) contactWrap.style.display = "flex";
                } else {
                    if (contactWrap) contactWrap.style.display = "none";
                }

                // Cle partagee AES-GCM-256
                const sharedWrap = document.getElementById("keySharedWrap");
                if (conv && conv.sharedKey) {
                    try {
                        document.getElementById("keyShared").textContent = await exportRawKey(conv.sharedKey);
                    } catch {
                        document.getElementById("keyShared").textContent = "Clé active (non exportable)";
                    }
                    if (sharedWrap) sharedWrap.style.display = "flex";
                } else {
                    if (sharedWrap) sharedWrap.style.display = "none";
                }

            } catch (err) {
                if (revealKeysError) {
                    revealKeysError.textContent = err.message || "Mot de passe incorrect.";
                    revealKeysError.style.display = "block";
                }
            } finally {
                revealKeysBtn.disabled = false;
                revealKeysBtn.textContent = "Afficher les clés 👁️";
            }
        });
    }

    if (cryptoAccountPassword) {
        cryptoAccountPassword.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); if (revealKeysBtn) revealKeysBtn.click(); }
        });
    }

    if (hideKeysBtn) hideKeysBtn.addEventListener("click", hideKeysDisplay);

    // Boutons de copie des cles
    document.querySelectorAll(".copy-key-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const targetEl = document.getElementById(btn.dataset.copyTarget);
            if (!targetEl) return;
            const text = targetEl.textContent.trim();
            if (!text || text === "--") return;
            navigator.clipboard.writeText(text).then(() => {
                const original = btn.textContent;
                btn.textContent = "Copié ✓";
                btn.classList.add("btn-copied");
                setTimeout(() => { btn.textContent = original; btn.classList.remove("btn-copied"); }, 1500);
            }).catch(() => { btn.textContent = "Erreur copie"; });
        });
    });

    // --- MODALE PARAMETRES DE CONVERSATION ---

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
        if (convPasswordInput) convPasswordInput.value = "";
        clearSettingsFeedback();

        const currentPwdFieldWrap = document.getElementById("currentPwdFieldWrap");
        const newPwdFieldLabel = document.getElementById("newPwdFieldLabel");
        const currentConvPasswordInput = document.getElementById("currentConvPasswordInput");
        const removeConvPasswordInput = document.getElementById("removeConvPasswordInput");

        if (currentConvPasswordInput) currentConvPasswordInput.value = "";
        if (removeConvPasswordInput) removeConvPasswordInput.value = "";
        if (removePwdConfirmBox) removePwdConfirmBox.hidden = true;
        if (deleteConvConfirmBox) deleteConvConfirmBox.hidden = true;

        if (conv.has_password) {
            if (pwdStatusNotice) {
                pwdStatusNotice.hidden = false;
                pwdStatusNotice.textContent = "Cette discussion est actuellement protégée par un mot de passe.";
            }
            if (currentPwdFieldWrap) currentPwdFieldWrap.hidden = false;
            if (newPwdFieldLabel) newPwdFieldLabel.style.display = "block";
            if (removeConvPasswordBtn) removeConvPasswordBtn.hidden = false;
            if (saveConvPasswordBtn) saveConvPasswordBtn.textContent = "Modifier le mot de passe";
        } else {
            if (pwdStatusNotice) pwdStatusNotice.hidden = true;
            if (currentPwdFieldWrap) currentPwdFieldWrap.hidden = true;
            if (newPwdFieldLabel) newPwdFieldLabel.style.display = "none";
            if (removeConvPasswordBtn) removeConvPasswordBtn.hidden = true;
            if (saveConvPasswordBtn) saveConvPasswordBtn.textContent = "Définir le mot de passe";
        }

        if (convSettingsModal) convSettingsModal.hidden = false;
    }

    if (closeConvSettingsModal) {
        closeConvSettingsModal.addEventListener("click", () => { convSettingsModal.hidden = true; });
    }
    if (convSettingsModal) {
        convSettingsModal.addEventListener("click", (e) => {
            if (e.target === convSettingsModal) convSettingsModal.hidden = true;
        });
    }

    // Definir / modifier le mot de passe
    if (saveConvPasswordBtn) {
        saveConvPasswordBtn.addEventListener("click", async () => {
            if (!convPasswordInput) return;
            const pwd = convPasswordInput.value.trim();
            if (!pwd || pwd.length < 4) {
                showSettingsFeedback("Le mot de passe doit contenir au moins 4 caractères.", true);
                return;
            }

            const conv = conversations.find(c => c.id === settingsTargetConvId);
            let currentPwd = null;
            if (conv && conv.has_password) {
                const el = document.getElementById("currentConvPasswordInput");
                currentPwd = el ? el.value.trim() : "";
                if (!currentPwd) {
                    showSettingsFeedback("Veuillez saisir le mot de passe actuel pour modifier la protection.", true);
                    return;
                }
            }

            try {
                await apiSetConversationPassword(settingsTargetConvId, pwd, currentPwd);
                if (conv) {
                    conv.has_password = true;
                    // La conversation est protegee et verrouillee par defaut
                    conv.unlocked = false;
                    if (unlockedConversationId === settingsTargetConvId) {
                        unlockedConversationId = null;
                        unlockedConversationPassword = null;
                    }

                    if (currentConversationId === settingsTargetConvId) {
                        updateLockBtnVisibility(conv);
                        showInlineUnlockScreen(conv);
                    }
                }
                showSettingsFeedback("Mot de passe enregistré ! Discussion protégée 🔒", false);
                convPasswordInput.value = "";
                await refreshConversations();
                setTimeout(() => { convSettingsModal.hidden = true; }, 1200);
            } catch (err) {
                showSettingsFeedback(err.message || "Erreur lors de l'enregistrement du mot de passe.", true);
            }
        });
    }

    if (convPasswordInput) {
        convPasswordInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); if (saveConvPasswordBtn) saveConvPasswordBtn.click(); }
        });
    }

    const currentConvPasswordInput = document.getElementById("currentConvPasswordInput");
    if (currentConvPasswordInput) {
        currentConvPasswordInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); if (saveConvPasswordBtn) saveConvPasswordBtn.click(); }
        });
    }

    // Supprimer le mot de passe
    if (removeConvPasswordBtn) {
        removeConvPasswordBtn.addEventListener("click", () => {
            if (removePwdConfirmBox) removePwdConfirmBox.hidden = false;
            const inp = document.getElementById("removeConvPasswordInput");
            if (inp) { inp.value = ""; inp.focus(); }
            clearSettingsFeedback();
        });
    }

    if (cancelRemovePwdBtn) {
        cancelRemovePwdBtn.addEventListener("click", () => { if (removePwdConfirmBox) removePwdConfirmBox.hidden = true; });
    }

    if (confirmRemovePwdBtn) {
        confirmRemovePwdBtn.addEventListener("click", async () => {
            const inp = document.getElementById("removeConvPasswordInput");
            const currentPwd = inp ? inp.value.trim() : "";

            if (!currentPwd) {
                showSettingsFeedback("Veuillez saisir le mot de passe actuel pour confirmer la suppression.", true);
                if (inp) inp.focus();
                return;
            }

            try {
                await apiSetConversationPassword(settingsTargetConvId, null, currentPwd);
                const conv = conversations.find(c => c.id === settingsTargetConvId);
                if (conv) {
                    conv.has_password = false;
                    conv.unlocked = true;
                    unlockedConversationId = conv.id;
                    unlockedConversationPassword = null;

                    if (currentConversationId === settingsTargetConvId) {
                        updateLockBtnVisibility(conv);
                        hideInlineUnlockScreen();
                        const messagesZone = document.getElementById("messages");
                        if (messagesZone) messagesZone.style.display = "flex";
                        document.getElementById("messageInput").disabled = false;
                        document.getElementById("sendButton").disabled = false;
                        document.getElementById("messageInput").placeholder = "Écrire un message...";
                        await loadAndDisplayMessages(conv);
                    }
                }
                if (removePwdConfirmBox) removePwdConfirmBox.hidden = true;
                if (removeConvPasswordBtn) removeConvPasswordBtn.hidden = true;
                if (pwdStatusNotice) pwdStatusNotice.hidden = true;
                const wrap = document.getElementById("currentPwdFieldWrap");
                if (wrap) wrap.hidden = true;
                const lbl = document.getElementById("newPwdFieldLabel");
                if (lbl) lbl.style.display = "none";
                if (saveConvPasswordBtn) saveConvPasswordBtn.textContent = "Définir le mot de passe";
                showSettingsFeedback("Protection supprimée. Discussion déverrouillée !", false);
                await refreshConversations();
                setTimeout(() => { convSettingsModal.hidden = true; }, 1200);
            } catch (err) {
                showSettingsFeedback(err.message || "Erreur lors de la suppression du mot de passe.", true);
            }
        });
    }

    const removeConvPasswordInput = document.getElementById("removeConvPasswordInput");
    if (removeConvPasswordInput) {
        removeConvPasswordInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); if (confirmRemovePwdBtn) confirmRemovePwdBtn.click(); }
        });
    }

    // Supprimer la conversation
    if (deleteConvBtn) {
        deleteConvBtn.addEventListener("click", () => {
            if (deleteConvConfirmBox) deleteConvConfirmBox.hidden = false;
            clearSettingsFeedback();
        });
    }

    if (cancelDeleteConvBtn) {
        cancelDeleteConvBtn.addEventListener("click", () => { if (deleteConvConfirmBox) deleteConvConfirmBox.hidden = true; });
    }

    if (confirmDeleteConvBtn) {
        confirmDeleteConvBtn.addEventListener("click", async () => {
            try {
                await apiDeleteConversation(settingsTargetConvId);
                if (deleteConvConfirmBox) deleteConvConfirmBox.hidden = true;
                convSettingsModal.hidden = true;

                if (currentConversationId === settingsTargetConvId) {
                    currentConversationId = null;
                    unlockedConversationId = null;
                    showWelcomeScreen();
                    resetChatHeader();
                    hideInlineUnlockScreen();
                    document.getElementById("messageInput").disabled = true;
                    document.getElementById("sendButton").disabled = true;
                    document.getElementById("messageInput").placeholder = "Sélectionnez une conversation...";
                }

                await refreshConversations();
            } catch (err) {
                showSettingsFeedback(err.message || "Erreur lors de la suppression.", true);
            }
        });
    }

}); // fin DOMContentLoaded

// --- PROFIL SIDEBAR ---

function renderProfileLoggedOut() {
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
    if (inp) { inp.disabled = true; inp.placeholder = "Connectez-vous pour discuter..."; }
    if (btn) btn.disabled = true;
}

function renderProfileLoggedIn(user) {
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
        window.location.reload();
    });

    profileSection.appendChild(avatarDiv);
    profileSection.appendChild(infoDiv);
    profileSection.appendChild(logoutBtn);

    const inp = document.getElementById("messageInput");
    const btn = document.getElementById("sendButton");
    if (inp) { inp.disabled = true; inp.placeholder = "Sélectionnez une conversation..."; }
    if (btn) btn.disabled = true;
}
