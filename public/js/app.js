const socket = io(); // Auto-connects to the host that served the page

// --- State Variables ---
let myId = null;
let myUsername = '';
let myRoom = null;
let myRole = 'pending'; // 'host', 'seeker', 'hider', or 'pending'
let isHost = false;
let map = null;
let userMarker = null;
let boundaryPoints = [];
let boundaryPolygon = null;
let hiderMarkers = {}; // {playerId: marker}
let penaltyMarkers = {}; // {playerId: marker}
let playersList = {}; // Stored from server: {playerId: {id, username, role}}
let timerInterval = null;

// --- DOM Elements ---
const views = {
    lobby: document.getElementById('lobby-view'),
    game: document.getElementById('game-view')
};

const elements = {
    usernameInput: document.getElementById('username'),
    roomInput: document.getElementById('room-code'),
    setupContainer: document.getElementById('setup-container'),
    roomInfo: document.getElementById('room-info'),
    displayRoomCode: document.getElementById('display-room-code'),
    playerList: document.getElementById('player-list'),
    btnStartGame: document.getElementById('btn-start-game'),
    timerDisplay: document.getElementById('timer-display'),
    statusMsg: document.getElementById('status-message'),
    boundaryControls: document.getElementById('boundary-controls'),
    btnConfirmBoundary: document.getElementById('btn-confirm-boundary'),
    btnResetBoundary: document.getElementById('btn-reset-boundary'),
    roleIndicator: document.getElementById('role-indicator'),
    gameAlerts: document.getElementById('game-alerts')
};

// --- View Swapping ---
function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[viewName].classList.remove('hidden');
}

// --- Dynamic Player List Updater (Fixes Bug) ---
function updatePlayerList(players) {
    playersList = players;
    elements.playerList.innerHTML = '';
    
    Object.values(players).forEach(player => {
        const isMe = player.id === socket.id;
        const playerRow = document.createElement('div');
        playerRow.className = "flex items-center justify-between p-3 bg-gray-950/50 border border-gray-800 rounded-xl";
        
        let roleBadgeColor = "bg-gray-800 text-gray-400";
        if (player.role === 'host') roleBadgeColor = "bg-amber-500/15 text-amber-400 border border-amber-500/30";
        if (player.role === 'seeker') roleBadgeColor = "bg-blue-500/15 text-blue-400 border border-blue-500/30";
        if (player.role === 'hider') roleBadgeColor = "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30";

        // Generate inner content based on whether the current user is the Host or not
        let roleActionHtml = '';
        if (isHost && player.role !== 'host') {
            roleActionHtml = `
                <div class="flex gap-1">
                    <button onclick="setPlayerRole('${player.id}', 'seeker')" class="px-2.5 py-1 text-xs bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white rounded-md transition font-bold">Seeker</button>
                    <button onclick="setPlayerRole('${player.id}', 'hider')" class="px-2.5 py-1 text-xs bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded-md transition font-bold">Hider</button>
                </div>
            `;
        } else {
            roleActionHtml = `
                <span class="px-3 py-1 text-xs font-bold uppercase rounded-full ${roleBadgeColor}">
                    ${player.role}
                </span>
            `;
        }

        playerRow.innerHTML = `
            <div class="flex items-center gap-2">
                <div class="w-8 h-8 bg-gray-800 border border-gray-700 flex items-center justify-center rounded-lg text-sm font-bold text-gray-300">
                    <i class="fa-solid ${player.role === 'host' ? 'fa-crown text-amber-400' : 'fa-user'}"></i>
                </div>
                <div>
                    <p class="font-bold text-white text-sm flex items-center gap-1.5">
                        ${player.username} ${isMe ? '<span class="text-[10px] bg-rose-500/20 text-rose-400 px-1.5 py-0.5 rounded font-extrabold uppercase">You</span>' : ''}
                    </p>
                </div>
            </div>
            <div>${roleActionHtml}</div>
        `;
        elements.playerList.appendChild(playerRow);
    });

    // Check if the game is ready to start (Host must have assigned hiders and seekers)
    if (isHost) {
        const hasSeeker = Object.values(players).some(p => p.role === 'seeker');
        const hasHider = Object.values(players).some(p => p.role === 'hider');
        if (hasSeeker && hasHider) {
            elements.btnStartGame.classList.remove('hidden');
        } else {
            elements.btnStartGame.classList.add('hidden');
        }
    }
}

// Global hook to assign roles
window.setPlayerRole = (playerId, role) => {
    socket.emit('assignRole', { roomCode: myRoom, playerId, role });
};

// --- Lobby Interactions ---
document.getElementById('btn-create').onclick = () => {
    myUsername = elements.usernameInput.value.trim() || 'Anonymous';
    socket.emit('createGame', { username: myUsername });
};

document.getElementById('btn-join').onclick = () => {
    myUsername = elements.usernameInput.value.trim() || 'Anonymous';
    const room = elements.roomInput.value.trim().toUpperCase();
    if (!room) return alert('Please enter a room code');
    socket.emit('joinGame', { roomCode: room, username: myUsername });
};

elements.btnStartGame.onclick = () => {
    if (boundaryPoints.length < 3) {
        return alert("Please define a valid Play Zone border on the map first!");
    }
    socket.emit('startGame', myRoom);
};

// --- Map Drawing & Setup (Leaflet.js) ---
function initMap() {
    if (map) return; // Prevent double initialization

    map = L.map('map', {
        zoomControl: false, // Cleaner UI
        attributionControl: false
    }).setView([0, 0], 15);

    // Dark Map Theme (CartoDB Dark Matter)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 20
    }).addTo(map);

    navigator.geolocation.getCurrentPosition(pos => {
        const { latitude, longitude } = pos.coords;
        const latlng = [latitude, longitude];
        map.setView(latlng, 16);
        
        userMarker = L.marker(latlng, {
            icon: L.divIcon({
                className: 'user-marker',
                html: `<div class="relative flex items-center justify-center">
                    <span class="animate-ping absolute inline-flex h-6 w-6 rounded-full bg-rose-400 opacity-75"></span>
                    <span class="relative inline-flex rounded-full h-4.5 w-4.5 bg-rose-500 border border-white"></span>
                </div>`
            })
        }).addTo(map);
    }, err => console.error(err), { enableHighAccuracy: true });

    setupMapEvents();
}

function setupMapEvents() {
    if (!isHost) return;

    map.on('click', (e) => {
        // Only allow boundary creation if game is not started
        if (elements.boundaryControls.classList.contains('hidden')) return;

        const { lat, lng } = e.latlng;
        boundaryPoints.push([lat, lng]);
        
        drawBoundary();
    });
}

function drawBoundary() {
    if (boundaryPolygon) map.removeLayer(boundaryPolygon);
    
    if (boundaryPoints.length >= 3) {
        boundaryPolygon = L.polygon(boundaryPoints, {
            color: '#f43f5e',
            fillColor: '#f43f5e',
            fillOpacity: 0.15,
            weight: 3,
            dashArray: '5, 5'
        }).addTo(map);
    } else if (boundaryPoints.length > 0) {
        // Just draw lines if less than 3 points
        boundaryPolygon = L.polyline(boundaryPoints, { color: '#f43f5e', weight: 3 }).addTo(map);
    }
}

elements.btnResetBoundary.onclick = () => {
    boundaryPoints = [];
    if (boundaryPolygon) {
        map.removeLayer(boundaryPolygon);
        boundaryPolygon = null;
    }
};

elements.btnConfirmBoundary.onclick = () => {
    if (boundaryPoints.length < 3) {
        return alert("You must tap at least 3 points on the map to define the boundary.");
    }
    socket.emit('setBoundary', { roomCode: myRoom, boundary: boundaryPoints });
    elements.boundaryControls.classList.add('hidden');
    alert("Boundary Confirmed!");
};

// --- Live Location Tracker ---
function startTracking() {
    navigator.geolocation.watchPosition(pos => {
        const { latitude, longitude } = pos.coords;
        const location = [latitude, longitude];
        
        if (userMarker) userMarker.setLatLng(location);
        
        socket.emit('updateLocation', {
            roomCode: myRoom,
            location: location
        });
    }, err => console.error(err), {
        enableHighAccuracy: true,
        maximumAge: 0
    });
}

// --- Game Alerts ---
function triggerAlert(message, type = 'warning') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `p-3 px-4 rounded-xl flex items-center gap-2 shadow-2xl transition border glassmorphism animate-bounce pointer-events-auto max-w-sm ${
        type === 'danger' ? 'text-red-500 border-red-500/20' : 'text-amber-500 border-amber-500/20'
    }`;
    alertDiv.innerHTML = `
        <i class="fa-solid ${type === 'danger' ? 'fa-triangle-exclamation animate-pulse' : 'fa-circle-exclamation'}"></i>
        <span class="text-xs font-black uppercase tracking-wider">${message}</span>
    `;
    elements.gameAlerts.appendChild(alertDiv);
    
    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}

// --- Timers ---
function runCountdown(seconds, callback) {
    if (timerInterval) clearInterval(timerInterval);
    
    let timeLeft = seconds;
    updateTimerUI(timeLeft);
    
    timerInterval = setInterval(() => {
        timeLeft--;
        updateTimerUI(timeLeft);
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            if (callback) callback();
        }
    }, 1000);
}

function updateTimerUI(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    elements.timerDisplay.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// --- Socket Listeners ---
socket.on('gameCreated', ({ roomCode, role }) => {
    myRoom = roomCode;
    isHost = true;
    myRole = role;
    elements.displayRoomCode.innerText = roomCode;
    elements.setupContainer.classList.add('hidden');
    elements.roomInfo.classList.remove('hidden');
    switchView('lobby');
    
    // Automatically load map & trigger boundaries setup for the Host in background
    initMap();
    elements.boundaryControls.classList.remove('hidden');
});

socket.on('joinedGame', ({ roomCode, players }) => {
    myRoom = roomCode;
    elements.displayRoomCode.innerText = roomCode;
    elements.setupContainer.classList.add('hidden');
    elements.roomInfo.classList.remove('hidden');
    updatePlayerList(players);
    switchView('lobby');
});

socket.on('playersUpdated', (players) => {
    updatePlayerList(players);
    
    // Auto-update my local role indicator
    if (players[socket.id]) {
        myRole = players[socket.id].role;
        elements.roleIndicator.innerText = `Role: ${myRole}`;
    }
});

socket.on('boundaryUpdated', (boundary) => {
    boundaryPoints = boundary;
    initMap();
    drawBoundary();
});

socket.on('gameStarted', ({ state, duration }) => {
    switchView('game');
    initMap();
    startTracking();

    if (state === 'headstart') {
        elements.statusMsg.innerText = 'Hiders: Run and Hide!';
        triggerAlert("Game Started: 1 Minute Headstart!", "warning");
        runCountdown(duration, () => {
            elements.statusMsg.innerText = 'Game On! Seekers hunting...';
        });
    } else {
        elements.statusMsg.innerText = 'Hunt Mode Active';
        // Start recurring 5-minute ping loop countdown
        runCountdown(300, function loop() {
            runCountdown(300, loop);
        });
    }
});

socket.on('hiderPing', (hiders) => {
    // Clear old ping pins
    Object.values(hiderMarkers).forEach(m => map.removeLayer(m));
    hiderMarkers = {};

    triggerAlert("Hiders' location pinged on your map!", "warning");

    hiders.forEach(h => {
        if (myRole === 'seeker' && h.location) {
            const marker = L.marker(h.location, {
                icon: L.divIcon({
                    className: 'ping-marker',
                    html: `<div class="relative flex items-center justify-center">
                        <span class="animate-ping absolute inline-flex h-8 w-8 rounded-full bg-amber-400 opacity-75"></span>
                        <span class="relative inline-flex rounded-full h-5 w-5 bg-amber-500 border border-white flex items-center justify-center text-[10px] text-black font-extrabold"><i class="fa-solid fa-location-pin"></i></span>
                    </div>`
                })
            }).addTo(map).bindPopup(`<p class="font-extrabold text-xs text-slate-800 uppercase">${h.username}</p>`);
            hiderMarkers[h.id] = marker;
        }
    });
});

socket.on('cheatAlert', ({ playerId, username, location }) => {
    triggerAlert(`${username} physically left the play zone! LIVE location revealed!`, "danger");
    
    if (penaltyMarkers[playerId]) {
        penaltyMarkers[playerId].setLatLng(location);
    } else {
        const marker = L.marker(location, {
            icon: L.divIcon({
                className: 'penalty-marker',
                html: `<div class="relative flex items-center justify-center">
                    <span class="animate-ping absolute inline-flex h-10 w-10 rounded-full bg-red-500 opacity-75"></span>
                    <span class="relative inline-flex rounded-full h-6 w-6 bg-red-600 border border-white flex items-center justify-center text-xs text-white"><i class="fa-solid fa-triangle-exclamation"></i></span>
                </div>`
            })
        }).addTo(map).bindPopup(`<p class="font-extrabold text-xs text-red-600 uppercase">PENALTY: ${username}</p>`);
        penaltyMarkers[playerId] = marker;
    }
});

socket.on('error', (message) => {
    alert(message);
});
