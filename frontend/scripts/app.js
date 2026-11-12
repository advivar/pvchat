// Point d'entrée principal de l'application PVCHAT

import { state, syncUnlockedState, updateLockBtnVisibility } from './state.js';
import { apiGetMe, apiGetConversations, apiSavePublicKey, apiGetUserPublicKey } from './api.js';
import {
    generateKeyPair,
    storeLocalKeyPair,
    storeLocalPublicKey,
    getLocalPublicKey,
    exportPublicKey,
    getLocalPrivateKey,
    verifyKeyPair,
    cleanupLegacyKeys
} from './crypto.js';
import {
    renderProfileLoggedOut,
    renderProfileLoggedIn,
    renderConversationList,
    updateChatHeader,
    setActiveSidebarConversation,
    hideWelcomeScreen,
    openMobileChat,
    closeMobileChat
} from './ui.js';
import { initWebSocket } from './websocket.js';
import {
    ensureSharedKey,
    loadAndDisplayMessages,
    updateConversationPreviews,
    onNewMessage,
    initMessageComposer
} from './chat/messages.js';
import { updateToolbarDisabledState, initFormatToolbar } from './chat/format.js';
import {
    showInlineUnlockScreen,
    hideInlineUnlockScreen,
    initUnlockEvents
} from './chat/unlock.js';
import { initNewChatModal } from './modals/modal-new-chat.js';
import { initInfoModal } from './modals/modal-info.js';
import { initCryptoModal } from './modals/modal-crypto.js';
import { initSettingsModal, openConversationSettings } from './modals/modal-settings.js';

document.addEventListener("DOMContentLoaded", async () => {
    // Initialisation immédiate de la barre d'outils de formatage
    const initialMsgInput = document.getElementById("messageInput");
    initFormatToolbar(initialMsgInput);

    const token = localStorage.getItem("pvchat_token");

    if (!token) {
        renderProfileLoggedOut();
        return;
    }

    state.currentUser = await apiGetMe();
    if (!state.currentUser) {
        localStorage.removeItem("pvchat_token");
        renderProfileLoggedOut();
        return;
    }

    // Normalisation de l'ID utilisateur
    state.currentUser.id = state.currentUser.id || state.currentUser.userId;
    state.currentUser.userId = state.currentUser.id;

    // --- INITIALISATION CRYPTOGRAPHIQUE E2EE ---
    cleanupLegacyKeys();

    const myUserId = state.currentUser.id;
    let localPrivKey = await getLocalPrivateKey(myUserId);
    let localPubKey = getLocalPublicKey(myUserId);

    let remotePubKey = null;
    try {
        remotePubKey = await apiGetUserPublicKey(myUserId);
    } catch {
        remotePubKey = null;
    }

    if (localPrivKey) {
        state.myPrivateKey = localPrivKey;

        // Si la cle publique distante est absente sur le serveur mais presente localement, on la publie
        if (!remotePubKey && localPubKey) {
            try {
                await apiSavePublicKey(localPubKey);
                remotePubKey = localPubKey;
            } catch (err) {
                console.warn("Impossible de synchroniser la cle publique locale :", err);
            }
        }

        const isCoherent = remotePubKey ? await verifyKeyPair(state.myPrivateKey, remotePubKey) : false;

        if (isCoherent) {
            state.myPublicKeyBase64 = remotePubKey;
            storeLocalPublicKey(remotePubKey, myUserId);
        } else if (!remotePubKey) {
            // Aucune cle sur le serveur : nouvelle initialisation propre
            const keyPair = await generateKeyPair();
            await storeLocalKeyPair(keyPair, myUserId);
            state.myPrivateKey = keyPair.privateKey;
            state.myPublicKeyBase64 = await exportPublicKey(keyPair.publicKey);
            await apiSavePublicKey(state.myPublicKeyBase64);
        } else {
            // Cle locale non coherente avec la cle distante : réalignement sécurisé
            console.warn("Cle locale incoherente avec la cle serveur, synchronisation...");
            const keyPair = await generateKeyPair();
            await storeLocalKeyPair(keyPair, myUserId);
            state.myPrivateKey = keyPair.privateKey;
            state.myPublicKeyBase64 = await exportPublicKey(keyPair.publicKey);
            await apiSavePublicKey(state.myPublicKeyBase64);
        }
    } else {
        // Pas de cle locale : premiere utilisation sur ce navigateur
        const keyPair = await generateKeyPair();
        await storeLocalKeyPair(keyPair, myUserId);
        state.myPrivateKey = keyPair.privateKey;
        state.myPublicKeyBase64 = await exportPublicKey(keyPair.publicKey);
        await apiSavePublicKey(state.myPublicKeyBase64);
    }

    renderProfileLoggedIn(state.currentUser);

    // Callbacks partagés pour le rendu de liste
    state.openConversationCallback = openConversation;
    state.openSettingsCallback = openConversationSettings;

    state.conversations = await apiGetConversations();
    syncUnlockedState();
    renderConversationList(state.conversations, state.currentConversationId, openConversation, openConversationSettings);
    updateConversationPreviews();

    // Initialisation WebSocket temps reel
    initWebSocket(state.currentUser, state.conversations, onNewMessage, onWsEvent);

    // Initialisation des modules UI et modales
    initMessageComposer();
    initUnlockEvents();
    initNewChatModal(openConversation);
    initInfoModal();
    initCryptoModal();
    initSettingsModal();

    // Filtre de recherche dans la sidebar
    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            const query = searchInput.value.toLowerCase().trim();
            document.querySelectorAll(".conversation").forEach(el => {
                const name = (el.dataset.name || "").toLowerCase();
                el.style.display = name.includes(query) ? "flex" : "none";
            });
        });
    }

    // Sur mobile, retour à la liste des discussions via le bouton flèche
    const mobileBackButton = document.getElementById("mobileBackButton");
    if (mobileBackButton) {
        mobileBackButton.addEventListener("click", () => {
            closeMobileChat();
        });
    }
});

// Ouvre une conversation sélectionnée
export async function openConversation(convId) {
    const nextId = parseInt(convId);
    if (isNaN(nextId)) return;

    openMobileChat();

    // Regle de securite locale : naviguer vers une autre conversation reverrouille immediatement la precedente
    if (state.currentConversationId && state.currentConversationId !== nextId) {
        state.unlockedConversationId = null;
        syncUnlockedState();
    }

    state.currentConversationId = nextId;
    const conv = state.conversations.find(c => c.id === state.currentConversationId);
    if (!conv) return;

    hideWelcomeScreen();
    updateChatHeader(conv.other_username);
    setActiveSidebarConversation(state.currentConversationId);

    // Conversation protegee par mot de passe et actuellement verrouillee
    const isLocked = Boolean(conv.has_password && state.unlockedConversationId !== conv.id);
    if (isLocked) {
        conv.unlocked = false;
        updateLockBtnVisibility(conv);
        showInlineUnlockScreen(conv);
        renderConversationList(state.conversations, state.currentConversationId, openConversation, openConversationSettings);
        return;
    }

    // Conversation accessible
    conv.unlocked = true;
    updateLockBtnVisibility(conv);
    hideInlineUnlockScreen();

    const messagesZone = document.getElementById("messages");
    if (messagesZone) messagesZone.style.display = "flex";

    const msgInput = document.getElementById("messageInput");
    const sendBtn = document.getElementById("sendButton");
    if (msgInput) {
        msgInput.disabled = false;
        msgInput.placeholder = "Écrire un message...";
    }
    if (sendBtn) sendBtn.disabled = false;
    updateToolbarDisabledState(false);

    await ensureSharedKey(conv);
    await loadAndDisplayMessages(conv);
    renderConversationList(state.conversations, state.currentConversationId, openConversation, openConversationSettings);
}

// Gestion des événements WebSocket applicatifs
function onWsEvent(data) {
    if (data.type === "conversation_password_changed") {
        const conv = state.conversations.find(c => c.id === data.conversation_id);
        if (!conv) return;

        conv.has_password = data.has_password;

        if (!data.has_password) {
            conv.unlocked = true;
            if (state.currentConversationId === conv.id) {
                state.unlockedConversationId = conv.id;
                updateLockBtnVisibility(conv);
                hideInlineUnlockScreen();
                const messagesZone = document.getElementById("messages");
                if (messagesZone) messagesZone.style.display = "flex";
                const msgInput = document.getElementById("messageInput");
                const sendBtn = document.getElementById("sendButton");
                if (msgInput) {
                    msgInput.disabled = false;
                    msgInput.placeholder = "Écrire un message...";
                }
                if (sendBtn) sendBtn.disabled = false;
                updateToolbarDisabledState(false);
                loadAndDisplayMessages(conv);
            }
        } else {
            if (state.unlockedConversationId === conv.id) {
                state.unlockedConversationId = null;
            }
            conv.unlocked = false;
            if (state.currentConversationId === conv.id) {
                updateLockBtnVisibility(conv);
                showInlineUnlockScreen(conv);
            }
        }
        renderConversationList(state.conversations, state.currentConversationId, openConversation, openConversationSettings);
    }
}
