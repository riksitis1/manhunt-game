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

function cleanUsername(raw) {
    if (typeof raw !== 'string') return null;
    const cleaned = raw.replace(/[^a-zA-Z]/g, '').slice(0, 12);
    return cleaned.length >= 2 ? cleaned : null;
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('createGame', ({ username }) => {
        const hostName = cleanUsername(username) || 'Player';
        const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
        games[roomCode] = {
            host: socket.id,
            players: {
                [socket.id]: { id: socket.id, username: hostName, role: 'host', location: null, revealUsed: false }
            },
            boundary: [],
            state: 'lobby',
            pingTimer: null
        };
        socket.join(roomCode);
        socket.emit('gameCreated', { roomCode, role: 'host' });
        io.to(roomCode).emit('playersUpdated', { players: games[roomCode].players, hostId: socket.id });
    });

    socket.on('joinGame', ({ roomCode, username }) => {
        const game = games[roomCode];
        if (!game) return socket.emit('error', 'Game not found');
        const playerUsername = cleanUsername(username) || `Player_${socket.id.slice(0, 4)}`;
        socket.join(roomCode);
        game.players[socket.id] = { id: socket.id, username: playerUsername, role: 'pending', location: null, revealUsed: false };
        socket.emit('joinedGame', { roomCode, players: game.players, hostId: game.host });
        io.to(roomCode).emit('playersUpdated', { players: game.players, hostId: game.host });
    });

    socket.on('assignRole', ({ roomCode, playerId, role }) => {
        const game = games[roomCode];
        if (game && game.host === socket.id && game.players[playerId]) {
            game.players[playerId].role = role;
            io.to(roomCode).emit('playersUpdated', { players: game.players, hostId: game.host });
        }
    });

    socket.on('kickPlayer', ({ roomCode, playerId }) => {
        const game = games[roomCode];
        if (game && game.host === socket.id && playerId !== socket.id && game.players[playerId]) {
            const kickedSocket = io.sockets.sockets.get(playerId);
            if (kickedSocket) {
                kickedSocket.leave(roomCode);
                kickedSocket.emit('kicked', 'You were kicked by the host.');
            }
            delete game.players[playerId];
            io.to(roomCode).emit('playersUpdated', { players: game.players, hostId: game.host });
        }
    });

    socket.on('selfAssignRole', ({ roomCode, role }) => {
        const game = games[roomCode];
        if (game && game.players[socket.id] && ['seeker', 'hider'].includes(role)) {
            game.players[socket.id].role = role;
            io.to(roomCode).emit('playersUpdated', { players: game.players, hostId: game.host });
        }
    });

    socket.on('requestReveal', (roomCode) => {
        const game = games[roomCode];
        if (!game) return;
        const player = game.players[socket.id];
        if (!player || player.role !== 'hider' || player.revealUsed) return;

        player.revealUsed = true;

        const seekers = Object.values(game.players)
            .filter(p => p.role === 'seeker' && p.location)
            .map(p => ({ id: p.id, username: p.username, location: p.location }));

        io.to(roomCode).emit('seekerReveal', seekers);
        io.to(roomCode).emit('playersUpdated', { players: game.players, hostId: game.host });
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
            const seekers = Object.values(game.players)
                .filter(p => p.role === 'seeker' && p.location)
                .map(p => ({ playerId: p.id, username: p.username, location: p.location }));
            if (seekers.length > 0) {
                io.to(roomCode).emit('headstartSeekerUpdate', seekers);
            }
            setTimeout(() => {
                game.state = 'playing';
                io.to(roomCode).emit('gameStarted', { state: 'playing' });
                startPingCycle(roomCode);
            }, 60000);
        }
    });

    socket.on('endGame', (roomCode) => {
        const game = games[roomCode];
        if (game && game.host === socket.id) {
            clearInterval(game.pingTimer);
            game.state = 'lobby';
            Object.values(game.players).forEach(p => { p.revealUsed = false; });
            io.to(roomCode).emit('gameEnded');
        }
    });

    socket.on('updateLocation', ({ roomCode, location }) => {
        const game = games[roomCode];
        if (!game) return;
        const player = game.players[socket.id];
        if (!player) return;
        player.location = location;

        if (game.state === 'headstart' && player.role === 'seeker') {
            io.to(roomCode).emit('headstartSeekerUpdate', [{ playerId: socket.id, username: player.username, location }]);
        }

        if (game.state === 'playing' && game.boundary.length >= 3) {
            const isInside = isPointInPolygon(location, game.boundary);
            if (!isInside && (player.role === 'hider' || player.role === 'seeker')) {
                io.to(roomCode).emit('cheatAlert', { playerId: socket.id, username: player.username, location });
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        for (const roomCode in games) {
            const game = games[roomCode];
            if (game.players[socket.id]) {
                delete game.players[socket.id];
                if (game.host === socket.id) {
                    clearInterval(game.pingTimer);
                    io.to(roomCode).emit('error', 'Host disconnected. Game ended.');
                    delete games[roomCode];
                } else {
                    io.to(roomCode).emit('playersUpdated', { players: game.players, hostId: game.host });
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
        console.log(`[Ping] Room ${roomCode}: ${hiderLocations.length} hiders, ${hiderLocations.filter(h => h.location).length} with GPS`);
        io.to(roomCode).emit('hiderPing', hiderLocations);
    }, 300000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
