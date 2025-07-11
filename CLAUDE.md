# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a client-side JavaScript mind mapping application that allows users to create, edit, and visualize hierarchical mind maps. The application runs entirely in the browser with no backend dependencies.

## Architecture

### Core Components
- **index.html** - Main HTML structure with canvas element for rendering
- **script.js** - Main application logic (~1152 lines)
- **style.css** - Styling for the interface
- **help.html** - Help documentation popup

### Key Features
- Canvas-based rendering using HTML5 Canvas API
- Node-based mind mapping with drag-and-drop functionality
- Hierarchical structure with parent-child relationships
- Real-time text editing with visual cursor
- Image paste and display capabilities
- Undo/redo functionality with history management
- Local storage persistence
- Save/load functionality with .dimap file format

## Core Data Structures

### Node Object
```javascript
{
    x: number,           // World coordinates
    y: number,
    text: string,        // Node content
    type: 'father'|'child',  // Node hierarchy type
    shape: 'circle'|'square', // Visual representation
    color: string,       // Hex color code
    radius: number,      // Node size
    url: string,         // Optional URL link
    folded: boolean,     // Collapse state
    image: Image,        // Attached image object
    imageDataURL: string, // Image data for persistence
    imageScale: number   // Image scaling factor
}
```

### Global State
- `nodes[]` - Array of all nodes
- `connections[]` - Array of [parentIndex, childIndex] pairs
- `camera` - Viewport with x, y, zoom properties
- `history[]` - State snapshots for undo/redo

## Key Keyboard Shortcuts

- **Tab** - Create child node
- **Enter** - Create sibling node
- **Delete** - Delete node and descendants
- **Ctrl+Delete** - Delete attached image
- **\\** - Toggle node folding
- **+/-** - Resize node
- **Ctrl++/Ctrl+-** - Scale attached image
- **Ctrl+Shift+Click** - Open color picker
- **Ctrl+Z/Ctrl+Y** - Undo/Redo
- **Escape** - Clear map and reload

## Development Notes

### Coordinate System
- Uses world coordinates for node positions
- Screen coordinates for rendering via `worldToScreen()` and `screenToWorld()`
- Camera system with pan and zoom capabilities

### State Management
- Automatic state saving to localStorage on modifications
- History stack with 10-level undo/redo
- State persistence includes node data but excludes Image objects

### Rendering Pipeline
1. Clear canvas
2. Draw connections between visible nodes
3. Draw nodes with text wrapping and dynamic sizing
4. Handle cursor blinking during text editing

### Node Visibility
- Implements folding/unfolding with `isNodeVisible()` function
- Hidden nodes are descendants of folded parents

## File Operations

- **Save**: Exports to .dimap JSON format
- **Load**: Imports from .dimap files with validation
- **Auto-save**: Continuous localStorage persistence

## Common Development Tasks

When modifying this codebase:
1. Test node creation, editing, and deletion
2. Verify drag-and-drop functionality
3. Test image paste and scaling
4. Validate save/load operations
5. Check undo/redo functionality
6. Test keyboard shortcuts
7. Verify rendering at different zoom levels