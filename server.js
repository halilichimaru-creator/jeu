const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(__dirname));

const players = {};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Initial player state
    players[socket.id] = {
        id: socket.id,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        name: 'Joueur ' + socket.id.substr(0, 4),
        room: 'map1' // Default starting room (Spawn/Classroom)
    };

    socket.join(players[socket.id].room);

    // Send the current players in the same room to the new player
    const playersInRoom = {};
    Object.keys(players).forEach(id => {
        if (players[id].room === players[socket.id].room) {
            playersInRoom[id] = players[id];
        }
    });
    socket.emit('currentPlayers', playersInRoom);

    // Notify other players in the same room about the new player
    socket.to(players[socket.id].room).emit('newPlayer', players[socket.id]);

    // Handle room joining
    socket.on('joinRoom', (roomID) => {
        const oldRoom = players[socket.id].room;

        // Update state
        players[socket.id].room = roomID;
        players[socket.id].position = { x: 0, y: 0, z: 0 }; // Reset pos on TP

        socket.leave(oldRoom);
        socket.join(roomID);

        // Tell everyone in old room that player left
        socket.to(oldRoom).emit('playerDisconnected', socket.id);

        // Tell new room player joined
        socket.to(roomID).emit('newPlayer', players[socket.id]);

        // Send current players in new room to the player
        const newPlayersInRoom = {};
        Object.keys(players).forEach(id => {
            if (players[id].room === roomID) {
                newPlayersInRoom[id] = players[id];
            }
        });
        socket.emit('currentPlayers', newPlayersInRoom);
    });

    // Handle player movement
    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].position = movementData.position;
            players[socket.id].rotation = movementData.rotation;
            // Broadcast only to players in same room
            socket.to(players[socket.id].room).emit('playerMoved', players[socket.id]);
        }
    });

    // Handle chat messages
    socket.on('chatMessage', (msg) => {
        // Send only to room
        io.to(players[socket.id].room).emit('chatMessage', {
            id: socket.id,
            name: players[socket.id].name,
            text: msg
        });
    });

    // Handle name change
    socket.on('updateName', (newName) => {
        if (players[socket.id]) {
            players[socket.id].name = newName;
            io.to(players[socket.id].room).emit('playerMoved', players[socket.id]);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const room = players[socket.id]?.room;
        delete players[socket.id];
        if (room) io.to(room).emit('playerDisconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
