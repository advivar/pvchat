// Fonctions de chiffrement E2EE (ECDH P-256 + AES-GCM-256)

// Encodage ArrayBuffer vers Base64 robuste (sans depassement de pile)
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const len = bytes.byteLength;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
    }
    return btoa(binary);
}

// Decodage Base64 vers Uint8Array robuste
function base64ToUint8Array(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

// Generer une paire de cles ECDH pour l'utilisateur
async function generateKeyPair() {
    return await window.crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveKey", "deriveBits"]
    );
}

// Exporter la cle publique en Base64 (format SPKI)
async function exportPublicKey(key) {
    const exported = await window.crypto.subtle.exportKey("spki", key);
    return arrayBufferToBase64(exported);
}

// Importer une cle publique Base64 (format SPKI)
async function importPublicKey(base64Key) {
    const binaryDer = base64ToUint8Array(base64Key);
    return await window.crypto.subtle.importKey(
        "spki",
        binaryDer,
        { name: "ECDH", namedCurve: "P-256" },
        true,
        []
    );
}

// Exporter la cle privee en Base64 (format PKCS#8)
async function exportPrivateKey(key) {
    const exported = await window.crypto.subtle.exportKey("pkcs8", key);
    return arrayBufferToBase64(exported);
}

// Exporter une cle symetrique en Base64 brut (pour affichage / diagnostic)
async function exportRawKey(key) {
    const exported = await window.crypto.subtle.exportKey("raw", key);
    return arrayBufferToBase64(exported);
}

// Deriver la cle partagee AES-GCM-256 par echange ECDH
async function deriveSharedKey(privateKey, publicKey) {
    return await window.crypto.subtle.deriveKey(
        { name: "ECDH", public: publicKey },
        privateKey,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}

// Verifie mathematiquement que la cle privee locale correspond a la cle publique distante
async function verifyKeyPair(privateKey, publicBase64Key) {
    if (!privateKey || !publicBase64Key) return false;
    try {
        const pubKey = await importPublicKey(publicBase64Key);
        const ephemeral = await generateKeyPair();

        // Si la paire est coherente : ECDH(privLocale, pubEphemere) == ECDH(privEphemere, pubLocale)
        const bits1 = await window.crypto.subtle.deriveBits(
            { name: "ECDH", public: ephemeral.publicKey },
            privateKey,
            256
        );
        const bits2 = await window.crypto.subtle.deriveBits(
            { name: "ECDH", public: pubKey },
            ephemeral.privateKey,
            256
        );
        const a = new Uint8Array(bits1);
        const b = new Uint8Array(bits2);
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    } catch {
        return false;
    }
}

// Detecte si une chaine est un payload chiffre valide { ciphertext, iv }
function isEncryptedPayload(data) {
    if (typeof data !== "string") return false;
    const trimmed = data.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
    try {
        const parsed = JSON.parse(trimmed);
        return Boolean(
            parsed &&
            typeof parsed === "object" &&
            typeof parsed.ciphertext === "string" &&
            typeof parsed.iv === "string" &&
            parsed.ciphertext.length > 0 &&
            parsed.iv.length > 0
        );
    } catch {
        return false;
    }
}

// Chiffrer un texte avec une cle AES-GCM (retourne JSON { ciphertext, iv })
async function encryptMessage(text, key) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const ciphertextBuffer = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        data
    );

    return JSON.stringify({
        ciphertext: arrayBufferToBase64(ciphertextBuffer),
        iv: arrayBufferToBase64(iv)
    });
}

// Dechiffrer un payload JSON { ciphertext, iv } avec une cle AES-GCM
// Leve une exception si le dechiffrement echoue
async function decryptMessage(encryptedJsonString, key) {
    if (!encryptedJsonString) return "";
    if (!isEncryptedPayload(encryptedJsonString)) return encryptedJsonString;

    const { ciphertext, iv } = JSON.parse(encryptedJsonString);
    const ivArray = base64ToUint8Array(iv);
    const ciphertextArray = base64ToUint8Array(ciphertext);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: ivArray },
        key,
        ciphertextArray
    );

    return new TextDecoder().decode(decryptedBuffer);
}

// Dechiffre un message de conversation en E2EE pur.
// Tous les messages transites sont chiffres exclusivement avec sharedKey (ECDH).
// Le mot de passe de discussion est un verrouillage d'acces local dans l'interface.
async function decryptConversationMessage(rawContent, sharedKey) {
    // Message en clair (aucun payload chiffre detecte)
    if (!rawContent || !isEncryptedPayload(rawContent)) {
        return rawContent;
    }

    // Pas encore de cle partagee derivee (contact sans cle publique enregistree)
    if (!sharedKey) {
        return "⚠️ [En attente de la clé de chiffrement]";
    }

    try {
        const decrypted = await decryptMessage(rawContent, sharedKey);
        // Si le message est encore un payload chiffre (reliquat d'ancien sur-chiffrement)
        if (isEncryptedPayload(decrypted)) {
            return "⚠️ [Message archivé protégé]";
        }
        return decrypted;
    } catch (err) {
        console.warn("Echec du dechiffrement E2EE :", err);
        return "⚠️ [Message chiffré - Impossible de déchiffrer]";
    }
}

// Sauvegarder la cle privee ECDH dans localStorage (scopee par userId)
async function storePrivateKey(privateKey, userId) {
    const exported = await exportPrivateKey(privateKey);
    const keyName = userId ? `pvchat_private_key_${userId}` : "pvchat_private_key";
    localStorage.setItem(keyName, exported);
}

// Charger la cle privee ECDH depuis localStorage
async function getLocalPrivateKey(userId) {
    let stored = userId ? localStorage.getItem(`pvchat_private_key_${userId}`) : null;
    if (!stored) {
        // Fallbacks pour recuperer d'anciennes cles locales
        stored = localStorage.getItem("pvchat_private_key_undefined") || localStorage.getItem("pvchat_private_key");
        if (stored && userId) {
            localStorage.setItem(`pvchat_private_key_${userId}`, stored);
        }
    }
    if (!stored) return null;

    try {
        const binaryDer = base64ToUint8Array(stored);
        return await window.crypto.subtle.importKey(
            "pkcs8",
            binaryDer,
            { name: "ECDH", namedCurve: "P-256" },
            true,
            ["deriveKey", "deriveBits"]
        );
    } catch (e) {
        console.error("Erreur importation cle privee locale :", e);
        return null;
    }
}
