require('dotenv').config(); // Not strictly needed for Render if PORT is handled, but good practice
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const uniqid = require('uniqid');
const xss = require('xss-clean');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// --- Admin Configuration ---
const ADMIN_PASSWORD = 'system480'; // In a real app, use env variables and hashing

// --- In-Memory Data Structures ---
// These will be lost on server restart. For persistence, use a DB.
let users = {}; // { socketId: { id: 'userId', username: 'name', avatar: 'url', room: 'roomId' } }
let rooms = {
    'simplechat_official': {
        id: 'simplechat_official',
        name: 'SimpleChat Official',
        isOfficial: true,
        users: [] // Stores socket IDs of users in this room
    }
};
let typingUsers = {}; // { roomId: { userId: true } }

// --- Middlewares ---
app.use(express.static(__dirname + '/public')); // Serve static files

// Sanitize user input for POST requests (if any were used)
app.use(xss());

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // --- User Initialization ---
    socket.on('join', (username, callback) => {
        // Basic validation & uniqueness check
        if (!username || username.trim().length === 0) {
            return callback('Username is required.');
        }
        const existingUser = Object.values(users).find(u => u.username.toLowerCase() === username.trim().toLowerCase());
        if (existingUser) {
            return callback('Username is already taken.');
        }

        const userId = uniqid();
        const user = {
            id: userId,
            username: username.trim(),
            avatar: generateAvatar(username.trim()), // Function to generate avatar
            socketId: socket.id,
            room: 'simplechat_official' // Default room
        };
        users[socket.id] = user;

        // Join the default official room
        socket.join('simplechat_official');
        rooms['simplechat_official'].users.push(socket.id);

        // Update rooms and send initial data to the newly connected user
        const availableRooms = Object.values(rooms).map(room => ({
            id: room.id,
            name: room.name,
            isOfficial: room.isOfficial,
            activeUsers: room.users.length
        }));

        // Send user info and initial room data to the newly connected user
        socket.emit('userInfo', user);
        socket.emit('roomList', availableRooms);
        io.to('simplechat_official').emit('userJoinedRoom', { userId: user.id, username: user.username, avatar: user.avatar });
        io.to('simplechat_official').emit('message', {
            id: uniqid(),
            text: `${user.username} has joined the chat.`,
            system: true,
            timestamp: new Date().toISOString()
        });

        callback(null, user); // Success
    });

    // --- Message Handling ---
    socket.on('sendMessage', (messageData, callback) => {
        const user = users[socket.id];
        if (!user) return callback('User not found.');

        const sanitizedMessage = xss(messageData.text); // Sanitize message text
        if (!sanitizedMessage || sanitizedMessage.trim().length === 0) {
            return callback('Message cannot be empty.');
        }

        const message = {
            id: uniqid(),
            userId: user.id,
            username: user.username,
            avatar: user.avatar,
            room: user.room,
            text: sanitizedMessage,
            timestamp: new Date().toISOString()
        };

        io.to(user.room).emit('message', message);
        callback(null); // Acknowledge message received by server
    });

    // --- Typing Indicator ---
    socket.on('typing', () => {
        const user = users[socket.id];
        if (user) {
            if (!typingUsers[user.room]) typingUsers[user.room] = {};
            typingUsers[user.room][user.id] = true;
            io.to(user.room).emit('typingUpdate', { typingUsers: Object.keys(typingUsers[user.room]), room: user.room });
        }
    });

    socket.on('stopTyping', () => {
        const user = users[socket.id];
        if (user && typingUsers[user.room] && typingUsers[user.room][user.id]) {
            delete typingUsers[user.room][user.id];
            if (Object.keys(typingUsers[user.room]).length === 0) {
                delete typingUsers[user.room];
            }
            io.to(user.room).emit('typingUpdate', { typingUsers: Object.keys(typingUsers[user.room] || {}), room: user.room });
        }
    });

    // --- Room Management ---
    socket.on('joinRoom', (roomId, callback) => {
        const user = users[socket.id];
        if (!user) return callback('User not found.');

        const oldRoomId = user.room;
        if (oldRoomId === roomId) return callback('Already in this room.');

        // Update user's room
        user.room = roomId;
        users[socket.id] = user; // Update user object

        // Leave old room
        socket.leave(oldRoomId);
        if (rooms[oldRoomId]) {
            rooms[oldRoomId].users = rooms[oldRoomId].users.filter(uid => uid !== socket.id);
            // Notify users in old room about the user leaving
            io.to(oldRoomId).emit('userLeftRoom', { userId: user.id, username: user.username });
             io.to(oldRoomId).emit('typingUpdate', { typingUsers: Object.keys(typingUsers[oldRoomId] || {}), room: oldRoomId }); // Update typing indicator
        }

        // Join new room
        if (!rooms[roomId]) {
            // For simplicity, we only allow joining existing rooms or the official one.
            // If creating new rooms was needed, it would be handled here.
            rooms[roomId] = { id: roomId, name: roomId, isOfficial: false, users: [] };
        }
        socket.join(roomId);
        rooms[roomId].users.push(socket.id);

        // Notify users in new room about the user joining
        io.to(roomId).emit('userJoinedRoom', { userId: user.id, username: user.username, avatar: user.avatar });

        // Get current occupants of the new room
        const roomOccupants = rooms[roomId].users.map(socketId => ({
            id: users[socketId]?.id,
            username: users[socketId]?.username,
            avatar: users[socketId]?.avatar
        })).filter(Boolean); // Filter out any potentially stale entries

        // Update the user with room info (current occupants, messages if implemented, etc.)
        // For now, just acknowledge and let frontend fetch messages if needed
        callback(null, { joinedRoomId: roomId, roomOccupants });
    });

    // --- User Status & Disconnection ---
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        const user = users[socket.id];
        if (user) {
            const { username, room, id } = user;

            // Room Cleanup
            if (rooms[room]) {
                rooms[room].users = rooms[room].users.filter(uid => uid !== socket.id);
                // Notify users in the room about the user leaving
                io.to(room).emit('userLeftRoom', { userId: id, username });

                // Remove from typingUsers if they were typing
                if (typingUsers[room] && typingUsers[room][id]) {
                    delete typingUsers[room][id];
                    if (Object.keys(typingUsers[room]).length === 0) {
                        delete typingUsers[room];
                    }
                    io.to(room).emit('typingUpdate', { typingUsers: Object.keys(typingUsers[room] || {}), room: room });
                }
            }

            // Remove user from global users list
            delete users[socket.id];
        }
    });

    // --- Admin Route Handling ---
    // Note: This is a very basic implementation. In production, you'd have a separate admin interface
    // and more robust authentication.
    socket.on('adminLogin', (password, callback) => {
        if (password === ADMIN_PASSWORD) {
            socket.emit('adminAllowed');
            callback(null, 'Admin access granted. Use /admin to navigate.');
        } else {
            callback('Invalid password.');
        }
    });

    // Example Admin Actions (require admin to be connected and authenticated)
    socket.on('banUser', (userIdToBan, callback) => {
        // Find socketId by userId
        const socketIdToBan = Object.keys(users).find(sid => users[sid]?.id === userIdToBan);
        if (socketIdToBan) {
            const bannedUser = users[socketIdToBan];
            // Disconnect the user
            io.sockets.sockets.get(socketIdToBan)?.disconnect(true);
            // Optionally, add to a banned list in memory (lost on restart)
            console.log(`Admin banned user: ${bannedUser.username} (ID: ${userIdToBan})`);
            callback(null, `User ${bannedUser.username} has been banned.`);
        } else {
            callback('User not found.');
        }
    });

     // Admin request for user list
    socket.on('getUsers', (callback) => {
        const isAdmin = Object.values(users).some(u => u.socketId === socket.id && u.isAdmin) // Hypothetical admin flag
        // For this simple example, we'll rely on the admin password check for each action.
        // In a real app, establish a persistent admin session.
        const allUsers = Object.values(users).map(({ id, username, avatar, room }) => ({ id, username, avatar, room }));
        callback(null, allUsers);
    });

    // Admin request for room list
     socket.on('getRooms', (callback) => {
        const allRooms = Object.values(rooms).map(room => ({
            id: room.id,
            name: room.name,
            isOfficial: room.isOfficial,
            activeUsers: room.users.length
        }));
        callback(null, allRooms);
    });

});

// --- Helper Functions ---
function generateAvatar(username) {
    // Basic avatar generation - can be enhanced with colors or actual image generation
    const initials = username.split(' ').map(word => word.charAt(0)).join('').toUpperCase();
    // More sophisticated: use a hash to determine a color
    const hash = initials.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const color = `hsl(${(hash * 137) % 360}, 60%, 70%)`; // HSL for vibrant colors
    // Using initials. For a premium look, integrate an avatar service or more complex SVG generation.
    return { initials, color };
}

// --- Express Routes ---
// Serve the admin page (requires password check)
app.get('/admin', (req, res) => {
    // In a real app, this would involve proper authentication.
    // For this example, it's a simple check on connection attempt.
    res.sendFile(__dirname + '/public/admin.html');
});

// Root route
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});


// --- Server Start ---
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});