import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Octree } from 'three/examples/jsm/math/Octree';
import { Capsule } from 'three/examples/jsm/math/Capsule';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer';

// ── Configuration ──
const socket = io();
const otherPlayers = {};
let localPlayer = null;
let currentMap = null;
let currentRoomID = 'map1';
let clock = new THREE.Clock();
let loader = new GLTFLoader();
let gameStarted = false; // Prevent falling before map loads

// ── Physics Setup ──
const worldOctree = new Octree();
const playerCollider = new Capsule(new THREE.Vector3(0, 0.35, 0), new THREE.Vector3(0, 1.45, 0), 0.35);
const playerVelocity = new THREE.Vector3();
const playerDirection = new THREE.Vector3();
let playerOnFloor = false;
const GRAVITY = 30;

// ── FPS / Mouse Look ──
let isFP = true;
let isPointerLocked = false;
const mousePolar = new THREE.Euler(0, 0, 0, 'YXZ');
const MIN_POLAR_ANGLE = -Math.PI / 2 + 0.1;
const MAX_POLAR_ANGLE = Math.PI / 2 - 0.1;

// ── Scene Setup ──
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe8dff5);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('canvas-container').appendChild(renderer.domElement);

// CSS2D Renderer for Nametags
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

// ── Post-Processing (Bloom) ──
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.4, 0.85);
composer.addPass(bloomPass);

// ── Audio System ──
const listener = new THREE.AudioListener();
camera.add(listener);

const footstepSound = new THREE.Audio(listener);
const ambientSound = new THREE.Audio(listener);
const audioLoader = new THREE.AudioLoader();

// Placeholder sound URLs - usually you'd have actual .mp3 files
// I'll use programmatic silence/noise if not found, but I'll set up the logic
function setupAudio() {
    // Logic for loading sounds would go here
    // Example: audioLoader.load('footstep.mp3', buffer => { footstepSound.setBuffer(buffer); });
}
setupAudio();

// Lighting
const ambient = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(5, 10, 5);
scene.add(sun);

// ── Room Data ──
const roomData = {
    'map1': { file: 'map1.glb', name: 'Spawn PRINCIPAL', desc: 'Salles de classe et point de départ' },
    'map2': { file: 'map2.glb', name: 'Le COULOIR', desc: 'Le passage central entre les salles' },
    'room1': { file: 'map1.glb', name: 'Salle de Classe 1', desc: 'Salle de cours A-101' },
    'room2': { file: 'map1.glb', name: 'Salle de Classe 2', desc: 'Salle de cours B-202' }
};

// ── Model Loading Logic ──

function loadRoom(roomID) {
    showLoading();
    currentRoomID = roomID;

    if (currentMap) scene.remove(currentMap);
    worldOctree.clear();

    Object.keys(otherPlayers).forEach(id => {
        scene.remove(otherPlayers[id].mesh);
        delete otherPlayers[id];
    });

    const data = roomData[roomID] || roomData['map1'];
    loader.load(data.file, (gltf) => {
        currentMap = gltf.scene;
        scene.add(currentMap);
        worldOctree.fromGraphNode(currentMap);

        // Add Invisible Barriers for map2
        if (roomID === 'map2') {
            const barrierGeometry = new THREE.BoxGeometry(10, 10, 1);
            const barrierMaterial = new THREE.MeshBasicMaterial({ visible: false });
            const barrier1 = new THREE.Mesh(barrierGeometry, barrierMaterial);
            barrier1.position.set(-10, 5, 0);
            scene.add(barrier1);
            worldOctree.fromGraphNode(barrier1);
            const barrier2 = new THREE.Mesh(barrierGeometry, barrierMaterial);
            barrier2.position.set(10, 5, 0);
            scene.add(barrier2);
            worldOctree.fromGraphNode(barrier2);
        }

        hideLoading();

        // Reset Physics once room is loaded
        playerCollider.start.set(0, 0.35, 0); // Spawn at ground level
        playerCollider.end.set(0, 1.45, 0);
        playerVelocity.set(0, 0, 0);

        if (!localPlayer) createLocalPlayer();

        gameStarted = true;
    });
}

function showLoading() {
    document.getElementById('loading-overlay').style.display = 'flex';
    document.getElementById('loading-overlay').style.opacity = '1';
}

function hideLoading() {
    document.getElementById('loading-overlay').style.opacity = '0';
    setTimeout(() => {
        document.getElementById('loading-overlay').style.display = 'none';
    }, 500);
}

// ── Player Logic ──

function createLocalPlayer() {
    loader.load('player_model.glb', (gltf) => {
        localPlayer = gltf.scene;
        localPlayer.traverse(c => {
            if (c.isMesh) {
                c.material.depthWrite = true;
                if (isFP) c.visible = false;
            }
        });
        scene.add(localPlayer);
        playerCollider.start.set(0, 0.35, 0);
        playerCollider.end.set(0, 1.45, 0);
    });
}

// ── Input & Controls ──
const keys = {};
let isChatFocused = false;

function clearKeys() {
    for (const key in keys) { keys[key] = false; }
}

document.getElementById('chat-input').addEventListener('focus', () => { isChatFocused = true; clearKeys(); });
document.getElementById('chat-input').addEventListener('blur', () => isChatFocused = false);

window.addEventListener('keydown', (e) => {
    if (isChatFocused) return;
    keys[e.code] = true;
    if (e.code === 'KeyM' || e.key === 'm' || e.key === 'M') toggleHubMenu();
    if (e.code === 'Escape') closeModals();
});

window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', clearKeys);
document.addEventListener('visibilitychange', clearKeys);

// Pointer Lock
document.addEventListener('click', () => {
    if (!isPointerLocked && document.getElementById('hub-menu').style.display !== 'flex') {
        renderer.domElement.requestPointerLock();
    }
});
document.addEventListener('pointerlockchange', () => { isPointerLocked = (document.pointerLockElement === renderer.domElement); });
document.addEventListener('mousemove', (e) => {
    if (isPointerLocked) {
        mousePolar.y -= e.movementX * 0.002;
        mousePolar.x -= e.movementY * 0.002;
        mousePolar.x = Math.max(MIN_POLAR_ANGLE, Math.min(MAX_POLAR_ANGLE, mousePolar.x));
    }
});

function getForwardVector() {
    camera.getWorldDirection(playerDirection);
    playerDirection.y = 0;
    playerDirection.normalize();
    return playerDirection;
}

function getSideVector() {
    camera.getWorldDirection(playerDirection);
    playerDirection.y = 0;
    playerDirection.normalize();
    playerDirection.cross(camera.up);
    return playerDirection;
}

function playerCollisions() {
    const result = worldOctree.capsuleIntersect(playerCollider);
    playerOnFloor = false;
    if (result) {
        playerOnFloor = result.normal.y > 0;
        if (!playerOnFloor) {
            playerVelocity.addScaledVector(result.normal, -result.normal.dot(playerVelocity));
        }
        playerCollider.translate(result.normal.multiplyScalar(result.depth));
    }
}

let headBobTime = 0;
let fovTarget = 75;

function updatePlayer(dt) {
    if (!localPlayer || !gameStarted) return;

    const isSprinting = keys['ShiftLeft'] || keys['ShiftRight'];
    let moveSpeed = isSprinting ? 50 : 30;
    fovTarget = isSprinting ? 85 : 75;
    camera.fov = THREE.MathUtils.lerp(camera.fov, fovTarget, 0.1);
    camera.updateProjectionMatrix();

    let speedDelta = dt * (playerOnFloor ? moveSpeed : 10);

    if (keys['KeyW']) playerVelocity.add(getForwardVector().multiplyScalar(speedDelta));
    if (keys['KeyS']) playerVelocity.add(getForwardVector().multiplyScalar(-speedDelta));
    if (keys['KeyA']) playerVelocity.add(getSideVector().multiplyScalar(-speedDelta));
    if (keys['KeyD']) playerVelocity.add(getSideVector().multiplyScalar(speedDelta));

    if (playerOnFloor && keys['Space']) playerVelocity.y = 12;

    let damping = Math.exp(-6 * dt) - 1;
    if (!playerOnFloor) damping = Math.exp(-0.8 * dt) - 1;
    playerVelocity.addScaledVector(playerVelocity, damping);

    const deltaPosition = playerVelocity.clone().multiplyScalar(dt);
    playerCollider.translate(deltaPosition);

    playerCollisions();

    localPlayer.position.copy(playerCollider.start);
    localPlayer.position.y -= 0.35;
    localPlayer.rotation.y = mousePolar.y;

    socket.emit('playerMovement', { position: localPlayer.position, rotation: { y: localPlayer.rotation.y } });

    playerVelocity.y -= GRAVITY * dt;

    camera.position.copy(playerCollider.end);
    camera.position.y -= 0.1;

    // Head Bobbing & Footsteps
    const velHex = new THREE.Vector3(playerVelocity.x, 0, playerVelocity.z).length();
    if (playerOnFloor && velHex > 0.1) {
        headBobTime += dt * (isSprinting ? 14 : 10);
        camera.position.y += Math.sin(headBobTime) * 0.05 * (velHex / 5);
        camera.position.x += Math.cos(headBobTime * 0.5) * 0.02 * (velHex / 5);

        // Footstep logic (would play sound here)
        if (Math.sin(headBobTime) < -0.9) {
            // footstepSound.play();
        }
    } else {
        headBobTime = 0;
    }

    camera.quaternion.setFromEuler(mousePolar);

    // EMERGENCY TELEPORT: If player falls below world
    if (localPlayer.position.y < -20) {
        playerCollider.start.set(0, 2, 0);
        playerCollider.end.set(0, 3.1, 0);
        playerVelocity.set(0, 0, 0);
    }
}

// ── Hub Menu Logic ──
function toggleHubMenu() {
    const menu = document.getElementById('hub-menu');
    const isVisible = menu.style.display === 'flex' || window.getComputedStyle(menu).display === 'flex';
    if (isVisible) {
        menu.style.display = 'none';
        renderer.domElement.requestPointerLock();
    } else {
        clearKeys();
        menu.style.display = 'flex';
        document.exitPointerLock();
        renderHubGrid();
    }
}

function renderHubGrid() {
    const grid = document.getElementById('hub-grid');
    grid.innerHTML = '';
    Object.keys(roomData).forEach(id => {
        const item = document.createElement('div');
        item.className = 'hub-item';
        if (id === currentRoomID) item.style.borderColor = '#d4b8e8';
        item.innerHTML = `<h3>${roomData[id].name}</h3><p>${roomData[id].desc}</p>`;
        item.onclick = () => {
            socket.emit('joinRoom', id);
            loadRoom(id);
            document.getElementById('hub-menu').style.display = 'none';
            renderer.domElement.requestPointerLock();
        };
        grid.appendChild(item);
    });
}

function closeModals() {
    clearKeys();
    document.getElementById('hub-menu').style.display = 'none';
}

// ── Multiplayer ──

socket.on('currentPlayers', (players) => {
    Object.keys(players).forEach(id => {
        if (id !== socket.id) addOtherPlayer(players[id]);
    });
    if (!localPlayer) createLocalPlayer();
});

socket.on('newPlayer', (playerData) => { addOtherPlayer(playerData); });

socket.on('playerMoved', (playerData) => {
    if (otherPlayers[playerData.id]) {
        // Smooth interpolation target
        otherPlayers[playerData.id].targetPosition.copy(playerData.position);
        otherPlayers[playerData.id].targetRotation = playerData.rotation.y;
    }
});

socket.on('playerDisconnected', (id) => {
    if (otherPlayers[id]) {
        scene.remove(otherPlayers[id].mesh);
        delete otherPlayers[id];
    }
    updatePlayerCount();
});

function addOtherPlayer(playerData) {
    loader.load('player_model.glb', (gltf) => {
        const pModel = gltf.scene;
        pModel.position.copy(playerData.position);
        pModel.rotation.y = playerData.rotation.y;
        pModel.traverse(c => { if (c.isMesh) c.material.depthWrite = true; });
        scene.add(pModel);

        // Nametag
        const nameDiv = document.createElement('div');
        nameDiv.className = 'nametag';
        nameDiv.textContent = playerData.name || 'Étudiant';
        nameDiv.style.backgroundColor = 'rgba(107, 63, 160, 0.8)';
        nameDiv.style.color = '#fff';
        nameDiv.style.padding = '2px 8px';
        nameDiv.style.borderRadius = '10px';
        nameDiv.style.fontSize = '12px';
        nameDiv.style.fontFamily = 'Outfit, sans-serif';
        const nameLabel = new CSS2DObject(nameDiv);
        nameLabel.position.set(0, 1.8, 0);
        pModel.add(nameLabel);

        otherPlayers[playerData.id] = {
            mesh: pModel,
            targetPosition: new THREE.Vector3().copy(playerData.position),
            targetRotation: playerData.rotation.y
        };
        updatePlayerCount();
    });
}

function updatePlayerCount() {
    const count = Object.keys(otherPlayers).length + 1;
    document.getElementById('players-online').textContent = `Joueurs : ${count}`;
}

// ── Chat ──
const chatForm = document.getElementById('chat-input-container');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');

chatForm.onsubmit = (e) => {
    e.preventDefault();
    if (chatInput.value.trim()) { socket.emit('chatMessage', chatInput.value); chatInput.value = ''; }
};

socket.on('chatMessage', (data) => {
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message';
    msgEl.innerHTML = `<span class="user-name">${data.name}:</span> ${data.text}`;
    chatMessages.appendChild(msgEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

// ── Main Loop ──
function animate() {
    const dt = Math.min(0.05, clock.getDelta());
    requestAnimationFrame(animate);

    updatePlayer(dt);

    // Smooth Interpolation for Remote Players
    Object.keys(otherPlayers).forEach(id => {
        const p = otherPlayers[id];

        // Use a temp vector for X/Z interpolation to keep Y stable
        const targetPos = p.targetPosition.clone();
        p.mesh.position.lerp(targetPos, 0.2);

        // Handle rotation lerp
        let targetRot = p.targetRotation;
        let currentRot = p.mesh.rotation.y;
        p.mesh.rotation.y = THREE.MathUtils.lerp(currentRot, targetRot, 0.15);

        // Procedural limb animation for remote players (sine-wave legs/arms)
        const distToTarget = new THREE.Vector2(p.mesh.position.x - targetPos.x, p.mesh.position.z - targetPos.z).length();
        const isActuallyMoving = distToTarget > 0.05;

        p.mesh.traverse(child => {
            const name = child.name.toLowerCase();
            const time = Date.now() * 0.01;
            if (name.includes('arm')) {
                if (name.includes('l')) child.rotation.x = isActuallyMoving ? Math.sin(time) * 0.5 : 0;
                if (name.includes('r')) child.rotation.x = isActuallyMoving ? Math.sin(time + Math.PI) * 0.5 : 0;
            }
            if (name.includes('leg')) {
                if (name.includes('l')) child.rotation.x = isActuallyMoving ? Math.sin(time + Math.PI) * 0.6 : 0;
                if (name.includes('r')) child.rotation.x = isActuallyMoving ? Math.sin(time) * 0.6 : 0;
            }
        });
    });

    composer.render();
    labelRenderer.render(scene, camera);
}

loadRoom('map1');
animate();

window.onresize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    composer.setSize(w, h);
};
