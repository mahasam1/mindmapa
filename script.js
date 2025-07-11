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
let draggingNodeInitialPos = { x: 0, y: 0 };
let draggedDescendantOffsets = new Map(); // Stores {node: {dx, dy}} for descendants
let panning = false;
let lastMousePos = { x: 0, y: 0 };
let drawingConnection = false;
let connectionStartNode = null;
let textEditing = false;
let isFirstKeyAfterSelection = false; // New flag for text editing
let cursorBlinkInterval = null;
let cursorVisible = true;

const MAX_HISTORY_SIZE = 10; // Store last 10 actions
let history = [];
let historyPointer = -1;

const NODE_RADIUS = 60; // Base radius for new nodes
const MIN_NODE_RADIUS = 30;
const MAX_NODE_RADIUS = 120;
const NODE_COLOR = '#5c6bc0'; // Muted Indigo for father nodes
const NODE_SELECTED_COLOR = '#ffca28'; // This constant will no longer be used for fill, but kept for reference if needed elsewhere
const TEXT_COLOR = '#333333'; // Dark grey for text
const LINE_COLOR = '#757575'; // Slightly darker grey for lines

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
    let currentRadius = node.radius; // Use node's specific radius

    // Temporarily set font for initial text measurement
    ctx.font = `${16 * camera.zoom}px Inter`; // Use Inter font
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
        ctx.shadowBlur = 25; // Increased blur for a stronger glow
        ctx.shadowColor = 'rgba(0, 255, 0, 0.8)'; // Green glow
    } else {
        ctx.shadowBlur = 0;
    }

    // Determine fill color based on node type
    let fillColor = node.color;

    ctx.fillStyle = fillColor; // Always use the node's actual color for fill

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
    ctx.strokeStyle = LINE_COLOR; // Use updated LINE_COLOR
    ctx.stroke();

    // Draw text with wrapping and dynamic font size
    const maxTextWidth = (size * 2) * 0.8; // 80% of node width for text
    const maxTextHeight = (size * 2) * 0.8; // 80% of node height for text
    let fontSize = 16 * camera.zoom;
    let lines = [];
    const minFontSize = 8; // Minimum readable font size

    do {
        ctx.font = `${fontSize}px Inter`; // Use Inter font
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

        // Draw blinking cursor if text editing is active and cursor is visible
        if (node === selectedNode && textEditing && cursorVisible) {
            const lastLine = lines[lines.length - 1] || '';
            const lastLineWidth = ctx.measureText(lastLine).width;
            const cursorX = screenPos.x + lastLineWidth / 2 + 2; // Position after the last character
            const cursorY = yOffset - fontSize * 1.2; // Top of the last line
            const cursorHeight = fontSize;

            ctx.strokeStyle = TEXT_COLOR;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cursorX, cursorY);
            ctx.lineTo(cursorX, cursorY + cursorHeight);
            ctx.stroke();
        }
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

    // Draw attached image if exists
    if (node.image && node.image instanceof Image) {
        const img = node.image;
        const imgWidth = img.width * node.imageScale * camera.zoom;
        const imgHeight = img.height * node.imageScale * camera.zoom;
        const imageOffsetX = imgWidth / 2;
        // Position image: top edge 5px above node's top edge
        const imageTopY = screenPos.y - size - imgHeight - (5 * camera.zoom);
        ctx.drawImage(img, screenPos.x - imageOffsetX, imageTopY, imgWidth, imgHeight);
    }

    // Draw indicator for folded nodes with children
    if (node.folded && hasChildren(node)) {
        const indicatorSize = 10 * camera.zoom;
        const indicatorX = screenPos.x + size - indicatorSize / 2; // Position to the right of the node
        const indicatorY = screenPos.y + size - indicatorSize / 2; // Position to the bottom right of the node

        ctx.fillStyle = '#555555'; // Dark grey square
        ctx.fillRect(indicatorX - indicatorSize / 2, indicatorY - indicatorSize / 2, indicatorSize, indicatorSize);
    }
}

// Helper function to check if a node has children
function hasChildren(node) {
    const nodeIndex = nodes.indexOf(node);
    return connections.some(c => c[0] === nodeIndex);
}

function drawConnections() {
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 2 * camera.zoom;
    connections.forEach(([startIdx, endIdx]) => {
        if (nodes[startIdx] && nodes[endIdx] && isNodeVisible(nodes[startIdx]) && isNodeVisible(nodes[endIdx])) {
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
    drawConnections(); // Draw connections first
    nodes.forEach(node => {
        if (isNodeVisible(node)) {
            drawNode(node);
        }
    });
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
                draggingNodeInitialPos = { x: node.x, y: node.y };
                draggedDescendantOffsets.clear();

                // If the dragged node has children, calculate their offsets
                const descendants = getAllDescendants(draggingNode);
                descendants.forEach(descendant => {
                    draggedDescendantOffsets.set(descendant, {
                        dx: descendant.x - draggingNode.x,
                        dy: descendant.y - draggingNode.y
                    });
                });

                textEditing = false;
                isFirstKeyAfterSelection = true; // Set flag when node is selected

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
        const dx = worldPos.x - draggingNodeInitialPos.x;
        const dy = worldPos.y - draggingNodeInitialPos.y;

        draggingNode.x = worldPos.x;
        draggingNode.y = worldPos.y;

        // Move descendants with the dragging node
        draggedDescendantOffsets.forEach((offset, descendant) => {
            descendant.x = draggingNode.x + offset.dx;
            descendant.y = draggingNode.y + offset.dy;
        });

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
    } else if (draggingNode) { // Handle reparenting on left-click drag release
        const mousePos = { x: e.clientX, y: e.clientY };
        const worldPos = screenToWorld(mousePos.x, mousePos.y);
        let dropTargetNode = null;

        for (let i = nodes.length - 1; i >= 0; i--) {
            const node = nodes[i];
            if (node === draggingNode) continue; // Cannot reparent to self

            const dx = worldPos.x - node.x;
            const dy = worldPos.y - node.y;
            if (dx * dx + dy * dy < NODE_RADIUS * NODE_RADIUS) {
                dropTargetNode = node;
                break;
            }
        }

        if (dropTargetNode) {
            const draggingNodeIndex = nodes.indexOf(draggingNode);
            const dropTargetNodeIndex = nodes.indexOf(dropTargetNode);

            // Prevent reparenting if target is a descendant of the dragged node
            if (!isDescendant(draggingNode, dropTargetNode)) {
                // Remove existing parent connection for draggingNode
                connections = connections.filter(conn => conn[1] !== draggingNodeIndex);

                // Add new connection from dropTargetNode to draggingNode
                connections.push([dropTargetNodeIndex, draggingNodeIndex]);

                // Ensure the reparented node is a 'child' type and pink
                draggingNode.type = 'child';
                draggingNode.color = '#FF69B4';
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

// Helper function to check if a node is a descendant of another
function isDescendant(potentialParent, potentialChild) {
    const parentIndex = nodes.indexOf(potentialParent);
    const childIndex = nodes.indexOf(potentialChild);

    if (parentIndex === -1 || childIndex === -1) {
        return false; // One or both nodes not found
    }

    // Use a breadth-first search (BFS) to find all descendants of potentialParent
    const queue = [parentIndex];
    const visited = new Set();
    visited.add(parentIndex);

    let head = 0;
    while (head < queue.length) {
        const currentIdx = queue[head++];

        // If the current node is the potentialChild, then potentialChild is a descendant
        if (currentIdx === childIndex) {
            return true;
        }

        // Find children of the current node
        const childrenOfCurrent = connections.filter(c => c[0] === currentIdx).map(c => c[1]);
        for (const childIdx of childrenOfCurrent) {
            if (!visited.has(childIdx)) {
                visited.add(childIdx);
                queue.push(childIdx);
            }
        }
    }
    return false; // potentialChild is not a descendant
}

// New helper function to check if a node is visible (not part of a folded subtree)
function isNodeVisible(node) {
    if (!node) return false;
    let currentNode = node;
    while (currentNode) {
        const parentConnection = connections.find(c => nodes[c[1]] === currentNode);
        if (parentConnection) {
            const parentNode = nodes[parentConnection[0]];
            if (parentNode && parentNode.folded) {
                return false; // Parent is folded, so this node is not visible
            }
            currentNode = parentNode;
        } else {
            break; // No parent, reached the root of a subtree
        }
    }
    return true; // Node is visible
}

function getAllDescendants(node) {
    const descendants = new Set();
    const queue = [node];
    const visited = new Set();
    visited.add(node);

    let head = 0;
    while (head < queue.length) {
        const currentNode = queue[head++];
        const currentNodeIndex = nodes.indexOf(currentNode);

        const childrenOfCurrent = connections.filter(c => c[0] === currentNodeIndex).map(c => nodes[c[1]]);
        for (const childNode of childrenOfCurrent) {
            if (childNode && !visited.has(childNode)) {
                visited.add(childNode);
                descendants.add(childNode);
                queue.push(childNode);
            }
        }
    }
    return Array.from(descendants);
}

function checkCollision(newNodeX, newNodeY, newNodeRadius) {
    for (const existingNode of nodes) {
        // Calculate distance between centers
        const dx = newNodeX - existingNode.x;
        const dy = newNodeY - existingNode.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Sum of radii
        const sumOfRadii = newNodeRadius + existingNode.radius; 

        if (distance < sumOfRadii) {
            return true; // Collision detected
        }
    }
    return false; // No collision
}

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
            radius: NODE_RADIUS, // Add radius property
            url: null,
            folded: false, // New property for folding/unfolding
            image: null, // Will store the actual Image object
            imageDataURL: null, // Will store the Data URL string for saving
            imageScale: 1.0 // New property for image scaling
        });
        selectedNode = nodes[nodes.length - 1];
        textEditing = true;
        isFirstKeyAfterSelection = true;
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
            color: NODE_COLOR,
            radius: NODE_RADIUS, // Add radius property
            url: null,
            folded: false, // New property for folding/unfolding
            image: null, // Will store the actual Image object
            imageDataURL: null, // Will store the Data URL string for saving
            imageScale: 1.0 // New property for image scaling
        });
        draw();
        saveState(); // Save state after clearing and re-initializing
        location.reload(); // Auto-refresh the page
        return; // Stop further execution
    }

    if (e.key === 'Tab' && selectedNode) {
        e.preventDefault(); // Prevent default tab behavior
        const parentNode = selectedNode;
        let newX = parentNode.x + NODE_RADIUS * 2.5;
        let newY = parentNode.y;

        // Adjust position to avoid overlap
        let attempts = 0;
        const maxAttempts = 100; // Prevent infinite loops
        const shiftAmount = NODE_RADIUS * 1.5; // Amount to shift if collision occurs

        while (checkCollision(newX, newY, NODE_RADIUS) && attempts < maxAttempts) {
            newY += shiftAmount;
            attempts++;
        }

        const newNode = {
            x: newX,
            y: newY,
            text: 'Child Node',
            type: 'child',
            shape: 'square',
            color: selectedNode.color, // Inherit color from parent
            radius: NODE_RADIUS, // Add radius property
            url: null,
            folded: false, // New property for folding/unfolding
            image: null, // Will store the actual Image object
            imageDataURL: null, // Will store the Data URL string for saving
            imageScale: 1.0 // New property for image scaling
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
            let newX = selectedNode.x;
            let newY = selectedNode.y + NODE_RADIUS * 1.5;

            // Adjust position to avoid overlap
            let attempts = 0;
            const maxAttempts = 100; // Prevent infinite loops
            const shiftAmount = NODE_RADIUS * 1.5; // Amount to shift if collision occurs

            while (checkCollision(newX, newY, NODE_RADIUS) && attempts < maxAttempts) {
                newY += shiftAmount;
                attempts++;
            }

            const parentNode = nodes[parentConnection[0]];
            const newNode = {
                x: newX,
                y: newY,
                text: 'Child Node',
                type: 'child',
                shape: 'square',
                color: selectedNode.color, // Inherit color from parent
                url: null,
                radius: NODE_RADIUS, // Add radius property
                shape: 'square', // Added shape property
                folded: false // New property for folding/unfolding
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

    if (e.key === 'Delete' && selectedNode && e.ctrlKey) {
        e.preventDefault();
        if (selectedNode.image || selectedNode.imageDataURL) {
            selectedNode.image = null;
            selectedNode.imageDataURL = null;
            draw();
            saveState();
        }
        return;
    }

    if (e.key === 'Delete' && selectedNode) {
        e.preventDefault();
        const nodesToDelete = new Set();
        const queue = [selectedNode];
        nodesToDelete.add(selectedNode);

        // Find all descendants
        let head = 0;
        while(head < queue.length) {
            const currentNode = queue[head++];
            const currentNodeIndex = nodes.indexOf(currentNode);
            
            // Find children of the current node
            const childConnections = connections.filter(c => c[0] === currentNodeIndex);
            childConnections.forEach(conn => {
                const childNode = nodes[conn[1]];
                if (childNode && !nodesToDelete.has(childNode)) {
                    nodesToDelete.add(childNode);
                    queue.push(childNode);
                }
            });
        }

        // Filter out deleted nodes and update connections
        const newNodes = [];
        const oldIndexToNewIndexMap = new Map();
        let newIndex = 0;
        for (let i = 0; i < nodes.length; i++) {
            if (!nodesToDelete.has(nodes[i])) {
                newNodes.push(nodes[i]);
                oldIndexToNewIndexMap.set(i, newIndex++);
            }
        }

        const newConnections = [];
        connections.forEach(conn => {
            const [startIdx, endIdx] = conn;
            if (!nodesToDelete.has(nodes[startIdx]) && !nodesToDelete.has(nodes[endIdx])) {
                newConnections.push([oldIndexToNewIndexMap.get(startIdx), oldIndexToNewIndexMap.get(endIdx)]);
            }
        });

        nodes = newNodes;
        connections = newConnections;
        selectedNode = null;
        draw();
        saveState();
        return; // Stop further execution
    }

    if (selectedNode && (e.key === '+' || e.key === '=') && e.ctrlKey) {
        e.preventDefault();
        selectedNode.imageScale = Math.min(selectedNode.imageScale + 0.1, 3.0); // Increase image size
        draw();
        saveState();
        return;
    }

    if (selectedNode && e.key === '-' && e.ctrlKey) {
        e.preventDefault();
        selectedNode.imageScale = Math.max(selectedNode.imageScale - 0.1, 0.1); // Decrease image size
        draw();
        saveState();
        return;
    }

    if (selectedNode && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        selectedNode.radius = Math.min(selectedNode.radius + 5, MAX_NODE_RADIUS);
        draw();
        saveState();
        return;
    }

    if (selectedNode && e.key === '-') {
        e.preventDefault();
        selectedNode.radius = Math.max(selectedNode.radius - 5, MIN_NODE_RADIUS);
        draw();
        saveState();
        return;
    }

    if (e.key === '\\' && selectedNode) {
        e.preventDefault();
        selectedNode.folded = !selectedNode.folded;
        draw();
        saveState();
        return;
    }

    if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        undo();
        return;
    }

    if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        redo();
        return;
    }

    if (e.ctrlKey && e.shiftKey && selectedNode) {
        e.preventDefault();
        const colorPicker = document.getElementById('color-picker');
        colorPicker.value = selectedNode.color;
        colorPicker.click();
        return;
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
        if (isFirstKeyAfterSelection) {
            selectedNode.text = ''; // Clear text on first key press
            isFirstKeyAfterSelection = false;
        }
        selectedNode.text += e.key;
        textEditing = true;
        draw();
    }

    // Start/Stop cursor blinking
    if (textEditing && !cursorBlinkInterval) {
        cursorVisible = true;
        cursorBlinkInterval = setInterval(() => {
            cursorVisible = !cursorVisible;
            draw();
        }, 500);
    } else if (!textEditing && cursorBlinkInterval) {
        clearInterval(cursorBlinkInterval);
        cursorBlinkInterval = null;
        cursorVisible = true; // Ensure cursor is visible when not editing
        draw();
        saveState(); // Save state when text editing stops
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
        const items = e.clipboardData.items;

        // Check for image data
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();
                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.src = event.target.result;
                    img.onload = () => {
                        // Calculate initial imageScale to fit within node radius
                        const nodeDiameter = selectedNode.radius * 2;
                        const scale = nodeDiameter / Math.max(img.width, img.height);
                        selectedNode.imageScale = scale; // Fit within the node
                        selectedNode.image = img; // Store the actual Image object
                        selectedNode.imageDataURL = event.target.result; // Store Data URL for saving
                        draw();
                        saveState();
                    };
                };
                reader.readAsDataURL(blob);
                return; // Image found, stop processing
            }
        }

        // If no image, check for URL
        if (isValidUrl(clipboardText)) {
            selectedNode.url = clipboardText;
            draw();
            saveState();
        } else {
            // Paste text as child nodes
            const paragraphs = clipboardText.split(/\n\s*\n/);
            let lastNode = selectedNode;
            paragraphs.forEach(paragraph => {
                if (paragraph.trim() !== '') {
                    const parentNode = selectedNode;
                    let newX = lastNode.x;
                    let newY = lastNode.y + NODE_RADIUS * 1.5;

                    // Adjust position to avoid overlap
                    let attempts = 0;
                    const maxAttempts = 100; // Prevent infinite loops
                    const shiftAmount = NODE_RADIUS * 1.5; // Amount to shift if collision occurs

                    while (checkCollision(newX, newY, NODE_RADIUS) && attempts < maxAttempts) {
                        newY += shiftAmount;
                        attempts++;
                    }

                    const newNode = {
                        x: newX,
                        y: newY,
                        text: paragraph.trim(),
                        type: 'child',
                        shape: 'square',
                        color: selectedNode.color, // Inherit color from parent
                        radius: NODE_RADIUS, // Add radius property
                        url: null,
                        folded: false, // New property for folding/unfolding
                        image: null, // Will store the actual Image object
                        imageDataURL: null, // Will store the Data URL string for saving
                        imageScale: 1.0 // New property for image scaling
                    };
                    nodes.push(newNode);
                    const parentIndex = nodes.indexOf(parentNode);
                    const newIndex = nodes.length - 1;
                    connections.push([parentIndex, newIndex]);
                    lastNode = newNode;
                }
            });
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

function saveState() {
    const state = {
        nodes: nodes.map(node => ({
            ...node,
            image: undefined // Don't save the Image object directly
        })),
        connections: connections,
        camera: camera
    };
    localStorage.setItem('mindmap', JSON.stringify(state));

    // Save to history stack
    if (historyPointer < history.length - 1) {
        history = history.slice(0, historyPointer + 1);
    }
    history.push(JSON.parse(JSON.stringify(state))); // Deep copy
    if (history.length > MAX_HISTORY_SIZE) {
        history.shift();
    } else {
        historyPointer++;
    }
}

function loadStateFromHistory(index) {
    if (index >= 0 && index < history.length) {
        const state = history[index];
        let imagesToLoad = 0;
        let imagesLoaded = 0;

        const newNodes = state.nodes.map(node => {
            const newNode = {
                ...node,
                image: null, // Initialize image to null, will be loaded asynchronously
            };
            if (node.imageDataURL) {
                imagesToLoad++;
                const img = new Image();
                img.src = node.imageDataURL;
                img.onload = () => {
                    newNode.image = img;
                    imagesLoaded++;
                    if (imagesLoaded === imagesToLoad) {
                        // All images for this state are loaded, now draw
                        draw();
                    }
                };
                img.onerror = () => {
                    console.error("Error loading image for node:", newNode);
                    newNode.image = null;
                    newNode.imageDataURL = null;
                    imagesLoaded++; // Still count as loaded even if error
                    if (imagesLoaded === imagesToLoad) {
                        draw();
                    }
                };
            }
            return newNode;
        });

        nodes = newNodes; // Assign newNodes to global nodes array
        connections = state.connections;
        camera = state.camera;
        selectedNode = null; // Clear selected node on undo/redo

        // If no images to load, or all images are already loaded (e.g., from cache), draw immediately
        if (imagesToLoad === 0 || imagesLoaded === imagesToLoad) {
            draw();
        }

        localStorage.setItem('mindmap', JSON.stringify(state)); // Save current state to local storage after loading from history
    }
}

function undo() {
    if (historyPointer > 0) {
        historyPointer--;
        loadStateFromHistory(historyPointer);
    }
}

function redo() {
    if (historyPointer < history.length - 1) {
        historyPointer++;
        loadStateFromHistory(historyPointer);
    }
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
                    // Clear history when loading a new map
                    history = [];
                    historyPointer = -1;
                    saveState(); // Save the loaded state to history and local storage
                    draw();
                    location.reload(); // Auto-refresh the page
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
document.getElementById('help-button').addEventListener('click', () => {
    window.open('help.html', 'Mind Mapper Controls', 'width=800,height=600');
});

const colorPicker = document.getElementById('color-picker');

colorPicker.addEventListener('change', (e) => {
    if (selectedNode) {
        const newColor = e.target.value;
        selectedNode.color = newColor;
        updateNodeAndChildrenColor(selectedNode, newColor);
        draw();
        saveState();
    }
});

function updateNodeAndChildrenColor(node, newColor) {
    node.color = newColor;
    const nodeIndex = nodes.indexOf(node);
    const childrenConnections = connections.filter(c => c[0] === nodeIndex);
    childrenConnections.forEach(conn => {
        const childNode = nodes[conn[1]];
        if (childNode) {
            updateNodeAndChildrenColor(childNode, newColor);
        }
    });
}

canvas.addEventListener('contextmenu', e => e.preventDefault());

function loadState() {
    const state = JSON.parse(localStorage.getItem('mindmap'));
    if (state) {
        nodes = state.nodes.map(node => {
            const newNode = {
                ...node,
                url: node.url || null,
                radius: node.radius || NODE_RADIUS,
                folded: node.folded || false,
                image: null, // Initialize image to null, will be loaded asynchronously
                imageDataURL: node.imageDataURL || null, // Load the Data URL string
                imageScale: node.imageScale || 1.0
            };

            if (newNode.imageDataURL) {
                const img = new Image();
                img.src = newNode.imageDataURL;
                img.onload = () => {
                    newNode.image = img; // Store the loaded Image object
                    draw(); // Redraw after image loads
                };
                // Handle potential errors during image loading
                img.onerror = () => {
                    console.error("Error loading image for node:", newNode);
                    newNode.image = null; // Clear image if loading fails
                    newNode.imageDataURL = null;
                    draw();
                };
            }
            return newNode;
        }) || [];
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
            color: NODE_COLOR,
            radius: NODE_RADIUS,
            url: null,
            folded: false,
            image: null,
            imageDataURL: null,
            imageScale: 1.0
        });
    }
}

loadState();
saveState(); // Save initial state to history after loading
draw();