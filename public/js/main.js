import {
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
    toggleTheme
} from './ui.js';

// --- Socket.IO Connection ---
const socket = io(); // Connects to the host that served the page

let currentUser = null;
let currentRoomUsers = []; // Store user objects for the current room
let availableRooms = {}; // Store all available rooms

// --- Element References (already imported from ui.js where defined) ---
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const loginButton = document.getElementById('login-button'); // Already defined in UI, but needed here for event listener

// --- Event Listeners ---

// Login Modal
loginButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username) {
        socket.emit('join', username, (error, userData) => {
            if (error) {
                displayLoginError(error);
            } else {
                currentUser = userData;
                hideLoginModal();
                renderSidebarUser(currentUser);
                setSendButtonState(true); // Enable sending once logged in
                // Initial state after login handled by server events
            }
        });
    } else {
        displayLoginError('Please enter a username.');
    }
});

// Message Input
messageInput.addEventListener('input', () => {
    if (!currentUser) return;
    const messageText = messageInput.value.trim();
    if (messageText.length > 0) {
        socket.emit('typing');
        setSendButtonState(true);
    } else {
        socket.emit('stopTyping');
        setSendButtonState(false);
    }
});

// Force stop typing after a delay
let typingTimer;
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        if (messageInput.value.trim().length > 0) {
            e.preventDefault(); // Prevent default form submission
            sendMessage();
        }
    }

    // Resetting typing timer
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        socket.emit('stopTyping');
    }, 1500); // Stop typing after 1.5 seconds of inactivity
});

// Send Button
sendButton.addEventListener('click', () => {
    sendMessage();
});

// --- Socket.IO Event Handlers ---

// On connection, check if user needs to login
socket.on('connect', () => {
    console.log('Connected to server');
    if (!currentUser) {
        showLoginModal();
        setSendButtonState(false); // Disable sending until logged in
    } else {
        // If already logged in, attempt to re-join current room/state
        // This might need more sophisticated handling for persistence
        socket.emit('join', currentUser.username, (error, userData) => {
             if (error) {
                console.error("Re-join failed:", error);
                // Potentially force logout or show error to user
                currentUser = null;
                showLoginModal();
                setSendButtonState(false);
            } else {
                currentUser = userData; // Update user data if needed
                renderSidebarUser(currentUser);
                // Re-join the room they were in
                const roomToJoin = currentRoomUsers.length > 0 ? currentRoomUsers[0].room : 'simplechat_official'; // Fallback
                handleRoomClick(roomToJoin); // This will trigger joinRoom socket event
            }
        });
    }
});

// Handle user info received after joining
socket.on('userInfo', (userData) => {
    currentUser = userData;
    renderSidebarUser(currentUser);
    // Initial render of rooms based on server data
    // Server will send roomList after this if not already sent
});

// Handle room list update
socket.on('roomList', (roomsData) => {
    availableRooms = {}; // Clear existing
    roomsData.forEach(room => {
        availableRooms[room.id] = room;
    });
    // Use the currently active room ID to render the room list for easy selection
    const activeRoomId = currentUser?.room || 'simplechat_official';
    renderRoomList(availableRooms, activeRoomId);
});


// Handle new messages
socket.on('message', (message) => {
    const isOwnMessage = currentUser && message.userId === currentUser.id;
    renderMessage(message, isOwnMessage);
    // Optional: play sound notification
    // Optional: scroll logic handled by renderMessage calling scrollToBottom
});

// Handle user joining a room
socket.on('userJoinedRoom', (userData) => {
    if (!userData || !userData.id) return;

    // Add user to current room's user list if not already present
    const userExists = currentRoomUsers.some(u => u.id === userData.id);
    if (!userExists) {
        currentRoomUsers.push({ ...userData, isOnline: true }); // Assuming they are online
        renderUserList(currentRoomUsers, currentUser?.id);
    }
    // Update room user count in the room list
    if (availableRooms[userData.room]) {
        availableRooms[userData.room].activeUsers++;
        renderRoomList(availableRooms, currentUser?.room || 'simplechat_official');
    }

    // Notify about join if it's not the current user themselves
    if (currentUser && userData.id !== currentUser.id) {
         const joinMessage = {
            id: Date.now(), // Temporary ID
            text: `${userData.username} has joined the room.`,
            system: true,
            timestamp: new Date().toISOString()
        };
        renderMessage(joinMessage, false);
    }
});

// Handle user leaving a room
socket.on('userLeftRoom', (userData) => {
    if (!userData || !userData.id) return;

    const roomName = currentUser?.room || 'simplechat_official'; // Get room from current user's perspective
    if (availableRooms[roomName]) {
        availableRooms[roomName].activeUsers--;
        renderRoomList(availableRooms, currentUser?.room || 'simplechat_official');
    }

    // Remove user from current room's user list
    currentRoomUsers = currentRoomUsers.filter(u => u.id !== userData.id);
    renderUserList(currentRoomUsers, currentUser?.id);

    // Notify about leave if it's not the current user themselves
    if (currentUser && userData.id !== currentUser.id) {
        const leaveMessage = {
            id: Date.now(), // Temporary ID
            text: `${userData.username} has left the room.`,
            system: true,
            timestamp: new Date().toISOString()
        };
        renderMessage(leaveMessage, false);
    }
});

// Handle typing updates
socket.on('typingUpdate', ({ typingUsers, room }) => {
    if (room === (currentUser?.room || 'simplechat_official')) { // Only update if it's the current room
        // Filter out the current user from the typing list
        const activeTypers = typingUsers.filter(userId => userId !== currentUser?.id);
        updateTypingIndicator(activeTypers, room);
    }
});

// Handle disconnection
socket.on('disconnect', () => {
    console.log('Disconnected from server');
    currentUser = null; // Reset user state
    setSendButtonState(false);
    // Show login modal again or a message
    showLoginModal();
    displayLoginError('You have been disconnected. Please log in again.');
    // Clear UI
    renderSidebarUser(null);
    renderRoomList({}, null);
    renderUserList([], null);
    messagesContainer.innerHTML = '';
    typingIndicator.textContent = '';
});

// --- Room Joining Logic (Triggered by UI) ---
function handleRoomClick(roomId) {
    // Update UI immediately for responsiveness
    document.querySelectorAll('#room-list .room-item').forEach(item => {
        item.classList.remove('active');
    });
    const clickedRoomElement = document.querySelector(`#room-list .room-item[data-room-id="${roomId}"]`);
    if (clickedRoomElement) {
        clickedRoomElement.classList.add('active');
    }

    const roomInfo = availableRooms[roomId];
    if (roomInfo) {
        document.getElementById('current-room-name').textContent = `${roomInfo.name} ${roomInfo.isOfficial ? '✔️' : ''}`;

        // Emit join room event to server
        socket.emit('joinRoom', roomId, (error, roomData) => {
            if (error) {
                console.error('Error joining room:', error);
                // Maybe revert UI or show error message
                return;
            }
            // Server response `roomData` might contain initial messages, user list etc.
            // For simplicity, we'll rely on the server sending 'userJoinedRoom' and 'userLeftRoom' events
            // to update the currentRoomUsers list.
            // Clear the previous user list and messages container here, or wait for server events.
            messagesContainer.innerHTML = '';
            userListElement.innerHTML = '';
            currentRoomUsers = []; // Reset

            // Update currentUser's room property if available
            if (currentUser) {
                currentUser.room = roomId;
            }

            // Render the user list for the new room based on server response
             if (roomData && roomData.roomOccupants) {
                 currentRoomUsers = roomData.roomOccupants.map(u => ({ ...u, isOnline: true }));
                 renderUserList(currentRoomUsers, currentUser?.id);
             } else {
                 // If server doesn't send roomOccupants, we rely on join/leave events
                 renderUserList([], currentUser?.id); // Show empty list until join events fire
             }

            // Update available rooms user count.
            if (availableRooms[roomId]) availableRooms[roomId].activeUsers = roomData.roomOccupants.length;
            renderRoomList(availableRooms, roomId);

            // Clear typing indicator for the new room
            typingIndicator.textContent = '';
            typingIndicator.style.opacity = '0';
        });
    }
}


// --- Message Sending Logic ---
function sendMessage() {
    if (!currentUser) return;
    const messageText = messageInput.value.trim();
    if (messageText.length > 0) {
        socket.emit('sendMessage', { text: messageText }, (error) => {
            if (error) {
                console.error('Error sending message:', error);
                // Display error to user
            } else {
                clearMessageInput();
                setSendButtonState(false); // Disable until user types again
                socket.emit('stopTyping'); // Explicitly stop typing on send
            }
        });
    }
}

// --- Admin Functionality (Basic Example) ---
// This assumes you navigate to /admin in your browser.
// The admin panel HTML (not provided here) would also connect to Socket.IO.
let isAdmin = false;
const adminPassword = 'system480'; // Should be securely managed

// When admin connects (e.g., from /admin page)
// This is a client-side example, admin part is mostly server-side logic
async function checkAdminAccess() {
    const password = prompt('Enter admin password:');
    if (!password) return;

    // This would typically be an HTTP request or a Socket.IO event
    // For this example, we'll simulate by checking against server-defined password
    // The actual admin route would handle validation.
    // In a real app, you'd have an admin socket namespace or flag.

    // Here we'll assume a simple check for demonstration:
    if (password === adminPassword) {
        alert('Admin access granted.');
        isAdmin = true;
        // You would then load admin-specific UI elements or send commands
        // For instance, fetch user lists etc.
        socket.emit('getUsers', (err, users) => {
            if (err) console.error(err);
            else console.log('All Users:', users);
        });
         socket.emit('getRooms', (err, rooms) => {
            if (err) console.error(err);
            else console.log('All Rooms:', rooms);
        });
    } else {
        alert('Invalid password.');
    }
}

// Example: if you visit /admin, you might call this
// Not integrated into the main chat loop for simplicity.
// In a full app, the admin panel would have its own socket.io connection or namespace.

// --- Initial Setup ---
document.addEventListener('DOMContentLoaded', () => {
    messageInput.disabled = true; // Disable until logged in
    setSendButtonState(false);

    // If you were to visit /admin, you might trigger admin checks here
    // Example: if (window.location.pathname === '/admin') checkAdminAccess();
});
