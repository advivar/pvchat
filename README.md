# PVCHAT 🔒

Messagerie instantanée sécurisée avec chiffrement de bout en bout (**E2EE**) et protection par mot de passe des discussions.

---

## 🏗️ Architecture du Projet

### 1. Frontend (`/frontend`)
Le frontend est développé en **JavaScript Vanilla modulaire (ES Modules natifs)** et **CSS découplé**, sans dépendance lourde ni outil de build :

```text
frontend/
├── index.html                    # Application principale
├── login.html                    # Page de connexion
├── register.html                 # Page d'inscription
├── style.css                     # Point d'entrée CSS (assemble les modules)
├── css/
│   ├── variables.css             # Variables CSS et palette de thèmes
│   ├── base.css                  # Reset et conteneurs fondamentaux
│   ├── sidebar.css               # Barre latérale, liste des chats et avatars
│   ├── chat.css                  # Zone de messages, bulles et compositeur
│   ├── unlock.css                # Écran inline de déverrouillage de discussion
│   ├── modals.css                # Modales génériques et paramètres
│   ├── crypto-modal.css          # Inspection des clés et diagnostic E2EE
│   └── auth.css                  # Pages d'authentification (login / register)
└── scripts/
    ├── app.js                    # Orchestrateur principal de l'application
    ├── state.js                  # Store d'état global partagé
    ├── api.js                    # Client HTTP d'accès aux routes API
    ├── crypto.js                 # Fonctions cryptographiques WebCrypto (ECDH + AES-GCM)
    ├── websocket.js              # Gestionnaire de flux WebSocket temps réel
    ├── ui.js                     # Utilitaires de rendu DOM
    ├── auth-forms.js             # Gestionnaires des formulaires de connexion / inscription
    ├── chat/
    │   ├── messages.js           # Envoi, déchiffrement et rafraîchissement des messages
    │   └── unlock.js             # Déverrouillage et verrouillage instantané
    └── modals/
        ├── modal-new-chat.js     # Recherche d'utilisateurs et création de discussion
        ├── modal-settings.js     # Gestion du mot de passe de salon et suppression
        ├── modal-crypto.js       # Diagnostic cryptographique et affichage des clés
        └── modal-info.js         # Informations serveur et statut de connexion
```

### 2. Backend (`/backend`)
API RESTful et serveur WebSocket temps réel sous **Node.js / Express** :

```text
backend/
├── index.js                      # Point d'entrée, CORS et montage des routes
├── config.js                     # Variables d'environnement et regex
├── db/
│   ├── pool.js                   # Pool de connexions PostgreSQL
│   ├── init.sql                  # Schéma d'initialisation des tables
│   └── repositories/             # Couche d'accès aux données (SQL isolé)
│       ├── userRepository.js
│       ├── conversationRepository.js
│       └── messageRepository.js
├── middleware/
│   ├── auth.js                   # Vérification JWT
│   ├── rateLimiter.js            # Rate limiter en mémoire (anti-bruteforce)
│   └── conversation.js           # Vérification de l'appartenance à une discussion
├── routes/
│   ├── auth.js                   # /register, /login, /me, /verify-password
│   ├── users.js                  # /users/search, /users/:id/public-key
│   └── conversations.js          # /conversations, /conversations/:id/messages
└── ws/
    └── socket.js                 # Serveur WebSocket avec authentification JWT
```

### 3. Infrastructure (`/infra`)
- `docker-compose.yml` : Orchestration de PostgreSQL 18, de l'API Node.js et du reverse-proxy Nginx.
- `nginx/default.conf` : Routage statique, proxy `/api/` et flux `/ws`, avec en-têtes de sécurité HTTP (CSP, X-Frame-Options, HSTS).

---

## 🚀 Démarrage Rapide

```bash
cd infra
docker compose up -d --build
```

L'application est immédiatement accessible à l'adresse suivante :
👉 **http://localhost:8080**
