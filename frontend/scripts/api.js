// Toutes les fonctions qui parlent avec l'API backend

const API_BASE = "/api";

function authHeaders() {
    const token = localStorage.getItem("pvchat_token");
    return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
    };
}

async function apiGetMe() {
    const res = await fetch(`${API_BASE}/me`, { headers: authHeaders() });
    if (!res.ok) return null;
    const data = await res.json();
    return data.user;
}

async function apiGetConversations() {
    const res = await fetch(`${API_BASE}/conversations`, { headers: authHeaders() });
    if (res.status === 401) {
        localStorage.removeItem("pvchat_token");
        window.location.reload();
        return [];
    }
    return await res.json();
}

async function apiCreateConversation(targetUserId) {
    const res = await fetch(`${API_BASE}/conversations`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ targetUserId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur serveur");
    return data.conversation;
}

async function apiGetMessages(convId) {
    const res = await fetch(`${API_BASE}/conversations/${convId}/messages`, { headers: authHeaders() });
    if (!res.ok) return [];
    return await res.json();
}

async function apiSendMessage(convId, content) {
    const res = await fetch(`${API_BASE}/conversations/${convId}/messages`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ content })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur serveur");
    return data;
}

async function apiSearchUsers(query) {
    const token = localStorage.getItem("pvchat_token");
    const res = await fetch(`${API_BASE}/users/search?q=${encodeURIComponent(query)}`, {
        headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("Erreur serveur");
    return await res.json();
}

// Enregistrer la cle publique E2EE sur le serveur
async function apiSavePublicKey(publicKey) {
    const res = await fetch(`${API_BASE}/users/me/public-key`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ public_key: publicKey })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur sauvegarde cle publique");
    return data;
}

// Recuperer la cle publique E2EE d'un autre utilisateur
async function apiGetUserPublicKey(userId) {
    const res = await fetch(`${API_BASE}/users/${userId}/public-key`, {
        headers: authHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur recuperation cle publique");
    return data.public_key;
}

// Supprimer (masquer) une conversation de son compte
async function apiDeleteConversation(convId) {
    const res = await fetch(`${API_BASE}/conversations/${convId}`, {
        method: "DELETE",
        headers: authHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur suppression conversation");
    return data;
}

// Definir ou supprimer le mot de passe d'une conversation
async function apiSetConversationPassword(convId, password) {
    const res = await fetch(`${API_BASE}/conversations/${convId}/password`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur configuration mot de passe");
    return data;
}

// Deverrouiller une conversation protegee par mot de passe
async function apiUnlockConversation(convId, password) {
    const res = await fetch(`${API_BASE}/conversations/${convId}/unlock`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Mot de passe incorrect");
    return data;
}
