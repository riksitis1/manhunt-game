const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { isPointInPolygon } = require('./utils/geofencing');

const app = express();
app.use(cors());
app.use(express.static('public'));
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

const games = {};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('createGame', ({ username }) => {
        const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
        const hostName = username || 'Host';
        games[roomCode] = {
            host: socket.id,
            players: {
                [socket.id]: { id: socket.id, username: hostName, role: 'host', location: null }
            },
            boundary: [], // Array of [lat, lng]
            state: 'lobby', // 'lobby', 'headstart', 'playing'
            pingTimer: null
        };
        socket.join(roomCode);
        socket.emit('gameCreated', { roomCode, role: 'host' });
        io.to(roomCode).emit('playersUpdated', games[roomCode].players);
    });

    socket.on('joinGame', ({ roomCode, username }) => {
        const game = games[roomCode];
        if (!game) return socket.emit('error', 'Game not found');

        const playerUsername = username || `Player_${socket.id.slice(0, 4)}`;
        socket.join(roomCode);
        game.players[socket.id] = { id: socket.id, username: playerUsername, role: 'pending', location: null };
        
        socket.emit('joinedGame', { roomCode, players: game.players });
        io.to(roomCode).emit('playersUpdated', game.players);
    });

    socket.on('assignRole', ({ roomCode, playerId, role }) => {
        const game = games[roomCode];
        if (game && game.host === socket.id) {
            if (game.players[playerId]) {
                game.players[playerId].role = role;
                io.to(roomCode).emit('playersUpdated', game.players);
            }
        }
    });

    socket.on('setBoundary', ({ roomCode, boundary }) => {
        const game = games[roomCode];
        if (game && game.host === socket.id) {
            game.boundary = boundary;
            io.to(roomCode).emit('boundaryUpdated', boundary);
        }
    });

    socket.on('startGame', (roomCode) => {
        const game = games[roomCode];
        if (game && game.host === socket.id) {
            game.state = 'headstart';
            io.to(roomCode).emit('gameStarted', { state: 'headstart', duration: 60 });
            
            setTimeout(() => {
                game.state = 'playing';
                io.to(roomCode).emit('gameStarted', { state: 'playing' });
                startPingCycle(roomCode);
            }, 60000);
        }
    });

    socket.on('updateLocation', ({ roomCode, location }) => {
        const game = games[roomCode];
        if (!game) return;

        const player = game.players[socket.id];
        if (!player) return;
        player.location = location;

        if (game.state === 'playing' && player.role === 'hider') {
            const isInside = isPointInPolygon(location, game.boundary);
            if (!isInside) {
                // Anti-cheat: Broadcast real-time location if outside boundary
                io.to(roomCode).emit('cheatAlert', { playerId: socket.id, username: player.username, location });
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        // Clean up player from rooms
        for (const roomCode in games) {
            const game = games[roomCode];
            if (game.players[socket.id]) {
                delete game.players[socket.id];
                if (game.host === socket.id) {
                    // Host disconnected, delete game
                    clearInterval(game.pingTimer);
                    io.to(roomCode).emit('error', 'Host disconnected. Game ended.');
                    delete games[roomCode];
                } else {
                    io.to(roomCode).emit('playersUpdated', game.players);
                }
            }
        }
    });
});

function startPingCycle(roomCode) {
    const game = games[roomCode];
    if (!game) return;

    game.pingTimer = setInterval(() => {
        const hiderLocations = Object.values(game.players)
            .filter(p => p.role === 'hider')
            .map(p => ({ id: p.id, username: p.username, location: p.location }));
        
        io.to(roomCode).emit('hiderPing', hiderLocations);
    }, 300000); // 5 minutes
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
