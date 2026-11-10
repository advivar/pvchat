// Gestion des messages : dérivation de clé E2EE, envoi, réception et déchiffrement

import { state } from '../state.js';
import {
    apiGetMessages,
    apiSendMessage,
    apiGetConversations,
    apiGetUserPublicKey
} from '../api.js';
import {
    importPublicKey,
    deriveSharedKey,
    encryptMessage,
    decryptConversationMessage,
    isEncryptedPayload,
    getLocalPrivateKey
} from '../crypto.js';
import {
    renderMessages,
    appendMessageToDOM,
    scrollToBottom,
    renderConversationList
} from '../ui.js';

// Derive (ou reutilise) la sharedKey ECDH pour une conversation
export async function ensureSharedKey(conv, forceRefresh = false) {
    if (!conv) return null;
    const targetUserId = conv.other_user_id || conv.other_id;
    if (!targetUserId) return null;

    if (conv.sharedKey && !forceRefresh) {
        return conv.sharedKey;
    }

    try {
        const targetPubKeyPem = await apiGetUserPublicKey(targetUserId);
        if (!targetPubKeyPem) return null;

        // Recalculer si la cle du contact a change ou si absente
        if (!conv.sharedKey || conv._targetPubKeyPem !== targetPubKeyPem) {
            conv._targetPubKeyPem = targetPubKeyPem;
            const targetPubKey = await importPublicKey(targetPubKeyPem);
            const currentId = state.currentUser ? (state.currentUser.id || state.currentUser.userId) : null;
            const myPrivKey = state.myPrivateKey || (await getLocalPrivateKey(currentId));

            if (!myPrivKey) {
                console.warn("Cle privee locale absente pour userId", currentId);
                return null;
            }
            conv.sharedKey = await deriveSharedKey(myPrivKey, targetPubKey);
        }
        return conv.sharedKey;
    } catch {
        return null;
    }
}

// Dechiffre les apercus de la liste des conversations (uniquement si autorise)
export async function updateConversationPreviews() {
    let updated = false;
    for (const conv of state.conversations) {
        if (conv.has_password && state.unlockedConversationId !== conv.id) continue;
        if (!conv.last_message || !isEncryptedPayload(conv.last_message)) continue;

        try {
            await ensureSharedKey(conv);
            const text = await decryptConversationMessage(conv.last_message, conv.sharedKey);
            if (!isEncryptedPayload(text) && !text.startsWith("🔒 [") && !text.startsWith("⚠️")) {
                conv.last_message = text;
                updated = true;
            }
        } catch {}
    }

    if (updated) {
        renderConversationList(
            state.conversations,
            state.currentConversationId,
            state.openConversationCallback,
            state.openSettingsCallback
        );
    }
}

// Recharge les conversations du serveur tout en conservant les cles en cache
export async function refreshConversations() {
    const newConversations = await apiGetConversations();

    newConversations.forEach(newConv => {
        const existing = state.conversations.find(c => c.id === newConv.id);
        if (existing && existing.sharedKey) {
            newConv.sharedKey = existing.sharedKey;
            newConv._targetPubKeyPem = existing._targetPubKeyPem;
        }
        newConv.unlocked = Boolean(newConv.id === state.unlockedConversationId);
    });

    state.conversations = newConversations;
    renderConversationList(
        state.conversations,
        state.currentConversationId,
        state.openConversationCallback,
        state.openSettingsCallback
    );
    updateConversationPreviews();
}

// Charge et dechiffre tous les messages d'une discussion
export async function loadAndDisplayMessages(conv) {
    try {
        const messages = await apiGetMessages(conv.id);

        // S'assurer que la cle partagee E2EE est disponible
        await ensureSharedKey(conv);

        // Dechiffrement de chaque message avec la cle partagee ECDH
        for (const msg of messages) {
            msg.content = await decryptConversationMessage(msg.content, conv.sharedKey);
        }

        if (messages.length > 0) {
            const last = messages[messages.length - 1].content;
            if (!last.startsWith("🔒 [") && !last.startsWith("⚠️")) {
                conv.last_message = last;
            }
        }

        renderMessages(messages, state.currentUser);
    } catch (err) {
        console.error("Erreur chargement messages :", err);
        renderMessages([], state.currentUser);
    }
}

// Envoie un message texte chiffre de bout en bout
export async function sendMessage() {
    const input = document.getElementById("messageInput");
    if (!input) return;
    const text = input.value.trim();
    if (!text || !state.currentConversationId) return;

    input.value = "";

    try {
        const conv = state.conversations.find(c => c.id === state.currentConversationId);
        let messageToSend = text;

        if (conv) {
            await ensureSharedKey(conv);
            // Chiffrement E2EE exclusivement avec la cle partagee ECDH
            if (conv.sharedKey) {
                messageToSend = await encryptMessage(text, conv.sharedKey);
            }
        }

        const newMsg = await apiSendMessage(state.currentConversationId, messageToSend);

        // Affiche immediatement en clair cote envoyeur
        newMsg.content = text;
        appendMessageToDOM(newMsg, state.currentUser);
        scrollToBottom();

        if (conv) {
            conv.last_message = text;
            renderConversationList(
                state.conversations,
                state.currentConversationId,
                state.openConversationCallback,
                state.openSettingsCallback
            );
        }
    } catch (err) {
        console.error("Erreur envoi message :", err);
    }
}

// Reception d'un nouveau message via WebSocket
export async function onNewMessage(msg) {
    let conv = state.conversations.find(c => c.id === msg.conversation_id);

    if (!conv) {
        await refreshConversations();
        conv = state.conversations.find(c => c.id === msg.conversation_id);
    }

    if (conv) await ensureSharedKey(conv);

    // Dechiffrement E2EE avec la cle partagee ECDH
    const decryptedText = await decryptConversationMessage(
        msg.content,
        conv ? conv.sharedKey : null
    );
    msg.content = decryptedText;

    // Affichage dans la vue si la conversation est ouverte et non verrouillee
    if (state.currentConversationId && msg.conversation_id === state.currentConversationId) {
        const isLocked = Boolean(conv && conv.has_password && state.unlockedConversationId !== conv.id);
        if (!isLocked) {
            appendMessageToDOM(msg, state.currentUser);
            scrollToBottom();
        }
    }

    // Mise a jour de l'apercu dans la sidebar
    if (conv) {
        if (!decryptedText.startsWith("🔒 [") && !decryptedText.startsWith("⚠️")) {
            conv.last_message = decryptedText;
        }
        renderConversationList(
            state.conversations,
            state.currentConversationId,
            state.openConversationCallback,
            state.openSettingsCallback
        );
    }
}

// Initialise les écouteurs de la zone de saisie
export function initMessageComposer() {
    const sendButton = document.getElementById("sendButton");
    const messageInput = document.getElementById("messageInput");

    if (sendButton) {
        sendButton.addEventListener("click", sendMessage);
    }

    if (messageInput) {
        messageInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }
}
