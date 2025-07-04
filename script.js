
const canvas = document.getElementById('mindmap-canvas');
const ctx = canvas.getContext('2d');

let nodes = [];
let connections = [];
let camera = {
    x: 0,
    y: 0,
    zoom: 1
};
let selectedNode = null;
let draggingNode = null;
let panning = false;
let lastMousePos = { x: 0, y: 0 };
let drawingConnection = false;
let connectionStartNode = null;
let textEditing = false;

const NODE_RADIUS = 60;
const NODE_COLOR = '#a3b1ff';
const NODE_SELECTED_COLOR = '#ffc87c';
const TEXT_COLOR = '#000000';
const LINE_COLOR = '#808080';

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    draw();
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function worldToScreen(x, y) {
    return {
        x: (x - camera.x) * camera.zoom + canvas.width / 2,
        y: (y - camera.y) * camera.zoom + canvas.height / 2
    };
}

function screenToWorld(x, y) {
    return {
        x: (x - canvas.width / 2) / camera.zoom + camera.x,
        y: (y - canvas.height / 2) / camera.zoom + camera.y
    };
}

function drawNode(node) {
    const screenPos = worldToScreen(node.x, node.y);
    const radius = NODE_RADIUS * camera.zoom;

    if (node === selectedNode) {
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#8A2BE2';
    } else {
        ctx.shadowBlur = 0;
    }

    ctx.fillStyle = node === selectedNode ? NODE_SELECTED_COLOR : NODE_COLOR;
    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0; // Reset shadow for other elements
    ctx.strokeStyle = '#505050';
    ctx.stroke();

    ctx.fillStyle = TEXT_COLOR;
    ctx.font = `${16 * camera.zoom}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.text, screenPos.x, screenPos.y);
}

function drawConnections() {
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 2 * camera.zoom;
    connections.forEach(([startIdx, endIdx]) => {
        if (nodes[startIdx] && nodes[endIdx]) {
            const startPos = worldToScreen(nodes[startIdx].x, nodes[startIdx].y);
            const endPos = worldToScreen(nodes[endIdx].x, nodes[endIdx].y);
            ctx.beginPath();
            ctx.moveTo(startPos.x, startPos.y);
            ctx.lineTo(endPos.x, endPos.y);
            ctx.stroke();
        }
    });

    if (drawingConnection && connectionStartNode) {
        const startPos = worldToScreen(connectionStartNode.x, connectionStartNode.y);
        ctx.beginPath();
        ctx.moveTo(startPos.x, startPos.y);
        ctx.lineTo(lastMousePos.x, lastMousePos.y);
        ctx.stroke();
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawConnections();
    nodes.forEach(drawNode);
}

canvas.addEventListener('mousedown', (e) => {
    const mousePos = { x: e.clientX, y: e.clientY };
    const worldPos = screenToWorld(mousePos.x, mousePos.y);
    let clickedOnNode = false;

    for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        const dx = worldPos.x - node.x;
        const dy = worldPos.y - node.y;
        if (dx * dx + dy * dy < NODE_RADIUS * NODE_RADIUS) {
            clickedOnNode = true;
            if (e.button === 0) { // Left click
                selectedNode = node;
                draggingNode = node;
                textEditing = false;
            } else if (e.button === 2) { // Right click
                drawingConnection = true;
                connectionStartNode = node;
            }
            break;
        }
    }

    if (!clickedOnNode) {
        selectedNode = null;
        textEditing = false;
        if (e.button === 1) { // Middle click
            panning = true;
        }
    }
    lastMousePos = mousePos;
});

canvas.addEventListener('mousemove', (e) => {
    const mousePos = { x: e.clientX, y: e.clientY };
    if (draggingNode) {
        const worldPos = screenToWorld(mousePos.x, mousePos.y);
        draggingNode.x = worldPos.x;
        draggingNode.y = worldPos.y;
    } else if (panning) {
        const dx = mousePos.x - lastMousePos.x;
        const dy = mousePos.y - lastMousePos.y;
        camera.x -= dx / camera.zoom;
        camera.y -= dy / camera.zoom;
    } else if (drawingConnection) {
        lastMousePos = mousePos;
    }
    lastMousePos = mousePos;
    draw();
});

canvas.addEventListener('mouseup', (e) => {
    if (e.button === 2 && drawingConnection) {
        const worldPos = screenToWorld(e.clientX, e.clientY);
        const endNode = nodes.find(node => {
            const dx = worldPos.x - node.x;
            const dy = worldPos.y - node.y;
            return dx * dx + dy * dy < NODE_RADIUS * NODE_RADIUS;
        });

        if (endNode && endNode !== connectionStartNode) {
            const startIdx = nodes.indexOf(connectionStartNode);
            const endIdx = nodes.indexOf(endNode);
            if (!connections.some(c => (c[0] === startIdx && c[1] === endIdx) || (c[0] === endIdx && c[1] === startIdx))) {
                connections.push([startIdx, endIdx]);
            }
        }
    }

    draggingNode = null;
    panning = false;
    drawingConnection = false;
    connectionStartNode = null;
    draw();
    saveState();
});

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const mousePos = { x: e.clientX, y: e.clientY };
    const worldPosBeforeZoom = screenToWorld(mousePos.x, mousePos.y);
    camera.zoom *= zoomFactor;
    const worldPosAfterZoom = screenToWorld(mousePos.x, mousePos.y);
    camera.x += worldPosBeforeZoom.x - worldPosAfterZoom.x;
    camera.y += worldPosBeforeZoom.y - worldPosAfterZoom.y;
    draw();
});

canvas.addEventListener('dblclick', (e) => {
    const worldPos = screenToWorld(e.clientX, e.clientY);
    nodes.push({
        x: worldPos.x,
        y: worldPos.y,
        text: 'New Node'
    });
    selectedNode = nodes[nodes.length - 1];
    textEditing = true;
    draw();
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && selectedNode) {
        e.preventDefault(); // Prevent default tab behavior
        const parentNode = selectedNode;
        const newNode = {
            x: parentNode.x + NODE_RADIUS * 2.5,
            y: parentNode.y,
            text: 'New Node'
        };
        nodes.push(newNode);
        const parentIndex = nodes.indexOf(parentNode);
        const newIndex = nodes.length - 1;
        connections.push([parentIndex, newIndex]);
        selectedNode = newNode;
        textEditing = true;
        draw();
        saveState();
        return; // Stop further execution
    }

    if (textEditing && selectedNode) {
        if (e.key === 'Enter') {
            textEditing = false;
            const parentConnection = connections.find(c => nodes[c[1]] === selectedNode);
            if (parentConnection) {
                const parentNode = nodes[parentConnection[0]];
                const newNode = {
                    x: selectedNode.x,
                    y: selectedNode.y + NODE_RADIUS * 1.5,
                    text: 'New Node'
                };
                nodes.push(newNode);
                const parentIndex = nodes.indexOf(parentNode);
                const newIndex = nodes.length - 1;
                connections.push([parentIndex, newIndex]);
                selectedNode = newNode;
                textEditing = true;
                saveState();
            }
        } else if (e.key === 'Backspace') {
            selectedNode.text = selectedNode.text.slice(0, -1);
        } else if (e.key.length === 1) {
            selectedNode.text += e.key;
        }
        draw();
    } else if (selectedNode && e.key.length === 1) {
        selectedNode.text = e.key;
        textEditing = true;
        draw();
    }
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

function saveState() {
    const state = {
        nodes: nodes,
        connections: connections,
        camera: camera
    };
    localStorage.setItem('mindmap', JSON.stringify(state));
}

function loadState() {
    const state = JSON.parse(localStorage.getItem('mindmap'));
    if (state) {
        nodes = state.nodes || [];
        connections = state.connections || [];
        camera = state.camera || { x: 0, y: 0, zoom: 1 };
    }
}

loadState();
draw();
