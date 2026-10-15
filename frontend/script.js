document.addEventListener("DOMContentLoaded", function () {
    const conversationList = document.getElementById("conversationList");
    const messagesElement = document.getElementById("messages");
    const chatTitle = document.getElementById("chatTitle");
    const headerAvatar = document.getElementById("headerAvatar");
    const chatStatus = document.getElementById("chatStatus");
    const messageInput = document.getElementById("messageInput");
    const sendButton = document.getElementById("sendButton");
    const searchInput = document.getElementById("searchInput");
    const fileInput = document.getElementById("fileInput");
    const attachmentPreview = document.getElementById("attachmentPreview");

    const conversations = {};
    let currentConversationId = "equipe";
    let selectedFile = null;
    let nextId = 1;

    // Préparer l'historique indépendant de chaque conversation.
    document.querySelectorAll(".conversation").forEach(function (button) {
        const id = button.dataset.id;
        const name = button.dataset.name;
        const avatar = button.querySelector(".avatar");

        conversations[id] = {
            name: name,
            initials: avatar.textContent,
            avatarClass: avatar.className,
            messages: []
        };
    });

    // Messages de démonstration du groupe.
    conversations.equipe.messages.push(
        {
            author: "Équipe projet",
            text: "Bienvenue sur PVCHAT ! 👋",
            time: "14:30",
            sent: false
        },
        {
            author: "Moi",
            text: "Salut tout le monde ! On peut utiliser cette discussion pour organiser le projet.",
            time: "14:32",
            sent: true
        }
    );

    function getTime() {
        return new Date().toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    function renderMessages() {
        messagesElement.replaceChildren();

        const separator = document.createElement("div");
        separator.className = "date-separator";

        const dateLabel = document.createElement("span");
        dateLabel.textContent = "Aujourd'hui";

        separator.appendChild(dateLabel);
        messagesElement.appendChild(separator);

        const conversation = conversations[currentConversationId];

        if (conversation.messages.length === 0) {
            const empty = document.createElement("p");
            empty.className = "empty-chat";
            empty.textContent = "Début de la conversation avec " + conversation.name;
            messagesElement.appendChild(empty);
            return;
        }

        conversation.messages.forEach(function (item) {
            const message = document.createElement("div");
            message.className = "message " + (item.sent ? "sent" : "received");

            if (!item.sent) {
                const avatar = document.createElement("div");
                avatar.className = conversation.avatarClass;
                avatar.classList.add("message-avatar");
                avatar.textContent = conversation.initials;
                message.appendChild(avatar);
            }

            const content = document.createElement("div");
            content.className = "message-content";

            if (!item.sent) {
                const author = document.createElement("div");
                author.className = "message-author";
                author.textContent = item.author;
                content.appendChild(author);
            }

            const bubble = document.createElement("div");
            bubble.className = "message-bubble";
            bubble.textContent = item.text;

            if (item.fileName) {
                const fileLine = document.createElement("p");
                fileLine.textContent = "📎 " + item.fileName;
                bubble.appendChild(document.createElement("br"));
                bubble.appendChild(fileLine);
            }

            const time = document.createElement("span");
            time.className = "message-time";
            time.textContent = item.time;

            content.appendChild(bubble);
            content.appendChild(time);
            message.appendChild(content);
            messagesElement.appendChild(message);
        });

        messagesElement.scrollTop = messagesElement.scrollHeight;
    }

    function openConversation(button) {
        const id = button.dataset.id;
        if (!id || !conversations[id]) return;

        currentConversationId = id;

        document.querySelectorAll(".conversation").forEach(function (item) {
            item.classList.toggle("active", item === button);
        });

        const conversation = conversations[id];

        chatTitle.textContent = conversation.name;
        headerAvatar.textContent = conversation.initials;
        headerAvatar.className = conversation.avatarClass;
        chatStatus.textContent = "Conversation de démonstration";

        renderMessages();
    }

    // Utiliser la délégation d'événement pour tous les boutons,
    // y compris ceux ajoutés après le chargement.
    conversationList.addEventListener("click", function (event) {
        const button = event.target.closest("button.conversation");

        if (button && conversationList.contains(button)) {
            openConversation(button);
        }
    });

    function sendMessage() {
        const text = messageInput.value.trim();

        if (!text && !selectedFile) return;

        conversations[currentConversationId].messages.push({
            author: "Moi",
            text: text,
            time: getTime(),
            sent: true,
            fileName: selectedFile ? selectedFile.name : ""
        });

        messageInput.value = "";
        selectedFile = null;
        fileInput.value = "";
        attachmentPreview.textContent = "";

        renderMessages();
        messageInput.focus();
    }

    sendButton.addEventListener("click", sendMessage);

    messageInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });

    // Recherche de conversations.
    searchInput.addEventListener("input", function () {
        const query = searchInput.value.trim().toLowerCase();

        document.querySelectorAll(".conversation").forEach(function (button) {
            const name = button.dataset.name.toLowerCase();
            button.hidden = !name.includes(query);
        });
    });

    // Sélection d'un fichier pour la démonstration.
    fileInput.addEventListener("change", function () {
        selectedFile = fileInput.files[0] || null;

        attachmentPreview.textContent = selectedFile
            ? "📎 " + selectedFile.name + " — prêt à être envoyé"
            : "";
    });

    // Création d'une nouvelle conversation.
    document.getElementById("newConversation").addEventListener("click", function () {
        const name = prompt("Nom de la nouvelle conversation :");

        if (!name || !name.trim()) return;

        const cleanName = name.trim();

        const alreadyExists = Object.values(conversations).some(function (item) {
            return item.name.toLowerCase() === cleanName.toLowerCase();
        });

        if (alreadyExists) {
            alert("Cette conversation existe déjà.");
            return;
        }

        const id = "conversation-" + nextId++;
        const initials = cleanName
            .split(/\s+/)
            .slice(0, 2)
            .map(function (word) {
                return word.charAt(0).toUpperCase();
            })
            .join("");

        const avatarColors = ["purple", "blue", "green", "orange"];
        const color = avatarColors[Object.keys(conversations).length % avatarColors.length];

        conversations[id] = {
            name: cleanName,
            initials: initials,
            avatarClass: "avatar " + color,
            messages: []
        };

        const button = document.createElement("button");
        button.className = "conversation";
        button.dataset.name = cleanName;
        button.dataset.id = id;

        const avatar = document.createElement("span");
        avatar.className = "avatar " + color;
        avatar.textContent = initials;

        const info = document.createElement("span");
        info.className = "conversation-info";

        const title = document.createElement("strong");
        title.textContent = cleanName;

        const preview = document.createElement("small");
        preview.textContent = "Nouvelle conversation";

        info.appendChild(title);
        info.appendChild(preview);
        button.appendChild(avatar);
        button.appendChild(info);

        conversationList.appendChild(button);
        searchInput.value = "";

        document.querySelectorAll(".conversation").forEach(function (item) {
            item.hidden = false;
        });

        openConversation(button);
    });

    document.getElementById("settingsButton").addEventListener("click", function () {
        alert("Les paramètres du compte seront ajoutés plus tard.");
    });

    document.getElementById("infoButton").addEventListener("click", function () {
        alert(
            "PVCHAT — version de démonstration.\n" +
            "Les messages ne sont pas encore partagés via un serveur."
        );
    });

    // Afficher la conversation initiale.
    const initialConversation = conversationList.querySelector(
        '.conversation[data-id="equipe"]'
    );

    if (initialConversation) {
        openConversation(initialConversation);
    }

    console.log("PVCHAT est chargé !");
});
