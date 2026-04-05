// --- DOM Elements ---
const loginModal = document.getElementById('login-modal');
const usernameInput = document.getElementById('username-input');
const loginButton = document.getElementById('login-button');
const loginError = document.getElementById('login-error');
const usernameSidebar = document.getElementById('username-sidebar');
const userAvatarSidebar = document.getElementById('user-avatar-sidebar');
const roomListElement = document.getElementById('room-list');
const userListElement = document.getElementById('user-list');
const messagesContainer = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const typingIndicator = document.getElementById('typing-indicator');
const currentRoomNameElement = document.getElementById('current-room-name');
const themeToggleBtn = document.getElementById('toggle-theme-btn');

// --- Global State ---
let currentUser = null;
let currentRoomId = 'simplechat_official';
let theme = localStorage.getItem('theme') || 'light'; // 'light' or 'dark'

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    toggleTheme(theme);
    themeToggleBtn.textContent = theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';

    themeToggleBtn.addEventListener('click', () => {
        theme = theme === 'dark' ? 'light' : 'dark';
        toggleTheme(theme);
        localStorage.setItem('theme', theme);
        themeToggleBtn.textContent = theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
    });
});

function toggleTheme(themeName) {
    if (themeName === 'dark') {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
}

// --- Modal Handling ---
function showLoginModal() {
    loginModal.style.display = 'flex';
}

function hideLoginModal() {
    loginModal.style.display = 'none';
}

function displayLoginError(message) {
    loginError.textContent = message;
}

// --- User and Avatar Display ---
function formatAvatar(avatarData) {
    if (!avatarData) return '<div class="user-avatar-sidebar avatar">?</div>';
    if (avatarData.initials) {
        return `
            <div class="avatar" style="background-color: ${avatarData.color};">
                ${avatarData.initials}
            </div>
        `;
    }
    // Fallback for other avatar formats if you add them
    return `<div class="avatar">?</div>`;
}

function renderSidebarUser(user) {
    if (!user) return;
    usernameSidebar.textContent = user.username;
    // Assuming avatarData is { initials: '...', color: '...' }
    userAvatarSidebar.innerHTML = formatAvatar(user.avatar);
}

// --- Room and User List Rendering ---
function renderRoomList(rooms, currentRoomId) {
    roomListElement.innerHTML = '';
    // Sort rooms: Official room first, then alphabetical
    const sortedRooms = Object.values(rooms).sort((a, b) => {
        if (a.isOfficial) return -1;
        if (b.isOfficial) return 1;
        return a.name.localeCompare(b.name);
    });

    sortedRooms.forEach(room => {
        const li = document.createElement('li');
        li.classList.add('room-item');
        if (room.id === currentRoomId) {
            li.classList.add('active');
        }
        if (room.isOfficial) {
            li.classList.add('official');
        }
        li.textContent = `${room.name} ${room.isOfficial ? '✔️' : ''} (${room.activeUsers})`;
        li.dataset.roomId = room.id;
        li.addEventListener('click', () => handleRoomClick(room.id));
        roomListElement.appendChild(li);
    });

    if (sortedRooms.length === 0) {
        roomListElement.innerHTML = '<li class="no-rooms">No rooms available.</li>';
    }
}

function renderUserList(usersInRoom, currentUserId) {
    userListElement.innerHTML = '';
    usersInRoom.forEach(user => {
        const li = document.createElement('li');
        li.classList.add('user-item');
        if (user.id === currentUserId) {
            li.classList.add('current-user');
        }
        const avatarDiv = document.createElement('div');
        avatarDiv.classList.add('user-item-avatar');
        avatarDiv.style.backgroundColor = user.avatar?.color || '#ccc';
        avatarDiv.textContent = user.avatar?.initials || '?';
        if (user.isOnline) { // Assuming the backend might send an 'isOnline' flag
             avatarDiv.classList.add('online');
        }
        li.appendChild(avatarDiv);
        li.appendChild(document.createTextNode(user.username));
        userListElement.appendChild(li);
    });

     if (usersInRoom.length === 0) {
        userListElement.innerHTML = '<li class="no-users">No users in this room.</li>';
    }
}

// --- Message Rendering ---
function renderMessage(message, isOwnMessage) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    if (isOwnMessage) {
        messageElement.classList.add('own');
    }

    const senderInfo = document.createElement('div');
    senderInfo.classList.add('message-header');

    if (message.system) {
        messageElement.classList.add('message-system');
        messageElement.textContent = message.text;
        // System messages are usually centered via CSS
    } else {
        const avatarDiv = document.createElement('div');
        avatarDiv.classList.add('message-avatar');
        avatarDiv.style.backgroundColor = message.avatar?.color || '#ccc';
        avatarDiv.textContent = message.avatar?.initials || '?';
        senderInfo.appendChild(avatarDiv);

        const usernameSpan = document.createElement('span');
        usernameSpan.classList.add('message-username');
        usernameSpan.textContent = message.username;
        senderInfo.appendChild(usernameSpan);

        const timestampSpan = document.createElement('span');
        timestampSpan.classList.add('message-timestamp');
        timestampSpan.textContent = formatTimestamp(message.timestamp);
        senderInfo.appendChild(timestampSpan);

        const contentDiv = document.createElement('div');
        contentDiv.classList.add('message-content');
        contentDiv.textContent = message.text; // Basic text, could add emoji handling
        messageElement.appendChild(senderInfo);
        messageElement.appendChild(contentDiv);
    }
    messagesContainer.appendChild(messageElement);
    scrollToBottom();
}

function formatTimestamp(isoString) {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// --- Typing Indicator Rendering ---
let typingTimeout = null;
function updateTypingIndicator(typingUsernames, currentRoom) {
    if (currentRoom !== currentRoomId) return; // Only show for the current room

    const activeTypers = typingUsernames.filter(id => {
        // Find the username from the current user list (if available)
        const user = getCurrentRoomUsers().find(u => u.id === id);
        return user;
    }).map(id => {
        const user = getCurrentRoomUsers().find(u => u.id === id);
        return user.username;
    });

    if (activeTypers.length > 0) {
        typingIndicator.textContent = `${activeTypers.join(', ')} is typing...`;
        typingIndicator.style.opacity = '1';
    } else {
        typingIndicator.textContent = '';
        typingIndicator.style.opacity = '0';
    }
}

// Helper to get current room users from the UI list
function getCurrentRoomUsers() {
    const users = [];
    userListElement.querySelectorAll('.user-item').forEach(item => {
        const username = item.textContent;
        const userId = item.dataset.userId; // You'd need to add this attribute
        const avatarDiv = item.querySelector('.user-item-avatar');
        const initials = avatarDiv.textContent;
        const color = avatarDiv.style.backgroundColor;
        users.push({ id: userId, username, avatar: { initials, color } });
    });
    return users;
}


// --- Input Handling ---
function setSendButtonState(isEnabled) {
    sendButton.disabled = !isEnabled;
}

function clearMessageInput() {
    messageInput.value = '';
}

// --- Room Interaction ---
function handleRoomClick(roomId) {
    if (roomId === currentRoomId) return; // Already in this room

    // Optionally clear messages and user list upon room change
    // messagesContainer.innerHTML = '';
    // userListElement.innerHTML = '';
    // Update sidebar active room
    document.querySelectorAll('#room-list .room-item').forEach(item => {
        item.classList.remove('active');
    });
    const clickedRoomElement = document.querySelector(`#room-list .room-item[data-room-id="${roomId}"]`);
    if (clickedRoomElement) {
        clickedRoomElement.classList.add('active');
    }

    currentRoomId = roomId;
    // Emit joinRoom event to server (handled in main.js)
    // Server will respond with new room occupants and update room names etc.
}


// --- Export functions to be used by main.js ---
export {
    showLoginModal,
    hideLoginModal,
    displayLoginError,
    renderSidebarUser,
    renderRoomList,
    renderUserList,
    renderMessage,
    scrollToBottom,
    updateTypingIndicator,
    setSendButtonState,
    clearMessageInput,
    handleRoomClick,
    formatAvatar,
    toggleTheme,
    themeToggleBtn
};