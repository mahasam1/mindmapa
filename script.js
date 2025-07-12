/*
 * Mind Mapping Application
 * Copyright (c) 2025 Dima Chulkin (https://www.linkedin.com/in/chulkin/)
 * Licensed under the MIT License - see LICENSE file for details
 */

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
let trackpadPanning = false;
let lastMousePos = { x: 0, y: 0 };
let lastTouchPos = { x: 0, y: 0 };
let drawingConnection = false;
let connectionStartNode = null;
let textEditing = false;
let isFirstKeyAfterSelection = false; // New flag for text editing
let cursorBlinkInterval = null;
let cursorVisible = true;
let backgroundColor = '#ffffff'; // Default white background
let changingBackgroundColor = false; // Flag to track if we're changing background color

const MAX_HISTORY_SIZE = 10; // Store last 10 actions
let history = [];
let historyPointer = -1;

const NODE_RADIUS = 60; // Base radius for new nodes
const MIN_NODE_RADIUS = 30;
const MAX_NODE_RADIUS = 120;
const NODE_COLOR = '#ffffff'; // White for father nodes
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
    // First split by newlines to handle explicit line breaks
    const paragraphs = text.split('\n');
    const lines = [];
    
    paragraphs.forEach(paragraph => {
        if (paragraph === '') {
            // Handle empty lines (just newlines)
            lines.push('');
            return;
        }
        
        const words = paragraph.split(' ');
        let line = '';

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
    });
    
    return lines;
}

const linkIcon = new Image();
linkIcon.src = 'icons/link-8564589_640.png';

function drawNode(node) {
    const screenPos = worldToScreen(node.x, node.y);
    let currentRadius = node.radius; // Use node's specific radius
    let nodeWidth, nodeHeight; // For child nodes (rectangles)

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

    // Calculate dimensions based on node type
    if (node.type === 'child') {
        // For child nodes, calculate optimal rectangle dimensions relative to father node
        const nodeScale = (node.radius || NODE_RADIUS) / NODE_RADIUS; // Use node's radius as a scale factor
        const fatherNodeSize = NODE_RADIUS * 2 * camera.zoom * nodeScale; // Father node diameter with zoom and scale
        const minWidth = fatherNodeSize / 1.3; // 1.3 times smaller than father node
        const padding = 8 * camera.zoom * nodeScale; // Reduced padding for compact design with scale
        
        const textWidth = longestWordWidth + padding;
        nodeWidth = Math.max(textWidth, minWidth);
        
        // Height will be calculated after we know the text layout
        const size = Math.max(nodeWidth, fatherNodeSize / 2) / 2; // For compatibility
    } else {
        // For father nodes and circles, use existing logic
        const requiredWidthForLongestWord = longestWordWidth / 0.8; // 80% of node width for text
        const requiredRadiusForLongestWord = requiredWidthForLongestWord / (2 * camera.zoom);

        // Adjust currentRadius if a single word is too long
        if (requiredRadiusForLongestWord > currentRadius) {
            currentRadius = requiredRadiusForLongestWord;
        }
    }

    const size = currentRadius * camera.zoom; // Final size for drawing (used for circles and compatibility)

    if (node === selectedNode) {
        ctx.shadowBlur = 25; // Increased blur for a stronger glow
        ctx.shadowColor = 'rgba(0, 255, 0, 0.8)'; // Green glow
    } else {
        ctx.shadowBlur = 0;
    }

    // Only draw shape if it's not a text-only object
    if (node.shape !== 'none') {
        // Determine fill color based on node type
        let fillColor = node.color;

        ctx.fillStyle = fillColor; // Always use the node's actual color for fill

        const borderRadius = 10; // Radius for rounded corners

        ctx.beginPath();
        if (node.type === 'child') {
            // Child nodes are drawn as rectangles with optimal dimensions
            const rectWidth = nodeWidth;
            const rectHeight = nodeHeight || (NODE_RADIUS * 2 * camera.zoom) / 2; // Default height
            ctx.roundRect(screenPos.x - rectWidth/2, screenPos.y - rectHeight/2, rectWidth, rectHeight, 8);
        } else if (node.shape === 'square') {
            // Draw a rounded rectangle (for non-child square nodes)
            ctx.roundRect(screenPos.x - size, screenPos.y - size, size * 2, size * 2, borderRadius);
        } else { // Default to circle
            ctx.arc(screenPos.x, screenPos.y, size, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.shadowBlur = 0; // Reset shadow for other elements
        ctx.strokeStyle = LINE_COLOR; // Use updated LINE_COLOR
        ctx.stroke();
    }

    // Draw text with wrapping and dynamic font size
    let fontSize, maxTextWidth, maxTextHeight, textHeight;
    let lines = [];
    const minFontSize = 8; // Minimum readable font size

    if (node.type === 'text') {
        // For text objects, use fixed fontSize and no size constraints
        fontSize = (node.fontSize || 16) * camera.zoom;
        maxTextWidth = canvas.width; // Allow text to be as wide as needed
        maxTextHeight = canvas.height; // Allow text to be as tall as needed
        ctx.font = `${fontSize}px Inter`;
        lines = wrapText(ctx, node.text, maxTextWidth);
        textHeight = lines.length * fontSize * 1.2; // 1.2 for line spacing
    } else if (node.type === 'child') {
        // For child nodes (rectangles), optimize for text content with relative sizing
        const nodeScale = (node.radius || NODE_RADIUS) / NODE_RADIUS; // Use node's radius as a scale factor
        const fatherNodeSize = NODE_RADIUS * 2 * camera.zoom * nodeScale; // Father node diameter with zoom and scale
        const minHeight = fatherNodeSize / 2; // Half the height of father node
        
        fontSize = 12 * camera.zoom * nodeScale; // Compact font for child nodes with scale
        maxTextWidth = nodeWidth * 0.9; // 90% of rectangle width for text
        
        ctx.font = `${fontSize}px Inter`;
        lines = wrapText(ctx, node.text, maxTextWidth);
        textHeight = lines.length * fontSize * 1.2; // 1.2 for line spacing
        
        // Calculate optimal rectangle height based on text with relative minimum
        const textPadding = 6 * camera.zoom * nodeScale; // Reduced padding with scale
        nodeHeight = Math.max(textHeight + textPadding, minHeight); // Use relative minimum height
        
        // Redraw the rectangle now that we know the proper height
        if (node.shape !== 'none') {
            ctx.fillStyle = node.color;
            ctx.beginPath();
            ctx.roundRect(screenPos.x - nodeWidth/2, screenPos.y - nodeHeight/2, nodeWidth, nodeHeight, 8);
            ctx.fill();
            ctx.strokeStyle = LINE_COLOR;
            ctx.stroke();
        }
    } else {
        // For regular nodes (circles/squares), use the existing size-constrained approach
        maxTextWidth = (size * 2) * 0.8; // 80% of node width for text
        maxTextHeight = (size * 2) * 0.8; // 80% of node height for text
        fontSize = 16 * camera.zoom;

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
    }

    if (fontSize >= minFontSize) {
        // Apply glow to text for text objects when selected
        if (node === selectedNode && node.shape === 'none') {
            ctx.shadowBlur = 25;
            ctx.shadowColor = 'rgba(0, 255, 0, 0.8)';
        }
        
        // Use node's color for text objects, otherwise use default TEXT_COLOR
        ctx.fillStyle = node.type === 'text' ? node.color : TEXT_COLOR;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let yOffset = screenPos.y - (textHeight / 2) + (fontSize * 0.6); // Adjust for vertical centering
        lines.forEach(line => {
            ctx.fillText(line, screenPos.x, yOffset);
            yOffset += fontSize * 1.2;
        });
        
        // Reset shadow after text rendering
        ctx.shadowBlur = 0;

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
        const iconSize = 20 * camera.zoom;
        let iconX, iconY;
        
        if (node.type === 'text') {
            // For text objects, position icon to the right of the text
            const textWidth = lines.length > 0 ? Math.max(...lines.map(line => ctx.measureText(line).width)) : 0;
            iconX = screenPos.x + textWidth / 2 + iconSize;
            iconY = screenPos.y - textHeight / 2;
        } else {
            // For regular nodes, use the original positioning
            iconX = screenPos.x + size - iconSize / 2;
            iconY = screenPos.y - size + iconSize / 2;
        }

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
        let imageTopY;
        
        if (node.type === 'text') {
            // For text objects, position image above the text
            imageTopY = screenPos.y - textHeight / 2 - imgHeight - (5 * camera.zoom);
        } else {
            // For regular nodes, use the original positioning
            imageTopY = screenPos.y - size - imgHeight - (5 * camera.zoom);
        }
        
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
    ctx.lineWidth = Math.max(1, 2 * camera.zoom); // Ensure minimum line width of 1 pixel
    connections.forEach(([startIdx, endIdx]) => {
        if (nodes[startIdx] && nodes[endIdx] && isNodeVisible(nodes[startIdx]) && isNodeVisible(nodes[endIdx])) {
            // Skip drawing connections to or from text objects (make them invisible)
            if (nodes[endIdx].type === 'text' || nodes[startIdx].type === 'text') {
                return;
            }
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
    // Fill background with chosen color
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
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
        const isClicked = isPointInNode(worldPos.x, worldPos.y, node);
        if (isClicked) {
            clickedOnNode = true;
            if (e.button === 0) { // Left click
                selectedNode = node;
                updateContextHelp();
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
        updateContextHelp();
        textEditing = false;
        // Enable panning with any mouse button on empty map
        panning = true;
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

    } else if (panning || trackpadPanning) {
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
            return isPointInNode(worldPos.x, worldPos.y, node);
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

            if (isPointInNode(worldPos.x, worldPos.y, node)) {
                dropTargetNode = node;
                break;
            }
        }

        if (dropTargetNode) {
            const draggingNodeIndex = nodes.indexOf(draggingNode);
            const dropTargetNodeIndex = nodes.indexOf(dropTargetNode);

            // Prevent reparenting if target is a descendant of the dragged node or if target is a text object
            if (!isDescendant(draggingNode, dropTargetNode) && dropTargetNode.type !== 'text') {
                // Remove existing parent connection for draggingNode
                connections = connections.filter(conn => conn[1] !== draggingNodeIndex);

                // Add new connection from dropTargetNode to draggingNode
                connections.push([dropTargetNodeIndex, draggingNodeIndex]);

                // Ensure the reparented node is a 'child' type and inherits color from new parent
                // But preserve text objects as text objects and don't force color inheritance
                if (draggingNode.type !== 'text') {
                    draggingNode.type = 'child';
                    updateNodeAndChildrenColor(draggingNode, dropTargetNode.color);
                }
                // Text objects keep their type and color when reparented
            }
        }
    }

    // Check for horizontal mirroring after drag is complete
    if (draggingNode && draggedDescendantOffsets.size > 0) {
        // Find the parent of the dragged node
        const draggingNodeIndex = nodes.indexOf(draggingNode);
        const parentConnection = connections.find(c => c[1] === draggingNodeIndex);
        
        if (parentConnection) {
            const parentNode = nodes[parentConnection[0]];
            
            // Check if the node crossed to the opposite side of its parent
            const wasOnRightSide = draggingNodeInitialPos.x >= parentNode.x;
            const isOnRightSide = draggingNode.x >= parentNode.x;
            
            // If the node crossed sides, mirror all its children horizontally
            if (wasOnRightSide !== isOnRightSide) {
                const descendants = getAllDescendants(draggingNode);
                descendants.forEach(descendant => {
                    // Mirror the child position relative to the dragged node
                    const dx = descendant.x - draggingNode.x;
                    descendant.x = draggingNode.x - dx; // Mirror horizontally
                });
            }
        }
    }

    draggingNode = null;
    panning = false;
    trackpadPanning = false;
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

function getNodeDimensions(node) {
    if (node.type === 'child') {
        // For child nodes, calculate rectangle dimensions relative to father node
        const nodeScale = (node.radius || NODE_RADIUS) / NODE_RADIUS; // Use node's radius as a scale factor
        const fatherNodeSize = NODE_RADIUS * 2 * nodeScale; // Father node diameter with scale
        const minWidth = fatherNodeSize / 1.3; // 1.3 times smaller than father node
        const minHeight = fatherNodeSize / 2; // Half the height of father node
        
        const padding = 8 * nodeScale; // Reduced padding for more compact design with scale
        
        // Estimate text width (simplified)
        const avgCharWidth = 7 * nodeScale; // Approximate character width with scale
        const textWidth = node.text.length * avgCharWidth + padding;
        const width = Math.max(textWidth, minWidth);
        
        // Estimate text height
        const lineHeight = 14 * nodeScale;
        const lines = Math.ceil(node.text.length / (width / avgCharWidth));
        const height = Math.max(lines * lineHeight + padding, minHeight);
        
        return { width, height, isRect: true };
    } else {
        // For circular nodes
        const radius = node.radius || NODE_RADIUS;
        return { width: radius * 2, height: radius * 2, radius, isRect: false };
    }
}

function isPointInNode(x, y, node) {
    if (node.type === 'child') {
        // For child nodes (rectangles)
        const dims = getNodeDimensions(node);
        const dx = Math.abs(x - node.x);
        const dy = Math.abs(y - node.y);
        return dx <= dims.width / 2 && dy <= dims.height / 2;
    } else {
        // For circular nodes
        const dx = x - node.x;
        const dy = y - node.y;
        const radius = node.radius || NODE_RADIUS;
        return dx * dx + dy * dy < radius * radius;
    }
}

function checkNodeCollision(x1, y1, node1Dims, x2, y2, node2Dims) {
    if (node1Dims.isRect && node2Dims.isRect) {
        // Rectangle to rectangle collision
        const dx = Math.abs(x1 - x2);
        const dy = Math.abs(y1 - y2);
        return dx < (node1Dims.width + node2Dims.width) / 2 && 
               dy < (node1Dims.height + node2Dims.height) / 2;
    } else if (!node1Dims.isRect && !node2Dims.isRect) {
        // Circle to circle collision
        const dx = x1 - x2;
        const dy = y1 - y2;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance < node1Dims.radius + node2Dims.radius;
    } else {
        // Circle to rectangle collision (approximate as circle to circle for simplicity)
        const dx = x1 - x2;
        const dy = y1 - y2;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const r1 = node1Dims.radius || Math.max(node1Dims.width, node1Dims.height) / 2;
        const r2 = node2Dims.radius || Math.max(node2Dims.width, node2Dims.height) / 2;
        return distance < r1 + r2;
    }
}

function checkCollisionNew(newNodeX, newNodeY, newNodeRadius, newNodeType = 'father') {
    const newNodeDims = newNodeType === 'child' ? 
        { 
            width: (NODE_RADIUS * 2) / 1.3, // 1.3 times smaller than father node
            height: (NODE_RADIUS * 2) / 2,  // Half the height of father node
            isRect: true 
        } : 
        { radius: newNodeRadius, width: newNodeRadius * 2, height: newNodeRadius * 2, isRect: false };
    
    for (const existingNode of nodes) {
        const existingNodeDims = getNodeDimensions(existingNode);
        
        if (checkNodeCollision(newNodeX, newNodeY, newNodeDims, existingNode.x, existingNode.y, existingNodeDims)) {
            return true; // Collision detected
        }
    }
    return false; // No collision
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

// Two-finger trackpad gesture support for Mac
canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
        e.preventDefault();
        trackpadPanning = true;
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        lastTouchPos = {
            x: (touch1.clientX + touch2.clientX) / 2,
            y: (touch1.clientY + touch2.clientY) / 2
        };
        // Also clear any node selection to prevent interference
        selectedNode = null;
        updateContextHelp();
        textEditing = false;
    }
});

canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && trackpadPanning) {
        e.preventDefault();
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const currentTouchPos = {
            x: (touch1.clientX + touch2.clientX) / 2,
            y: (touch1.clientY + touch2.clientY) / 2
        };
        
        const dx = currentTouchPos.x - lastTouchPos.x;
        const dy = currentTouchPos.y - lastTouchPos.y;
        camera.x -= dx / camera.zoom;
        camera.y -= dy / camera.zoom;
        
        lastTouchPos = currentTouchPos;
        draw();
    }
});

canvas.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
        trackpadPanning = false;
    }
});

canvas.addEventListener('touchcancel', (e) => {
    trackpadPanning = false;
});

canvas.addEventListener('dblclick', (e) => {
    const worldPos = screenToWorld(e.clientX, e.clientY);
    
    // Create a text object (no shape, text only)
    nodes.push({
        x: worldPos.x,
        y: worldPos.y,
        text: '',
        type: 'text',
        shape: 'none',
        color: TEXT_COLOR,
        radius: NODE_RADIUS, // Keep for compatibility but not used for text size
        fontSize: 16, // New property for text objects
        url: null,
        folded: false, // New property for folding/unfolding
        image: null, // Will store the actual Image object
        imageDataURL: null, // Will store the Data URL string for saving
        imageScale: 1.0 // New property for image scaling
    });
    selectedNode = nodes[nodes.length - 1];
    updateContextHelp();
    textEditing = true;
    isFirstKeyAfterSelection = true;
    draw();
    saveState();
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
            color: '#ffffff', // White color for initial father node
            radius: NODE_RADIUS, // Add radius property
            url: null,
            folded: false, // New property for folding/unfolding
            image: null, // Will store the actual Image object
            imageDataURL: null, // Will store the Data URL string for saving
            imageScale: 1.0 // New property for image scaling
        });
        // Center camera on the father node
        camera.x = 0;
        camera.y = 0;
        camera.zoom = 1;
        draw();
        saveState(); // Save state after clearing and re-initializing
        location.reload(); // Auto-refresh the page
        return; // Stop further execution
    }

    if (e.key === 'Tab' && selectedNode && selectedNode.type !== 'text') {
        e.preventDefault(); // Prevent default tab behavior
        
        // If selected node has empty text, give it default text
        if (selectedNode.text === '') {
            selectedNode.text = selectedNode.type === 'father' ? 'Father Node' : 'Child Node';
            draw();
            saveState();
            return;
        }
        
        const parentNode = selectedNode;
        let newX = parentNode.x + NODE_RADIUS * 2.5;
        let newY = parentNode.y - NODE_RADIUS * 0.75; // Position slightly above parent to leave space for siblings

        // Adjust position to avoid overlap
        let attempts = 0;
        const maxAttempts = 100; // Prevent infinite loops
        const shiftAmount = NODE_RADIUS * 1.5; // Amount to shift if collision occurs

        while (checkCollisionNew(newX, newY, NODE_RADIUS, 'child') && attempts < maxAttempts) {
            newY += shiftAmount;
            attempts++;
        }

        const newNode = {
            x: newX,
            y: newY,
            text: '',
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
        updateContextHelp();
        textEditing = true;
        isFirstKeyAfterSelection = true;
        draw();
        saveState();
        return; // Stop further execution
    }

    if (e.key === 'Enter' && selectedNode) {
        // Handle SHIFT+ENTER for new lines during text editing
        if (e.shiftKey && textEditing) {
            e.preventDefault();
            selectedNode.text += '\n';
            draw();
            return;
        }
        
        e.preventDefault(); // Prevent default Enter behavior (e.g., new line in input fields)
        textEditing = false; // Always stop text editing on Enter
        
        // If selected node has empty text, give it default text
        if (selectedNode.text === '') {
            if (selectedNode.type === 'text') {
                selectedNode.text = 'Text';
            } else {
                selectedNode.text = selectedNode.type === 'father' ? 'Father Node' : 'Child Node';
            }
            draw();
            saveState();
            return;
        }
        
        // Create sibling node logic
        const parentConnection = connections.find(c => nodes[c[1]] === selectedNode);
        if (parentConnection) {
            let newX = selectedNode.x;
            let newY = selectedNode.y + NODE_RADIUS * 1.5;

            // Adjust position to avoid overlap
            let attempts = 0;
            const maxAttempts = 100; // Prevent infinite loops
            const shiftAmount = NODE_RADIUS * 1.5; // Amount to shift if collision occurs

            while (checkCollisionNew(newX, newY, NODE_RADIUS, 'child') && attempts < maxAttempts) {
                newY += shiftAmount;
                attempts++;
            }

            const parentNode = nodes[parentConnection[0]];
            const newNode = {
                x: newX,
                y: newY,
                text: '',
                type: 'child',
                shape: 'square',
                color: selectedNode.color, // Inherit color from parent
                url: null,
                radius: NODE_RADIUS, // Add radius property
                shape: 'square', // Added shape property
                folded: false, // New property for folding/unfolding
                image: null, // Will store the actual Image object
                imageDataURL: null, // Will store the Data URL string for saving
                imageScale: 1.0 // New property for image scaling
            };
            nodes.push(newNode);
            const parentIndex = nodes.indexOf(parentNode);
            const newIndex = nodes.length - 1;
            connections.push([parentIndex, newIndex]);
            selectedNode = newNode; // Select the new node
            updateContextHelp();
            textEditing = true; // Start editing the new node
            isFirstKeyAfterSelection = true;
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
        updateContextHelp();
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
        if (selectedNode.type === 'text') {
            // For text objects, change font size
            selectedNode.fontSize = Math.min(selectedNode.fontSize + 2, 72);
        } else if (selectedNode.type === 'father' || selectedNode.type === 'child') {
            // For father and child nodes, change radius
            selectedNode.radius = Math.min(selectedNode.radius + 5, MAX_NODE_RADIUS);
        }
        draw();
        saveState();
        return;
    }

    if (selectedNode && e.key === '-') {
        e.preventDefault();
        if (selectedNode.type === 'text') {
            // For text objects, change font size
            selectedNode.fontSize = Math.max(selectedNode.fontSize - 2, 8);
        } else if (selectedNode.type === 'father' || selectedNode.type === 'child') {
            // For father and child nodes, change radius
            selectedNode.radius = Math.max(selectedNode.radius - 5, MIN_NODE_RADIUS);
        }
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

    if (e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        const colorPicker = document.getElementById('color-picker');
        if (selectedNode) {
            // Change node color
            changingBackgroundColor = false;
            colorPicker.value = selectedNode.color || (selectedNode.type === 'text' ? TEXT_COLOR : NODE_COLOR);
        } else {
            // Change background color
            changingBackgroundColor = true;
            colorPicker.value = backgroundColor;
        }
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
        
        // If text object is empty when editing stops, give it default text
        if (selectedNode && selectedNode.type === 'text' && selectedNode.text === '') {
            selectedNode.text = 'Text';
        }
        
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
        } else if (selectedNode.type !== 'text') {
            // Paste text as child nodes (only if parent is not a text object)
            const paragraphs = clipboardText.split(/\n\s*\n/);
            let lastPastedNode = null; // Keep track of the last node created in this paste operation
            const parentNode = selectedNode;
            const firstRootNode = nodes[0]; // The very first node of the map

            // Determine the horizontal direction for all new nodes from this paste
            // Place nodes on the opposite side of the first father node
            // If there's only one node, default to right side
            const placeOnRight = nodes.length === 1 ? true : parentNode.x > firstRootNode.x;
            const initialX = placeOnRight ? parentNode.x + NODE_RADIUS * 2.5 : parentNode.x - NODE_RADIUS * 2.5;

            paragraphs.forEach((paragraph, index) => {
                if (paragraph.trim() !== '') {
                    let newX = initialX;
                    // The first new node is positioned relative to the parent, subsequent nodes are positioned relative to the previously pasted one.
                    let newY = (lastPastedNode === null) ? parentNode.y : lastPastedNode.y + NODE_RADIUS * 1.5;

                    // Adjust position to avoid overlap
                    let attempts = 0;
                    const maxAttempts = 100; // Prevent infinite loops
                    const shiftAmount = NODE_RADIUS * 1.5; // Amount to shift if collision occurs

                    while (checkCollisionNew(newX, newY, NODE_RADIUS, 'child') && attempts < maxAttempts) {
                        newY += shiftAmount;
                        attempts++;
                    }

                    const newNode = {
                        x: newX,
                        y: newY,
                        text: paragraph.trim(),
                        type: 'child',
                        shape: 'square',
                        color: parentNode.color, // Inherit color from parent
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
                    lastPastedNode = newNode; // Update the last pasted node
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
        camera: camera,
        backgroundColor: backgroundColor
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
        camera: camera,
        backgroundColor: backgroundColor
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
        backgroundColor = state.backgroundColor || '#ffffff'; // Default to white if not set
        selectedNode = null; // Clear selected node on undo/redo
        updateContextHelp();

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
                    backgroundColor = loadedData.backgroundColor || '#ffffff'; // Default to white if not set
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
    const newColor = e.target.value;
    
    if (changingBackgroundColor) {
        // Change background color
        backgroundColor = newColor;
        changingBackgroundColor = false;
        draw();
        saveState();
    } else if (selectedNode) {
        // Change node color
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
        // Don't automatically change color of text object children - let them keep their own colors
        if (childNode && childNode.type !== 'text') {
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
                fontSize: node.fontSize || 16, // Default fontSize for text objects
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
                    newNode.image = null;
                    newNode.imageDataURL = null;
                    draw();
                };
            }
            return newNode;
        }) || [];
        connections = state.connections || [];
        camera = state.camera || { x: 0, y: 0, zoom: 1 };
        backgroundColor = state.backgroundColor || '#ffffff'; // Default to white if not set
    }

    // If no nodes are loaded, create a default father node in the center
    if (nodes.length === 0) {
        nodes.push({
            x: 0,
            y: 0,
            text: 'Father Node',
            type: 'father',
            shape: 'circle',
            color: '#ffffff', // White color for initial father node
            radius: NODE_RADIUS,
            url: null,
            folded: false,
            image: null,
            imageDataURL: null,
            imageScale: 1.0
        });
    }
}

function updateContextHelp() {
    const contextHelp = document.getElementById('context-help-content');
    
    if (!selectedNode) {
        // No node selected - show map controls
        contextHelp.innerHTML = `
            <div class="help-title">Map Controls</div>
            <div class="help-item"><span class="help-key">Wheel:</span> Zoom</div>
            <div class="help-item"><span class="help-key">Drag:</span> Pan map</div>
            <div class="help-item"><span class="help-key">Two-finger:</span> Pan (Mac)</div>
            <div class="help-item"><span class="help-key">Click:</span> Select node</div>
            <div class="help-item"><span class="help-key">Double-click:</span> Create text</div>
            <div class="help-item"><span class="help-key">Ctrl+Shift:</span> Background color</div>
        `;
    } else if (selectedNode.type === 'text') {
        // Text object selected
        contextHelp.innerHTML = `
            <div class="help-title">Text Object</div>
            <div class="help-item"><span class="help-key">Type:</span> Edit text</div>
            <div class="help-item"><span class="help-key">+/-:</span> Font size</div>
            <div class="help-item"><span class="help-key">Ctrl+V:</span> Paste URL/image</div>
            <div class="help-item"><span class="help-key">Ctrl+Shift:</span> Color</div>
            <div class="help-item"><span class="help-key">Del:</span> Delete</div>
        `;
    } else {
        // Regular node selected
        contextHelp.innerHTML = `
            <div class="help-title">Node Controls</div>
            <div class="help-item"><span class="help-key">Type:</span> Edit text</div>
            <div class="help-item"><span class="help-key">Tab:</span> Child node</div>
            <div class="help-item"><span class="help-key">Enter:</span> Sibling node</div>
            <div class="help-item"><span class="help-key">+/-:</span> Size</div>
            <div class="help-item"><span class="help-key">\\:</span> Fold/unfold</div>
            <div class="help-item"><span class="help-key">Ctrl+Shift:</span> Color</div>
            <div class="help-item"><span class="help-key">Ctrl+V:</span> Paste</div>
            <div class="help-item"><span class="help-key">Del:</span> Delete</div>
        `;
    }
}

loadState();
saveState(); // Save initial state to history after loading
updateContextHelp(); // Initialize context help
draw();