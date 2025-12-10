/**
 * Input System - Keyboard and Mouse handling with context-aware shortcuts
 *
 * This system manages:
 * - Keyboard shortcuts with context-awareness (like Blender)
 * - Mouse state tracking (position, dragging, button)
 * - Viewport focus tracking for context-aware shortcuts
 * - Continuous key state for camera movement
 */

import { ViewMode } from "../editor";

/**
 * Mouse state
 */
export interface MouseState {
  x: number;
  y: number;
  isDragging: boolean;
  button: number; // 0 = left, 1 = middle, 2 = right
}

/**
 * Keyboard shortcut definition
 */
export interface Shortcut {
  key: string; // lowercase key
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** If true, shortcut works even when pointer is outside viewport */
  global?: boolean;
  /** If true, shortcut works during active transforms */
  duringTransform?: boolean;
  /** Description for help/tooltips */
  description?: string;
}

/**
 * Shortcut handler function
 */
export type ShortcutHandler = (e: KeyboardEvent) => boolean;

/**
 * Registered shortcut with handler
 */
interface RegisteredShortcut {
  shortcut: Shortcut;
  handler: ShortcutHandler;
  priority: number;
}

/**
 * Input context - determines which shortcuts are active
 */
export type InputContext = "viewport" | "panel" | "global";

/**
 * Input manager options
 */
export interface InputManagerOptions {
  /** Called when viewport enter/leave changes */
  onViewportFocusChange?: (isOver: boolean) => void;
}

/**
 * Input Manager - centralizes all input handling
 */
export class InputManager {
  private shortcuts: RegisteredShortcut[] = [];
  private mouseState: MouseState = {
    x: 0,
    y: 0,
    isDragging: false,
    button: 0,
  };
  private isPointerOverViewport: boolean = false;
  private isTransformActive: boolean = false;
  private options: InputManagerOptions;

  // Event listeners (stored for cleanup)
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(options: InputManagerOptions = {}) {
    this.options = options;
  }

  /**
   * Initialize keyboard listeners
   */
  init(): void {
    this.keydownHandler = this.handleKeyDown.bind(this);
    window.addEventListener("keydown", this.keydownHandler);
  }

  /**
   * Cleanup listeners
   */
  destroy(): void {
    if (this.keydownHandler) {
      window.removeEventListener("keydown", this.keydownHandler);
    }
  }

  /**
   * Register a keyboard shortcut
   */
  registerShortcut(
    shortcut: Shortcut,
    handler: ShortcutHandler,
    priority: number = 0
  ): void {
    this.shortcuts.push({ shortcut, handler, priority });
    // Sort by priority (higher first)
    this.shortcuts.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Unregister a shortcut by key
   */
  unregisterShortcut(key: string): void {
    this.shortcuts = this.shortcuts.filter((s) => s.shortcut.key !== key);
  }

  /**
   * Clear all shortcuts
   */
  clearShortcuts(): void {
    this.shortcuts = [];
  }

  /**
   * Set whether pointer is over viewport
   */
  setPointerOverViewport(isOver: boolean): void {
    if (this.isPointerOverViewport !== isOver) {
      this.isPointerOverViewport = isOver;
      this.options.onViewportFocusChange?.(isOver);
    }
  }

  /**
   * Get whether pointer is over viewport
   */
  getPointerOverViewport(): boolean {
    return this.isPointerOverViewport;
  }

  /**
   * Set whether a transform is currently active
   */
  setTransformActive(isActive: boolean): void {
    this.isTransformActive = isActive;
  }

  /**
   * Get current mouse state
   */
  getMouseState(): Readonly<MouseState> {
    return this.mouseState;
  }

  /**
   * Update mouse position
   */
  updateMousePosition(x: number, y: number): void {
    this.mouseState.x = x;
    this.mouseState.y = y;
  }

  /**
   * Set mouse dragging state
   */
  setMouseDragging(isDragging: boolean, button: number = 0): void {
    this.mouseState.isDragging = isDragging;
    this.mouseState.button = button;
  }

  /**
   * Handle keydown event
   */
  private handleKeyDown(e: KeyboardEvent): void {
    // Determine current context
    const isEscape = e.key === "Escape";

    // Find matching shortcut
    for (const { shortcut, handler } of this.shortcuts) {
      if (!this.matchesShortcut(e, shortcut)) continue;

      // Check context rules
      const canExecute = this.canExecuteShortcut(shortcut, isEscape);
      if (!canExecute) continue;

      // Execute handler
      if (handler(e)) {
        e.preventDefault();
        return;
      }
    }
  }

  /**
   * Check if event matches shortcut definition
   */
  private matchesShortcut(e: KeyboardEvent, shortcut: Shortcut): boolean {
    if (e.key.toLowerCase() !== shortcut.key) return false;
    if (shortcut.ctrl && !(e.ctrlKey || e.metaKey)) return false;
    if (shortcut.shift && !e.shiftKey) return false;
    if (shortcut.alt && !e.altKey) return false;
    return true;
  }

  /**
   * Check if shortcut can execute in current context
   */
  private canExecuteShortcut(shortcut: Shortcut, isEscape: boolean): boolean {
    // Escape always works
    if (isEscape) return true;

    // Global shortcuts always work
    if (shortcut.global) return true;

    // During transform, only specific shortcuts work
    if (this.isTransformActive) {
      return shortcut.duringTransform === true;
    }

    // Viewport shortcuts only work when pointer is over viewport
    return this.isPointerOverViewport;
  }
}

/**
 * Create standard editor shortcuts
 * Returns shortcut definitions that can be registered with InputManager
 */
export function createEditorShortcuts(): Shortcut[] {
  return [
    // Selection modes
    { key: "1", description: "Vertex selection mode" },
    { key: "2", description: "Edge selection mode" },
    { key: "3", description: "Face selection mode" },

    // Transforms
    { key: "g", description: "Grab/Move" },
    { key: "r", description: "Rotate" },
    { key: "s", description: "Scale" },

    // Axis constraints (work during transforms)
    { key: "x", duringTransform: true, description: "Constrain to X axis" },
    { key: "y", duringTransform: true, description: "Constrain to Y axis" },
    { key: "z", duringTransform: true, description: "Constrain to Z axis" },

    // Transform control
    {
      key: "escape",
      global: true,
      duringTransform: true,
      description: "Cancel transform",
    },
    {
      key: "enter",
      duringTransform: true,
      description: "Confirm transform",
    },

    // Mode switching
    { key: "tab", description: "Toggle Object/Edit mode" },

    // View modes
    { key: "z", description: "Cycle view modes" },

    // Selection
    { key: "a", description: "Select all" },
    { key: "a", ctrl: true, description: "Select all" },
    { key: "l", ctrl: true, description: "Select linked" },

    // Edit operations
    { key: "x", description: "Delete selected" },
    { key: "delete", description: "Delete selected" },
    { key: "backspace", description: "Delete selected" },

    // Undo/Redo (global)
    { key: "z", ctrl: true, global: true, description: "Undo" },
    { key: "z", ctrl: true, shift: true, global: true, description: "Redo" },

    // Viewpoints
    { key: "1", description: "Front view" },
    { key: "3", description: "Right view" },
    { key: "7", description: "Top view" },
    { key: "0", description: "Perspective view" },
    { key: "5", description: "Toggle orthographic" },
  ];
}

/**
 * Helper to create viewport mouse handlers
 */
export function createViewportMouseHandlers(
  inputManager: InputManager,
  callbacks: {
    onMouseDown?: (
      x: number,
      y: number,
      button: number,
      shiftKey: boolean
    ) => void;
    onMouseMove?: (
      deltaX: number,
      deltaY: number,
      x: number,
      y: number
    ) => void;
    onMouseUp?: () => void;
    onWheel?: (deltaY: number) => void;
  }
) {
  const handleMouseDown = (e: MouseEvent) => {
    inputManager.setMouseDragging(true, e.button);
    inputManager.updateMousePosition(e.clientX, e.clientY);
    callbacks.onMouseDown?.(e.clientX, e.clientY, e.button, e.shiftKey);
  };

  const handleMouseUp = () => {
    inputManager.setMouseDragging(false);
    callbacks.onMouseUp?.();
  };

  const handleMouseMove = (e: MouseEvent) => {
    const state = inputManager.getMouseState();
    const deltaX = e.clientX - state.x;
    const deltaY = e.clientY - state.y;
    inputManager.updateMousePosition(e.clientX, e.clientY);
    callbacks.onMouseMove?.(deltaX, deltaY, e.clientX, e.clientY);
  };

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    callbacks.onWheel?.(e.deltaY);
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
  };

  const handleViewportEnter = () => {
    inputManager.setPointerOverViewport(true);
  };

  const handleViewportLeave = () => {
    inputManager.setPointerOverViewport(false);
  };

  return {
    handleMouseDown,
    handleMouseUp,
    handleMouseMove,
    handleWheel,
    handleContextMenu,
    handleViewportEnter,
    handleViewportLeave,
  };
}
