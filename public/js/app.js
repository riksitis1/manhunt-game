const socket = io();

let myRoom = null;
let myUsername = '';
let myRole = 'pending';
let isHost = false;
let map = null;
let userMarker = null;
let boundaryPoints = [];
let boundaryPolygon = null;
let hiderPingMarkers = [];
let pingIdCounter = 0;
let penaltyMarkers = {};
let lastPenaltyAlert = 0;
let lastGoodLocations = {};
let playersList = {};
let timerInterval = null;
let revealUsed = false;
let seekerMarkers = {};

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
    gameAlerts: document.getElementById('game-alerts'),
    hiderRevealContainer: document.getElementById('hider-reveal-container'),
    btnRevealSeekers: document.getElementById('btn-reveal-seekers'),
    hostControls: document.getElementById('host-controls'),
    btnEndGame: document.getElementById('btn-end-game')
};

function switchView(name) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[name].classList.remove('hidden');
}

function updatePlayerList(players, hostId) {
    playersList = players;
    elements.playerList.innerHTML = '';

    Object.values(players).forEach(p => {
        const isMe = p.id === socket.id;
        const isPlayerHost = p.id === hostId;
        const role = p.role || 'pending';
        const row = document.createElement('div');
        row.className = "flex items-center justify-between p-3 bg-gray-950/50 border border-gray-800 rounded-xl";

        let badge;
        if (isPlayerHost) badge = `<span class="px-3 py-1 text-xs font-bold uppercase rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30"><i class="fa-solid fa-crown mr-1"></i>Host</span>`;
        else if (role === 'seeker') badge = `<span class="px-3 py-1 text-xs font-bold uppercase rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30"><i class="fa-solid fa-binoculars mr-1"></i>Seeker</span>`;
        else if (role === 'hider') badge = `<span class="px-3 py-1 text-xs font-bold uppercase rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"><i class="fa-solid fa-eye-slash mr-1"></i>Hider</span>`;
        else badge = `<span class="px-3 py-1 text-xs font-bold uppercase rounded-full bg-gray-800 text-gray-400">Pending</span>`;

        let right = badge;
        if (isHost) {
            const isS = role === 'seeker';
            const isH = role === 'hider';
            right = `<div class="flex gap-1">
                <button onclick="hostRole('${p.id}','seeker')" class="px-2.5 py-1 text-xs font-bold rounded-md transition ${isS ? 'bg-blue-600 text-white' : 'bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white'}"><i class="fa-solid fa-binoculars mr-1"></i>Seeker</button>
                <button onclick="hostRole('${p.id}','hider')" class="px-2.5 py-1 text-xs font-bold rounded-md transition ${isH ? 'bg-emerald-600 text-white' : 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white'}"><i class="fa-solid fa-eye-slash mr-1"></i>Hider</button>
            </div>`;
        }

        row.innerHTML = `
            <div class="flex items-center gap-2">
                <div class="w-8 h-8 bg-gray-800 border border-gray-700 flex items-center justify-center rounded-lg text-sm font-bold text-gray-300">
                    <i class="fa-solid ${isPlayerHost ? 'fa-crown text-amber-400' : 'fa-user'}"></i>
                </div>
                <div><p class="font-bold text-white text-sm">${p.username} ${isMe ? '<span class="text-[10px] bg-rose-500/20 text-rose-400 px-1.5 py-0.5 rounded font-extrabold uppercase">You</span>' : ''}</p></div>
            </div>
            <div>${right}</div>
        `;
        elements.playerList.appendChild(row);
    });

    if (isHost) {
        const hasS = Object.values(players).some(p => p.role === 'seeker');
        const hasH = Object.values(players).some(p => p.role === 'hider');
        elements.btnStartGame.classList.toggle('hidden', !(hasS && hasH));
    }
}

function sanitizeUsername(raw) {
    const cleaned = raw.replace(/[^a-zA-Z]/g, '').slice(0, 12);
    if (cleaned.length < 2) return null;
    return cleaned;
}

window.hostRole = (pid, role) => socket.emit('assignRole', { roomCode: myRoom, playerId: pid, role });

function requestGpsPermission() {
    navigator.geolocation.getCurrentPosition(
        (pos) => { lastGoodLocations['_pending'] = [pos.coords.latitude, pos.coords.longitude]; },
        () => {},
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

document.getElementById('btn-create').onclick = () => {
    const name = sanitizeUsername(elements.usernameInput.value);
    if (!name) return alert('Name must be 2-12 letters only (A-Z)');
    myUsername = name;
    socket.emit('createGame', { username: myUsername });
    requestGpsPermission();
};
document.getElementById('btn-join').onclick = () => {
    const name = sanitizeUsername(elements.usernameInput.value);
    if (!name) return alert('Name must be 2-12 letters only (A-Z)');
    myUsername = name;
    const room = elements.roomInput.value.trim().toUpperCase();
    if (!room) return alert('Enter room code');
    socket.emit('joinGame', { roomCode: room, username: myUsername });
    requestGpsPermission();
};

elements.btnStartGame.onclick = () => {
    if (boundaryPoints.length < 3) return alert('Draw a Play Zone border first!');
    socket.emit('startGame', myRoom);
};
elements.btnDrawBounds.onclick = () => {
    switchView('game');
    initMap();
    elements.boundaryControls.classList.remove('hidden');
};

elements.btnRevealSeekers.onclick = () => {
    if (revealUsed) return;
    revealUsed = true;
    elements.hiderRevealContainer.classList.add('hidden');
    socket.emit('requestReveal', myRoom);
};
elements.btnEndGame.onclick = () => {
    if (confirm('End the game for everyone?')) {
        socket.emit('endGame', myRoom);
    }
};

// --- Map ---
function initMap() {
    if (map) {
        map.invalidateSize();
        return;
    }
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([0, 0], 15);

    // ESRI Satellite imagery (free, no API key needed)
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Esri, Maxar, Earthstar Geographics'
    }).addTo(map);

    // Overlay with street labels
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19
    }).addTo(map);

    const markerHex = myRole === 'seeker' ? '#3b82f6' : myRole === 'hider' ? '#10b981' : '#f43f5e';

    function onGpsSuccess(pos) {
        const { latitude, longitude, accuracy } = pos.coords;
        if (accuracy > 80) return;
        const loc = [latitude, longitude];
        map.setView(loc, 17);
        setupUserMarker(loc);
        lastGoodLocations[socket.id] = loc;
    }

    function onGpsError() {
        const pending = lastGoodLocations['_pending'];
        if (pending) {
            map.setView(pending, 16);
            setupUserMarker(pending);
        } else if (boundaryPoints.length >= 3) {
            const lat = boundaryPoints.reduce((s, p) => s + p[0], 0) / boundaryPoints.length;
            const lng = boundaryPoints.reduce((s, p) => s + p[1], 0) / boundaryPoints.length;
            map.setView([lat, lng], 14);
        }
    }

    function setupUserMarker(loc) {
        if (userMarker) { userMarker.setLatLng(loc); return; }
        userMarker = L.marker(loc, {
            icon: L.divIcon({
                className: '',
                html: `<div class="relative flex items-center justify-center">
                    <span class="animate-ping absolute inline-flex h-6 w-6 rounded-full opacity-75" style="background-color: ${markerHex}80"></span>
                    <span class="relative inline-flex rounded-full h-5 w-5 border-2 border-white" style="background-color: ${markerHex}"></span>
                </div>`
            })
        }).addTo(map).bindPopup('You are here');
    }

    const pendingLoc = lastGoodLocations['_pending'];
    if (pendingLoc) {
        map.setView(pendingLoc, 17);
        setupUserMarker(pendingLoc);
        lastGoodLocations[socket.id] = pendingLoc;
        delete lastGoodLocations['_pending'];
    } else {
        navigator.geolocation.getCurrentPosition(onGpsSuccess, onGpsError, { enableHighAccuracy: true, timeout: 10000 });
    }

    map.on('click', (e) => {
        if (elements.boundaryControls.classList.contains('hidden')) return;
        boundaryPoints.push([e.latlng.lat, e.latlng.lng]);
        redrawBoundary();
    });
}

function redrawBoundary() {
    if (boundaryPolygon) map.removeLayer(boundaryPolygon);
    if (boundaryPoints.length >= 3) {
        boundaryPolygon = L.polygon(boundaryPoints, { color: '#f43f5e', fillColor: '#f43f5e', fillOpacity: 0.15, weight: 3, dashArray: '5,5' }).addTo(map);
    } else if (boundaryPoints.length > 0) {
        boundaryPolygon = L.polyline(boundaryPoints, { color: '#f43f5e', weight: 3 }).addTo(map);
    }
}

elements.btnResetBoundary.onclick = () => {
    boundaryPoints = [];
    if (boundaryPolygon) { map.removeLayer(boundaryPolygon); boundaryPolygon = null; }
};
elements.btnConfirmBoundary.onclick = () => {
    if (boundaryPoints.length < 3) return alert('Tap at least 3 points on map');
    socket.emit('setBoundary', { roomCode: myRoom, boundary: boundaryPoints });
    elements.boundaryControls.classList.add('hidden');
    switchView('lobby');
};

function startTracking() {
    const ACCURACY_THRESHOLD = 80;
    const SMOOTHING = 0.3;
    let smoothed = null;
    navigator.geolocation.watchPosition(pos => {
        const { latitude, longitude, accuracy } = pos.coords;
        if (accuracy > ACCURACY_THRESHOLD) return;
        if (!smoothed) {
            smoothed = [latitude, longitude];
        } else {
            smoothed[0] += (latitude - smoothed[0]) * SMOOTHING;
            smoothed[1] += (longitude - smoothed[1]) * SMOOTHING;
        }
        const loc = [smoothed[0], smoothed[1]];
        lastGoodLocations[socket.id] = loc;
        if (userMarker) userMarker.setLatLng(loc);
        socket.emit('updateLocation', { roomCode: myRoom, location: loc });
    }, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
}

function triggerAlert(msg, type = 'warning') {
    const d = document.createElement('div');
    d.className = `p-3 px-4 rounded-xl flex items-center gap-2 shadow-2xl border glassmorphism animate-bounce pointer-events-auto max-w-sm ${type === 'danger' ? 'text-red-500 border-red-500/20' : type === 'info' ? 'text-purple-500 border-purple-500/20' : 'text-amber-500 border-amber-500/20'}`;
    d.innerHTML = `<i class="fa-solid ${type === 'danger' ? 'fa-triangle-exclamation animate-pulse' : type === 'info' ? 'fa-eye' : 'fa-circle-exclamation'}"></i><span class="text-xs font-black uppercase tracking-wider">${msg}</span>`;
    elements.gameAlerts.appendChild(d);
    setTimeout(() => d.remove(), 5000);
}

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

socket.on('joinedGame', ({ roomCode, players, hostId }) => {
    myRoom = roomCode;
    elements.displayRoomCode.innerText = roomCode;
    elements.setupContainer.classList.add('hidden');
    elements.roomInfo.classList.remove('hidden');
    updatePlayerList(players, hostId);
    switchView('lobby');
});

socket.on('playersUpdated', ({ players, hostId }) => {
    updatePlayerList(players, hostId);
    if (players[socket.id]) {
        const oldRole = myRole;
        myRole = players[socket.id].role;
        elements.roleIndicator.innerText = `Role: ${myRole}`;
        revealUsed = players[socket.id].revealUsed || false;
        const showReveal = myRole === 'hider' && !revealUsed;
        elements.hiderRevealContainer.classList.toggle('hidden', !showReveal);
        if (oldRole !== myRole && userMarker) {
            const hex = myRole === 'seeker' ? '#3b82f6' : myRole === 'hider' ? '#10b981' : '#f43f5e';
            userMarker.setIcon(L.divIcon({
                className: '',
                html: `<div class="relative flex items-center justify-center">
                    <span class="animate-ping absolute inline-flex h-6 w-6 rounded-full opacity-75" style="background-color: ${hex}80"></span>
                    <span class="relative inline-flex rounded-full h-5 w-5 border-2 border-white" style="background-color: ${hex}"></span>
                </div>`
            }));
        }
    }
});

socket.on('boundaryUpdated', (boundary) => {
    boundaryPoints = boundary;
    initMap();
    redrawBoundary();
});

socket.on('gameStarted', ({ state, duration }) => {
    switchView('game');
    initMap();
    startTracking();
    elements.hostControls.classList.toggle('hidden', !isHost);
    if (state === 'headstart') {
        elements.statusMsg.innerText = 'Hiders: RUN & HIDE!';
        triggerAlert('Game started! 1-minute headstart!', 'warning');
        runCountdown(duration, () => elements.statusMsg.innerText = 'Hunt Mode Active');
    } else {
        elements.statusMsg.innerText = 'Hunt Mode Active';
        runCountdown(300, function loop() { runCountdown(300, loop); });
    }
});

socket.on('hiderPing', (hiders) => {
    triggerAlert('Hider locations pinged! Latest positions revealed.', 'warning');
    const PING_FADE_MS = 300000;
    const batchId = ++pingIdCounter;
    hiders.forEach(h => {
        if (myRole === 'seeker' && h.location) {
            const m = L.marker(h.location, {
                icon: L.divIcon({
                    className: 'hider-ping-marker',
                    html: `<div class="hider-ping-inner"><span class="inline-flex rounded-full h-5 w-5 bg-amber-500 border-2 border-white flex items-center justify-center text-[10px] text-black font-extrabold shadow-lg shadow-amber-500/50"><i class="fa-solid fa-location-pin"></i></span><div class="text-center text-[9px] font-extrabold uppercase tracking-wider text-amber-300 drop-shadow-lg mt-0.5">${h.username}</div></div>`
                })
            }).addTo(map).bindPopup(`<p class="font-extrabold text-xs">${h.username} — latest ping</p>`);
            hiderPingMarkers.push({ marker: m, batchId });
            setTimeout(() => {
                const idx = hiderPingMarkers.findIndex(e => e.marker === m);
                if (idx !== -1) {
                    map.removeLayer(m);
                    hiderPingMarkers.splice(idx, 1);
                }
            }, PING_FADE_MS);
        }
    });
});

socket.on('seekerReveal', (seekers) => {
    triggerAlert('SEEKERS REVEALED for 5 seconds!', 'info');
    seekers.forEach(s => {
        if (s.location) {
            const m = L.marker(s.location, {
                icon: L.divIcon({
                    className: '',
                    html: `<div class="relative"><span class="animate-ping absolute inline-flex h-8 w-8 rounded-full bg-blue-400 opacity-75"></span><span class="relative inline-flex rounded-full h-5 w-5 bg-blue-600 border-2 border-white flex items-center justify-center text-[10px] text-white font-extrabold"><i class="fa-solid fa-person-running"></i></span></div>`
                })
            }).addTo(map).bindPopup(`<p class="font-extrabold text-xs text-blue-600 uppercase">Revealed: ${s.username}</p>`);
            seekerMarkers[s.id] = m;
        }
    });
    setTimeout(() => {
        Object.values(seekerMarkers).forEach(m => map.removeLayer(m));
        seekerMarkers = {};
    }, 5000);
});

socket.on('cheatAlert', ({ playerId, username, location }) => {
    const now = Date.now();
    if (now - lastPenaltyAlert > 3000) {
        lastPenaltyAlert = now;
        triggerAlert(`${username} left the zone! Live location shown!`, 'danger');
    }
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

socket.on('gameEnded', () => {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    elements.hostControls.classList.add('hidden');
    elements.hiderRevealContainer.classList.add('hidden');
    if (map) {
        hiderPingMarkers.forEach(e => map.removeLayer(e.marker));
        hiderPingMarkers = [];
        Object.values(penaltyMarkers).forEach(m => map.removeLayer(m));
        penaltyMarkers = {};
        map.remove();
        map = null;
        userMarker = null;
    }
    switchView('lobby');
    elements.setupContainer.classList.remove('hidden');
    elements.roomInfo.classList.add('hidden');
    elements.btnDrawBounds.classList.add('hidden');
    elements.btnStartGame.classList.add('hidden');
    triggerAlert('Game has ended by the host.', 'danger');
});

socket.on('error', (msg) => alert(msg));
