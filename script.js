
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

function getNodeLevel(node) {
    let level = 0;
    let queue = [{ node: node, currentLevel: 0 }];
    let visited = new Set();

    while (queue.length > 0) {
        let { node: currentNode, currentLevel } = queue.shift();

        if (visited.has(currentNode)) {
            continue;
        }
        visited.add(currentNode);

        // Find parents of the current node
        const parentConnections = connections.filter(c => nodes[c[1]] === currentNode);
        if (parentConnections.length > 0) {
            for (const conn of parentConnections) {
                const parentNode = nodes[conn[0]];
                level = Math.max(level, currentLevel + 1);
                queue.push({ node: parentNode, currentLevel: currentLevel + 1 });
            }
        }
    }
    return level;
}

function wrapText(context, text, maxWidth) {
    const words = text.split(' ');
    let line = '';
    const lines = [];

    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        const metrics = context.measureText(testLine);
        const testWidth = metrics.width;
        if (testWidth > maxWidth && n > 0) {
            lines.push(line.trim());
            line = words[n] + ' ';
        } else {
            line = testLine;
        }
    }
    lines.push(line.trim());
    return lines;
}

const linkIcon = new Image();
linkIcon.src = 'icons/link-8564589_640.png';

function drawNode(node) {
    const screenPos = worldToScreen(node.x, node.y);
    let currentRadius = NODE_RADIUS; // Start with default radius

    // Temporarily set font for initial text measurement
    ctx.font = `${16 * camera.zoom}px Arial`;
    const words = node.text.split(' ');
    let longestWordWidth = 0;
    words.forEach(word => {
        const wordWidth = ctx.measureText(word).width;
        if (wordWidth > longestWordWidth) {
            longestWordWidth = wordWidth;
        }
    });

    // Calculate required radius to fit the longest word
    const requiredWidthForLongestWord = longestWordWidth / 0.8; // 80% of node width for text
    const requiredRadiusForLongestWord = requiredWidthForLongestWord / (2 * camera.zoom);

    // Adjust currentRadius if a single word is too long
    if (requiredRadiusForLongestWord > currentRadius) {
        currentRadius = requiredRadiusForLongestWord;
    }

    const size = currentRadius * camera.zoom; // Final size for drawing

    if (node === selectedNode) {
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#8A2BE2';
    } else {
        ctx.shadowBlur = 0;
    }

    // Determine fill color based on node type and level
    let fillColor = node.color;
    if (node.type === 'child' || node.type === 'grandchild') {
        const level = getNodeLevel(node);
        if (level === 1) { // Direct child
            fillColor = '#8BC34A'; // Green
        } else if (level > 1) { // Grandchild or deeper
            // Lighter green based on level
            const lightness = 70 + (level - 2) * 5; // Adjust as needed
            fillColor = `hsl(90, 60%, ${lightness}%)`;
        }
    }

    ctx.fillStyle = node === selectedNode ? NODE_SELECTED_COLOR : fillColor;

    const borderRadius = 10; // Radius for rounded corners

    ctx.beginPath();
    if (node.shape === 'square') {
        // Draw a rounded rectangle
        ctx.roundRect(screenPos.x - size, screenPos.y - size, size * 2, size * 2, borderRadius);
    } else { // Default to circle
        ctx.arc(screenPos.x, screenPos.y, size, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.shadowBlur = 0; // Reset shadow for other elements
    ctx.strokeStyle = '#505050';
    ctx.stroke();

    // Draw text with wrapping and dynamic font size
    const maxTextWidth = (size * 2) * 0.8; // 80% of node width for text
    const maxTextHeight = (size * 2) * 0.8; // 80% of node height for text
    let fontSize = 16 * camera.zoom;
    let lines = [];
    let textHeight = 0;
    const minFontSize = 8; // Minimum readable font size

    do {
        ctx.font = `${fontSize}px Arial`;
        lines = wrapText(ctx, node.text, maxTextWidth);
        textHeight = lines.length * fontSize * 1.2; // 1.2 for line spacing
        if (textHeight > maxTextHeight && fontSize > minFontSize) {
            fontSize -= 1; // Reduce font size
        } else {
            break; // Fits or reached min font size
        }
    } while (fontSize >= minFontSize);

    if (fontSize >= minFontSize) {
        ctx.fillStyle = TEXT_COLOR;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let yOffset = screenPos.y - (textHeight / 2) + (fontSize * 0.6); // Adjust for vertical centering
        lines.forEach(line => {
            ctx.fillText(line, screenPos.x, yOffset);
            yOffset += fontSize * 1.2;
        });
    }

    // Draw link icon if URL exists
    if (node.url && linkIcon.complete) {
        const iconSize = 20 * camera.zoom; // Adjust size as needed
        const iconX = screenPos.x + size - iconSize / 2; // Position to the right of the node
        const iconY = screenPos.y - size + iconSize / 2; // Position to the top of the node

        ctx.drawImage(linkIcon, iconX - iconSize / 2, iconY - iconSize / 2, iconSize, iconSize);

        // Store icon bounds for click detection (absolute screen coordinates)
        node.urlIconBounds = {
            x: iconX - iconSize / 2,
            y: iconY - iconSize / 2,
            width: iconSize,
            height: iconSize
        };
    } else {
        node.urlIconBounds = null; // Clear bounds if no URL
    }

    // Draw link icon if URL exists
    if (node.url && linkIcon.complete) {
        const iconSize = 20 * camera.zoom; // Adjust size as needed
        const iconX = screenPos.x + size - iconSize / 2; // Position to the right of the node
        const iconY = screenPos.y - size + iconSize / 2; // Position to the top of the node

        ctx.drawImage(linkIcon, iconX - iconSize / 2, iconY - iconSize / 2, iconSize, iconSize);

        // Store icon bounds for click detection (absolute screen coordinates)
        node.urlIconBounds = {
            x: iconX - iconSize / 2,
            y: iconY - iconSize / 2,
            width: iconSize,
            height: iconSize
        };
    } else {
        node.urlIconBounds = null; // Clear bounds if no URL
    }

    // Draw link icon if URL exists
    if (node.url && linkIcon.complete) {
        const iconSize = 20 * camera.zoom; // Adjust size as needed
        const iconX = screenPos.x + size - iconSize / 2; // Position to the right of the node
        const iconY = screenPos.y - size + iconSize / 2; // Position to the top of the node

        ctx.drawImage(linkIcon, iconX - iconSize / 2, iconY - iconSize / 2, iconSize, iconSize);

        // Store icon bounds for click detection (absolute screen coordinates)
        node.urlIconBounds = {
            x: iconX - iconSize / 2,
            y: iconY - iconSize / 2,
            width: iconSize,
            height: iconSize
        };
    } else {
        node.urlIconBounds = null; // Clear bounds if no URL
    }

    // Draw link icon if URL exists
    if (node.url && linkIcon.complete) {
        const iconSize = 20 * camera.zoom; // Adjust size as needed
        const iconX = screenPos.x + size - iconSize / 2; // Position to the right of the node
        const iconY = screenPos.y - size + iconSize / 2; // Position to the top of the node

        ctx.drawImage(linkIcon, iconX - iconSize / 2, iconY - iconSize / 2, iconSize, iconSize);

        // Store icon bounds for click detection (absolute screen coordinates)
        node.urlIconBounds = {
            x: iconX - iconSize / 2,
            y: iconY - iconSize / 2,
            width: iconSize,
            height: iconSize
        };
    } else {
        node.urlIconBounds = null; // Clear bounds if no URL
    }

    // Draw link icon if URL exists
    if (node.url && linkIcon.complete) {
        const iconSize = 20 * camera.zoom; // Adjust size as needed
        const iconX = screenPos.x + size - iconSize / 2; // Position to the right of the node
        const iconY = screenPos.y - size + iconSize / 2; // Position to the top of the node

        ctx.drawImage(linkIcon, iconX - iconSize / 2, iconY - iconSize / 2, iconSize, iconSize);

        // Store icon bounds for click detection (absolute screen coordinates)
        node.urlIconBounds = {
            x: iconX - iconSize / 2,
            y: iconY - iconSize / 2,
            width: iconSize,
            height: iconSize
        };
    } else {
        node.urlIconBounds = null; // Clear bounds if no URL
    }

    // Draw link icon if URL exists
    if (node.url && linkIcon.complete) {
        const iconSize = 20 * camera.zoom; // Adjust size as needed
        const iconX = screenPos.x + size - iconSize / 2; // Position to the right of the node
        const iconY = screenPos.y - size + iconSize / 2; // Position to the top of the node

        ctx.drawImage(linkIcon, iconX - iconSize / 2, iconY - iconSize / 2, iconSize, iconSize);

        // Store icon bounds for click detection (absolute screen coordinates)
        node.urlIconBounds = {
            x: iconX - iconSize / 2,
            y: iconY - iconSize / 2,
            width: iconSize,
            height: iconSize
        };
    } else {
        node.urlIconBounds = null; // Clear bounds if no URL
    }

    // Draw link icon if URL exists
    if (node.url && linkIcon.complete) {
        const iconSize = 20 * camera.zoom; // Adjust size as needed
        const iconX = screenPos.x + size - iconSize / 2; // Position to the right of the node
        const iconY = screenPos.y - size + iconSize / 2; // Position to the top of the node

        ctx.drawImage(linkIcon, iconX - iconSize / 2, iconY - iconSize / 2, iconSize, iconSize);

        // Store icon bounds for click detection (absolute screen coordinates)
        node.urlIconBounds = {
            x: iconX - iconSize / 2,
            y: iconY - iconSize / 2,
            width: iconSize,
            height: iconSize
        };
    } else {
        node.urlIconBounds = null; // Clear bounds if no URL
    }

    
}function drawConnections() {
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

                // Check if Ctrl/Cmd is pressed and node has a URL
                if ((e.ctrlKey || e.metaKey) && node.url) {
                    window.open(node.url, '_blank');
                    return; // Prevent dragging if opening URL
                }

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
    if (!selectedNode) { // Only create a new node if no node is currently selected
        const worldPos = screenToWorld(e.clientX, e.clientY);
        nodes.push({
            x: worldPos.x,
            y: worldPos.y,
            text: 'Father Node',
            type: 'father',
            shape: 'circle',
            color: NODE_COLOR,
            url: null
        });
        selectedNode = nodes[nodes.length - 1];
        textEditing = true;
        draw();
        saveState();
    }
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        nodes = [];
        connections = [];
        selectedNode = null;
        draggingNode = null;
        panning = false;
        drawingConnection = false;
        connectionStartNode = null;
        textEditing = false;
        // Re-initialize the single father node in the center
        nodes.push({
            x: 0,
            y: 0,
            text: 'Father Node',
            type: 'father',
            shape: 'circle',
            color: NODE_COLOR
        });
        draw();
        saveState();
        return; // Stop further execution
    }

    if (e.key === 'Tab' && selectedNode) {
        e.preventDefault(); // Prevent default tab behavior
        const parentNode = selectedNode;
        const newNode = {
            x: parentNode.x + NODE_RADIUS * 2.5,
            y: parentNode.y,
            text: 'Child Node',
            type: 'child',
            shape: 'square',
            color: '#8BC34A', // Green
            url: null
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

    if (e.key === 'Enter' && selectedNode) {
        e.preventDefault(); // Prevent default Enter behavior (e.g., new line in input fields)
        textEditing = false; // Always stop text editing on Enter
        
        // Create sibling node logic
        const parentConnection = connections.find(c => nodes[c[1]] === selectedNode);
        if (parentConnection) {
            const parentNode = nodes[parentConnection[0]];
            const newNode = {
                x: selectedNode.x,
                y: selectedNode.y + NODE_RADIUS * 1.5,
                text: 'Child Node',
                type: 'child',
                shape: 'square',
                color: '#8BC34A', // Green
                url: null
            };
            nodes.push(newNode);
            const parentIndex = nodes.indexOf(parentNode);
            const newIndex = nodes.length - 1;
            connections.push([parentIndex, newIndex]);
            selectedNode = newNode; // Select the new node
            textEditing = true; // Start editing the new node
            saveState();
        }
        draw();
        return; // Stop further execution
    }

    // General text editing logic for selected node
    if (selectedNode && textEditing) {
        if (e.key === 'Backspace') {
            selectedNode.text = selectedNode.text.slice(0, -1);
        } else if (e.key.length === 1 && !(e.ctrlKey || e.metaKey)) { // Only append single character keys if Ctrl/Cmd is not pressed
            selectedNode.text += e.key;
        }
        draw();
    } else if (selectedNode && e.key.length === 1 && !(e.ctrlKey || e.metaKey)) { // Start text editing if a character key is pressed on a selected node and Ctrl/Cmd is not pressed
        selectedNode.text = e.key;
        textEditing = true;
        draw();
    }

    });

function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (e) {
        return false;
    }
}

window.addEventListener('paste', (e) => {
    if (selectedNode) {
        const clipboardText = e.clipboardData.getData('text');
        if (isValidUrl(clipboardText)) {
            selectedNode.url = clipboardText;
            draw();
            saveState();
        }
    }
});

function saveMap() {
    const data = {
        nodes: nodes,
        connections: connections,
        camera: camera
    };
    const json = JSON.stringify(data, null, 4);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mindmap.dimap';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function loadMap() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.dimap';
    input.onchange = e => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = event => {
                try {
                    const loadedData = JSON.parse(event.target.result);
                    nodes = loadedData.nodes || [];
                    connections = loadedData.connections || [];
                    camera = loadedData.camera || { x: 0, y: 0, zoom: 1 };
                    draw();
                    saveState(); // Save to local storage after loading
                } catch (error) {
                    console.error('Error parsing mind map file:', error);
                    alert('Error loading mind map: Invalid file format.');
                }
            };
            reader.readAsText(file);
        }
    };
    input.click();
}

// Attach event listeners to buttons
document.getElementById('save-button').addEventListener('click', saveMap);
document.getElementById('load-button').addEventListener('click', loadMap);

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
        nodes = state.nodes.map(node => ({ ...node, url: node.url || null })) || [];
        connections = state.connections || [];
        camera = state.camera || { x: 0, y: 0, zoom: 1 };
    }

    // If no nodes are loaded, create a default father node in the center
    if (nodes.length === 0) {
        nodes.push({
            x: 0,
            y: 0,
            text: 'Father Node',
            type: 'father',
            shape: 'circle',
            color: NODE_COLOR
        });
    }
}

loadState();
draw();
