const socket = io();

// --- State ---
let myId = null;
let myUsername = '';
let myRoom = null;
let myRole = 'pending';
let isHost = false;
let map = null;
let userMarker = null;
let boundaryPoints = [];
let boundaryPolygon = null;
let hiderMarkers = {};
let penaltyMarkers = {};
let playersList = {};
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
    btnDrawBounds: document.getElementById('btn-draw-bounds'),
    timerDisplay: document.getElementById('timer-display'),
    statusMsg: document.getElementById('status-message'),
    boundaryControls: document.getElementById('boundary-controls'),
    btnConfirmBoundary: document.getElementById('btn-confirm-boundary'),
    btnResetBoundary: document.getElementById('btn-reset-boundary'),
    roleIndicator: document.getElementById('role-indicator'),
    gameAlerts: document.getElementById('game-alerts')
};

function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[viewName].classList.remove('hidden');
}

// --- Player List ---
function updatePlayerList(players) {
    playersList = players;
    elements.playerList.innerHTML = '';

    Object.values(players).forEach(player => {
        const isMe = player.id === socket.id;
        const row = document.createElement('div');
        row.className = "flex items-center justify-between p-3 bg-gray-950/50 border border-gray-800 rounded-xl";

        const role = player.role || 'pending';
        let roleBadge = `<span class="px-3 py-1 text-xs font-bold uppercase rounded-full bg-gray-800 text-gray-400">Pending</span>`;

        if (role === 'host') roleBadge = `<span class="px-3 py-1 text-xs font-bold uppercase rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30"><i class="fa-solid fa-crown mr-1"></i>Host</span>`;
        if (role === 'seeker') roleBadge = `<span class="px-3 py-1 text-xs font-bold uppercase rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30"><i class="fa-solid fa-binoculars mr-1"></i>Seeker</span>`;
        if (role === 'hider') roleBadge = `<span class="px-3 py-1 text-xs font-bold uppercase rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"><i class="fa-solid fa-eye-slash mr-1"></i>Hider</span>`;

        // Host sees role buttons for non-host players
        let rightSide = roleBadge;
        if (isHost && player.id !== socket.id) {
            const isSeeker = role === 'seeker';
            const isHider = role === 'hider';
            rightSide = `
                <div class="flex gap-1">
                    <button onclick="setRole('${player.id}','seeker')" class="px-2.5 py-1 text-xs font-bold rounded-md transition ${isSeeker ? 'bg-blue-600 text-white' : 'bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white'}">Seeker</button>
                    <button onclick="setRole('${player.id}','hider')" class="px-2.5 py-1 text-xs font-bold rounded-md transition ${isHider ? 'bg-emerald-600 text-white' : 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white'}">Hider</button>
                </div>
            `;
        }

        row.innerHTML = `
            <div class="flex items-center gap-2">
                <div class="w-8 h-8 bg-gray-800 border border-gray-700 flex items-center justify-center rounded-lg text-sm font-bold text-gray-300">
                    <i class="fa-solid ${role === 'host' ? 'fa-crown text-amber-400' : 'fa-user'}"></i>
                </div>
                <div>
                    <p class="font-bold text-white text-sm">${player.username} ${isMe ? '<span class="text-[10px] bg-rose-500/20 text-rose-400 px-1.5 py-0.5 rounded font-extrabold uppercase">You</span>' : ''}</p>
                </div>
            </div>
            <div>${rightSide}</div>
        `;
        elements.playerList.appendChild(row);
    });

    // Show start button only if at least one seeker and one hider are assigned
    if (isHost) {
        const hasSeeker = Object.values(players).some(p => p.role === 'seeker');
        const hasHider = Object.values(players).some(p => p.role === 'hider');
        elements.btnStartGame.classList.toggle('hidden', !(hasSeeker && hasHider));
    }
}

window.setRole = (playerId, role) => {
    socket.emit('assignRole', { roomCode: myRoom, playerId, role });
};

// --- Lobby ---
document.getElementById('btn-create').onclick = () => {
    myUsername = elements.usernameInput.value.trim() || 'Anonymous';
    socket.emit('createGame', { username: myUsername });
};

document.getElementById('btn-join').onclick = () => {
    myUsername = elements.usernameInput.value.trim() || 'Anonymous';
    const room = elements.roomInput.value.trim().toUpperCase();
    if (!room) return alert('Enter room code');
    socket.emit('joinGame', { roomCode: room, username: myUsername });
};

elements.btnStartGame.onclick = () => {
    if (boundaryPoints.length < 3) {
        return alert("Draw a Play Zone border first!");
    }
    socket.emit('startGame', myRoom);
};

elements.btnDrawBounds.onclick = () => {
    switchView('game');
    initMap();
    elements.boundaryControls.classList.remove('hidden');
};

// --- Map ---
function initMap() {
    if (map) return;

    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([0, 0], 15);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 20 }).addTo(map);

    navigator.geolocation.getCurrentPosition(pos => {
        const { latitude, longitude } = pos.coords;
        map.setView([latitude, longitude], 16);

        userMarker = L.marker([latitude, longitude], {
            icon: L.divIcon({
                className: '',
                html: `<div class="relative flex items-center justify-center">
                    <span class="animate-ping absolute inline-flex h-6 w-6 rounded-full bg-rose-400 opacity-75"></span>
                    <span class="relative inline-flex rounded-full h-4.5 w-4.5 bg-rose-500 border-2 border-white"></span>
                </div>`
            })
        }).addTo(map);
    }, () => {}, { enableHighAccuracy: true });

    map.on('click', (e) => {
        if (elements.boundaryControls.classList.contains('hidden')) return;
        const { lat, lng } = e.latlng;
        boundaryPoints.push([lat, lng]);
        redrawBoundary();
    });
}

function redrawBoundary() {
    if (boundaryPolygon) map.removeLayer(boundaryPolygon);
    if (boundaryPoints.length >= 3) {
        boundaryPolygon = L.polygon(boundaryPoints, { color: '#f43f5e', fillColor: '#f43f5e', fillOpacity: 0.15, weight: 3, dashArray: '5, 5' }).addTo(map);
    } else if (boundaryPoints.length > 0) {
        boundaryPolygon = L.polyline(boundaryPoints, { color: '#f43f5e', weight: 3 }).addTo(map);
    }
}

elements.btnResetBoundary.onclick = () => {
    boundaryPoints = [];
    if (boundaryPolygon) { map.removeLayer(boundaryPolygon); boundaryPolygon = null; }
};

elements.btnConfirmBoundary.onclick = () => {
    if (boundaryPoints.length < 3) return alert("Tap at least 3 points on the map.");
    socket.emit('setBoundary', { roomCode: myRoom, boundary: boundaryPoints });
    elements.boundaryControls.classList.add('hidden');
    switchView('lobby');
};

// --- Tracking ---
function startTracking() {
    navigator.geolocation.watchPosition(pos => {
        const location = [pos.coords.latitude, pos.coords.longitude];
        if (userMarker) userMarker.setLatLng(location);
        socket.emit('updateLocation', { roomCode: myRoom, location });
    }, () => {}, { enableHighAccuracy: true, maximumAge: 0 });
}

function triggerAlert(msg, type = 'warning') {
    const div = document.createElement('div');
    div.className = `p-3 px-4 rounded-xl flex items-center gap-2 shadow-2xl border glassmorphism animate-bounce pointer-events-auto max-w-sm ${type === 'danger' ? 'text-red-500 border-red-500/20' : 'text-amber-500 border-amber-500/20'}`;
    div.innerHTML = `<i class="fa-solid ${type === 'danger' ? 'fa-triangle-exclamation animate-pulse' : 'fa-circle-exclamation'}"></i><span class="text-xs font-black uppercase tracking-wider">${msg}</span>`;
    elements.gameAlerts.appendChild(div);
    setTimeout(() => div.remove(), 5000);
}

// --- Timers ---
function runCountdown(sec, cb) {
    if (timerInterval) clearInterval(timerInterval);
    let left = sec;
    updateTimerUI(left);
    timerInterval = setInterval(() => {
        left--;
        updateTimerUI(left);
        if (left <= 0) { clearInterval(timerInterval); if (cb) cb(); }
    }, 1000);
}

function updateTimerUI(sec) {
    elements.timerDisplay.innerText = `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
}

// --- Socket Events ---
socket.on('gameCreated', ({ roomCode, role }) => {
    myRoom = roomCode; isHost = true; myRole = role;
    elements.displayRoomCode.innerText = roomCode;
    elements.setupContainer.classList.add('hidden');
    elements.roomInfo.classList.remove('hidden');
    elements.btnDrawBounds.classList.remove('hidden');
    switchView('lobby');
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
    if (players[socket.id]) {
        myRole = players[socket.id].role;
        elements.roleIndicator.innerText = `Role: ${myRole}`;
    }
});

socket.on('boundaryUpdated', (boundary) => {
    boundaryPoints = boundary;
    if (!map) initMap();
    redrawBoundary();
});

socket.on('gameStarted', ({ state, duration }) => {
    switchView('game');
    initMap();
    startTracking();

    if (state === 'headstart') {
        elements.statusMsg.innerText = 'Hiders: Run & Hide!';
        triggerAlert('Game Started: 1-minute headstart!');
        runCountdown(duration, () => {
            elements.statusMsg.innerText = 'Hunt Mode Active';
        });
    } else {
        elements.statusMsg.innerText = 'Hunt Mode Active';
        runCountdown(300, function loop() { runCountdown(300, loop); });
    }
});

socket.on('hiderPing', (hiders) => {
    Object.values(hiderMarkers).forEach(m => map.removeLayer(m));
    hiderMarkers = {};
    hiders.forEach(h => {
        if (myRole === 'seeker' && h.location) {
            const m = L.marker(h.location, {
                icon: L.divIcon({
                    className: '',
                    html: `<div class="relative"><span class="animate-ping absolute inline-flex h-8 w-8 rounded-full bg-amber-400 opacity-75"></span><span class="relative inline-flex rounded-full h-5 w-5 bg-amber-500 border-2 border-white flex items-center justify-center text-[10px] text-black font-extrabold"><i class="fa-solid fa-location-pin"></i></span></div>`
                })
            }).addTo(map).bindPopup(`<p class="font-extrabold text-xs">${h.username}</p>`);
            hiderMarkers[h.id] = m;
        }
    });
});

socket.on('cheatAlert', ({ playerId, username, location }) => {
    triggerAlert(`${username} left the zone! Live location shown!`, 'danger');
    if (penaltyMarkers[playerId]) {
        penaltyMarkers[playerId].setLatLng(location);
    } else {
        const m = L.marker(location, {
            icon: L.divIcon({
                className: '',
                html: `<div class="relative"><span class="animate-ping absolute inline-flex h-10 w-10 rounded-full bg-red-500 opacity-75"></span><span class="relative inline-flex rounded-full h-6 w-6 bg-red-600 border-2 border-white flex items-center justify-center"><i class="fa-solid fa-triangle-exclamation text-xs text-white"></i></span></div>`
            })
        }).addTo(map).bindPopup(`<p class="font-extrabold text-xs text-red-600 uppercase">PENALTY: ${username}</p>`);
        penaltyMarkers[playerId] = m;
    }
});

socket.on('error', (msg) => alert(msg));
