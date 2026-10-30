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

// Enregistrer ma clé publique sur le serveur
async function apiSavePublicKey(publicKey) {
    const res = await fetch(`${API_BASE}/users/me/public-key`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ public_key: publicKey })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur sauvegarde clé publique");
    return data;
}

// Récupérer la clé publique d'un autre utilisateur
async function apiGetUserPublicKey(userId) {
    const res = await fetch(`${API_BASE}/users/${userId}/public-key`, {
        headers: authHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur récupération clé publique");
    return data.public_key;
}