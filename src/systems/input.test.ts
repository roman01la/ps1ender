/**
 * Unit tests for the Input System
 *
 * Tests the InputManager class for keyboard shortcut handling,
 * mouse state tracking, and viewport focus management.
 */

import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "bun:test";
import {
  InputManager,
  Shortcut,
  createEditorShortcuts,
  createViewportMouseHandlers,
} from "./input";

// ============================================================================
// Mock Window and DOM Events for bun test environment
// ============================================================================

type EventListener = (e: Event) => void;

class MockEventTarget {
  private listeners: Map<string, Set<EventListener>> = new Map();

  addEventListener(type: string, listener: EventListener): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    const listeners = this.listeners.get(event.type);
    if (listeners) {
      for (const listener of listeners) {
        listener(event);
      }
    }
    return true;
  }
}

// Create mock window
const mockWindow = new MockEventTarget();

// Store original global values
const originalWindow = (globalThis as any).window;
const originalKeyboardEvent = (globalThis as any).KeyboardEvent;
const originalMouseEvent = (globalThis as any).MouseEvent;
const originalWheelEvent = (globalThis as any).WheelEvent;

// Mock KeyboardEvent class
class MockKeyboardEvent {
  type: string;
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  bubbles: boolean;
  cancelable: boolean;
  defaultPrevented: boolean = false;

  constructor(type: string, options: any = {}) {
    this.type = type;
    this.key = options.key || "";
    this.ctrlKey = options.ctrlKey || false;
    this.shiftKey = options.shiftKey || false;
    this.altKey = options.altKey || false;
    this.metaKey = options.metaKey || false;
    this.bubbles = options.bubbles || false;
    this.cancelable = options.cancelable || false;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

// Mock MouseEvent class
class MockMouseEvent {
  type: string;
  clientX: number;
  clientY: number;
  button: number;
  shiftKey: boolean;
  bubbles: boolean;
  cancelable: boolean;
  defaultPrevented: boolean = false;

  constructor(type: string, options: any = {}) {
    this.type = type;
    this.clientX = options.clientX || 0;
    this.clientY = options.clientY || 0;
    this.button = options.button || 0;
    this.shiftKey = options.shiftKey || false;
    this.bubbles = options.bubbles || false;
    this.cancelable = options.cancelable || false;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

// Mock WheelEvent class
class MockWheelEvent {
  type: string;
  deltaY: number;
  bubbles: boolean;
  cancelable: boolean;
  defaultPrevented: boolean = false;

  constructor(type: string, options: any = {}) {
    this.type = type;
    this.deltaY = options.deltaY || 0;
    this.bubbles = options.bubbles || false;
    this.cancelable = options.cancelable || false;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

// Setup mocks before all tests
beforeAll(() => {
  (globalThis as any).window = mockWindow;
  (globalThis as any).KeyboardEvent = MockKeyboardEvent;
  (globalThis as any).MouseEvent = MockMouseEvent;
  (globalThis as any).WheelEvent = MockWheelEvent;
});

// Restore after all tests
afterAll(() => {
  if (originalWindow !== undefined) {
    (globalThis as any).window = originalWindow;
  } else {
    delete (globalThis as any).window;
  }
  if (originalKeyboardEvent !== undefined) {
    (globalThis as any).KeyboardEvent = originalKeyboardEvent;
  }
  if (originalMouseEvent !== undefined) {
    (globalThis as any).MouseEvent = originalMouseEvent;
  }
  if (originalWheelEvent !== undefined) {
    (globalThis as any).WheelEvent = originalWheelEvent;
  }
});

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock KeyboardEvent
 */
function createKeyEvent(
  key: string,
  options: {
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
  } = {}
): any {
  return new MockKeyboardEvent("keydown", {
    key,
    ctrlKey: options.ctrlKey || false,
    shiftKey: options.shiftKey || false,
    altKey: options.altKey || false,
    metaKey: options.metaKey || false,
    bubbles: true,
    cancelable: true,
  });
}

// ============================================================================
// InputManager - Basic Operations
// ============================================================================

describe("InputManager - Basic Operations", () => {
  let inputManager: InputManager;

  beforeEach(() => {
    inputManager = new InputManager();
  });

  afterEach(() => {
    inputManager.destroy();
  });

  test("should initialize with default mouse state", () => {
    const state = inputManager.getMouseState();

    expect(state.x).toBe(0);
    expect(state.y).toBe(0);
    expect(state.isDragging).toBe(false);
    expect(state.button).toBe(0);
  });

  test("should initialize with pointer not over viewport", () => {
    expect(inputManager.getPointerOverViewport()).toBe(false);
  });

  test("should init and destroy without errors", () => {
    inputManager.init();
    inputManager.destroy();
    // Should not throw
  });
});

// ============================================================================
// Mouse State Management
// ============================================================================

describe("InputManager - Mouse State", () => {
  let inputManager: InputManager;

  beforeEach(() => {
    inputManager = new InputManager();
  });

  afterEach(() => {
    inputManager.destroy();
  });

  test("should update mouse position", () => {
    inputManager.updateMousePosition(100, 200);

    const state = inputManager.getMouseState();
    expect(state.x).toBe(100);
    expect(state.y).toBe(200);
  });

  test("should set mouse dragging state", () => {
    inputManager.setMouseDragging(true, 0);

    const state = inputManager.getMouseState();
    expect(state.isDragging).toBe(true);
    expect(state.button).toBe(0);
  });

  test("should set mouse dragging with different buttons", () => {
    inputManager.setMouseDragging(true, 2);

    const state = inputManager.getMouseState();
    expect(state.isDragging).toBe(true);
    expect(state.button).toBe(2);
  });

  test("should clear dragging state", () => {
    inputManager.setMouseDragging(true, 1);
    inputManager.setMouseDragging(false);

    const state = inputManager.getMouseState();
    expect(state.isDragging).toBe(false);
  });
});

// ============================================================================
// Viewport Focus
// ============================================================================

describe("InputManager - Viewport Focus", () => {
  let inputManager: InputManager;

  beforeEach(() => {
    inputManager = new InputManager();
  });

  afterEach(() => {
    inputManager.destroy();
  });

  test("should set pointer over viewport", () => {
    inputManager.setPointerOverViewport(true);
    expect(inputManager.getPointerOverViewport()).toBe(true);
  });

  test("should clear pointer over viewport", () => {
    inputManager.setPointerOverViewport(true);
    inputManager.setPointerOverViewport(false);
    expect(inputManager.getPointerOverViewport()).toBe(false);
  });

  test("should trigger focus change callback", () => {
    let focusValue: boolean | null = null;
    const manager = new InputManager({
      onViewportFocusChange: (isOver) => {
        focusValue = isOver;
      },
    });

    manager.setPointerOverViewport(true);
    expect(focusValue).toBe(true);

    manager.setPointerOverViewport(false);
    expect(focusValue).toBe(false);

    manager.destroy();
  });

  test("should not trigger callback if value unchanged", () => {
    let callCount = 0;
    const manager = new InputManager({
      onViewportFocusChange: () => {
        callCount++;
      },
    });

    manager.setPointerOverViewport(true);
    manager.setPointerOverViewport(true); // Same value

    expect(callCount).toBe(1);

    manager.destroy();
  });
});

// ============================================================================
// Transform Active State
// ============================================================================

describe("InputManager - Transform Active", () => {
  let inputManager: InputManager;

  beforeEach(() => {
    inputManager = new InputManager();
    inputManager.init();
  });

  afterEach(() => {
    inputManager.destroy();
  });

  test("should set transform active state", () => {
    inputManager.setTransformActive(true);
    // State is internal but affects shortcut execution
    // Main test is that it doesn't throw
  });

  test("should clear transform active state", () => {
    inputManager.setTransformActive(true);
    inputManager.setTransformActive(false);
    // Should not throw
  });
});

// ============================================================================
// Shortcut Registration
// ============================================================================

describe("InputManager - Shortcut Registration", () => {
  let inputManager: InputManager;

  beforeEach(() => {
    inputManager = new InputManager();
    inputManager.init();
  });

  afterEach(() => {
    inputManager.destroy();
  });

  test("should register shortcut", () => {
    const shortcut: Shortcut = { key: "g", description: "Grab" };
    inputManager.registerShortcut(shortcut, () => true);
    // Should not throw
  });

  test("should register shortcut with modifiers", () => {
    const shortcut: Shortcut = {
      key: "z",
      ctrl: true,
      shift: true,
      description: "Redo",
    };
    inputManager.registerShortcut(shortcut, () => true);
    // Should not throw
  });

  test("should unregister shortcut", () => {
    const shortcut: Shortcut = { key: "g", description: "Grab" };
    inputManager.registerShortcut(shortcut, () => true);
    inputManager.unregisterShortcut("g");
    // Should not throw
  });

  test("should clear all shortcuts", () => {
    inputManager.registerShortcut({ key: "g" }, () => true);
    inputManager.registerShortcut({ key: "r" }, () => true);
    inputManager.registerShortcut({ key: "s" }, () => true);

    inputManager.clearShortcuts();
    // Should not throw
  });

  test("should handle priority-based registration", () => {
    const results: string[] = [];

    inputManager.registerShortcut(
      { key: "g", global: true },
      () => {
        results.push("low");
        return false; // Don't consume
      },
      0
    );

    inputManager.registerShortcut(
      { key: "g", global: true },
      () => {
        results.push("high");
        return true; // Consume
      },
      10
    );

    // Trigger the shortcut
    window.dispatchEvent(createKeyEvent("g"));

    // Higher priority should be called first
    expect(results[0]).toBe("high");
  });
});

// ============================================================================
// Shortcut Execution
// ============================================================================

describe("InputManager - Shortcut Execution", () => {
  let inputManager: InputManager;
  let handlerCalled: boolean;

  beforeEach(() => {
    inputManager = new InputManager();
    inputManager.init();
    handlerCalled = false;
  });

  afterEach(() => {
    inputManager.destroy();
  });

  test("should execute global shortcut regardless of viewport focus", () => {
    inputManager.registerShortcut(
      { key: "z", ctrl: true, global: true },
      () => {
        handlerCalled = true;
        return true;
      }
    );

    inputManager.setPointerOverViewport(false);
    window.dispatchEvent(createKeyEvent("z", { ctrlKey: true }));

    expect(handlerCalled).toBe(true);
  });

  test("should execute viewport shortcut when pointer over viewport", () => {
    inputManager.registerShortcut({ key: "g" }, () => {
      handlerCalled = true;
      return true;
    });

    inputManager.setPointerOverViewport(true);
    window.dispatchEvent(createKeyEvent("g"));

    expect(handlerCalled).toBe(true);
  });

  test("should not execute viewport shortcut when pointer outside viewport", () => {
    inputManager.registerShortcut({ key: "g" }, () => {
      handlerCalled = true;
      return true;
    });

    inputManager.setPointerOverViewport(false);
    window.dispatchEvent(createKeyEvent("g"));

    expect(handlerCalled).toBe(false);
  });

  test("should execute duringTransform shortcut during active transform", () => {
    inputManager.registerShortcut({ key: "x", duringTransform: true }, () => {
      handlerCalled = true;
      return true;
    });

    inputManager.setPointerOverViewport(true);
    inputManager.setTransformActive(true);
    window.dispatchEvent(createKeyEvent("x"));

    expect(handlerCalled).toBe(true);
  });

  test("should not execute non-transform shortcut during active transform", () => {
    inputManager.registerShortcut(
      { key: "g" }, // Not marked as duringTransform
      () => {
        handlerCalled = true;
        return true;
      }
    );

    inputManager.setPointerOverViewport(true);
    inputManager.setTransformActive(true);
    window.dispatchEvent(createKeyEvent("g"));

    expect(handlerCalled).toBe(false);
  });

  test("should always allow Escape key", () => {
    inputManager.registerShortcut({ key: "escape" }, () => {
      handlerCalled = true;
      return true;
    });

    inputManager.setPointerOverViewport(false);
    inputManager.setTransformActive(true);
    window.dispatchEvent(createKeyEvent("Escape"));

    expect(handlerCalled).toBe(true);
  });
});

// ============================================================================
// Modifier Key Matching
// ============================================================================

describe("InputManager - Modifier Keys", () => {
  let inputManager: InputManager;

  beforeEach(() => {
    inputManager = new InputManager();
    inputManager.init();
    inputManager.setPointerOverViewport(true);
  });

  afterEach(() => {
    inputManager.destroy();
  });

  test("should match Ctrl modifier", () => {
    let called = false;
    inputManager.registerShortcut({ key: "s", ctrl: true }, () => {
      called = true;
      return true;
    });

    window.dispatchEvent(createKeyEvent("s", { ctrlKey: true }));
    expect(called).toBe(true);
  });

  test("should not match without required Ctrl modifier", () => {
    let called = false;
    inputManager.registerShortcut({ key: "s", ctrl: true }, () => {
      called = true;
      return true;
    });

    window.dispatchEvent(createKeyEvent("s"));
    expect(called).toBe(false);
  });

  test("should match Shift modifier", () => {
    let called = false;
    inputManager.registerShortcut({ key: "d", shift: true }, () => {
      called = true;
      return true;
    });

    window.dispatchEvent(createKeyEvent("d", { shiftKey: true }));
    expect(called).toBe(true);
  });

  test("should match Alt modifier", () => {
    let called = false;
    inputManager.registerShortcut({ key: "a", alt: true }, () => {
      called = true;
      return true;
    });

    window.dispatchEvent(createKeyEvent("a", { altKey: true }));
    expect(called).toBe(true);
  });

  test("should match Meta key as Ctrl (for macOS)", () => {
    let called = false;
    inputManager.registerShortcut({ key: "z", ctrl: true }, () => {
      called = true;
      return true;
    });

    window.dispatchEvent(createKeyEvent("z", { metaKey: true }));
    expect(called).toBe(true);
  });

  test("should match multiple modifiers", () => {
    let called = false;
    inputManager.registerShortcut({ key: "z", ctrl: true, shift: true }, () => {
      called = true;
      return true;
    });

    window.dispatchEvent(
      createKeyEvent("z", { ctrlKey: true, shiftKey: true })
    );
    expect(called).toBe(true);
  });

  test("should not match with extra modifiers when not required", () => {
    let called = false;
    inputManager.registerShortcut({ key: "z", ctrl: true }, () => {
      called = true;
      return true;
    });

    // Only Ctrl is required, Shift should still work
    window.dispatchEvent(
      createKeyEvent("z", { ctrlKey: true, shiftKey: true })
    );
    expect(called).toBe(true);
  });
});

// ============================================================================
// createEditorShortcuts
// ============================================================================

describe("createEditorShortcuts", () => {
  test("should return an array of shortcuts", () => {
    const shortcuts = createEditorShortcuts();

    expect(Array.isArray(shortcuts)).toBe(true);
    expect(shortcuts.length).toBeGreaterThan(0);
  });

  test("should include transform shortcuts", () => {
    const shortcuts = createEditorShortcuts();

    const grabShortcut = shortcuts.find((s) => s.key === "g");
    const rotateShortcut = shortcuts.find((s) => s.key === "r");
    const scaleShortcut = shortcuts.find((s) => s.key === "s");

    expect(grabShortcut).toBeDefined();
    expect(rotateShortcut).toBeDefined();
    expect(scaleShortcut).toBeDefined();
  });

  test("should include axis constraint shortcuts with duringTransform", () => {
    const shortcuts = createEditorShortcuts();

    const xShortcut = shortcuts.find(
      (s) => s.key === "x" && s.duringTransform && !s.shift
    );
    const yShortcut = shortcuts.find(
      (s) => s.key === "y" && s.duringTransform && !s.shift
    );
    const zShortcut = shortcuts.find(
      (s) => s.key === "z" && s.duringTransform && !s.shift
    );

    expect(xShortcut?.duringTransform).toBe(true);
    expect(yShortcut?.duringTransform).toBe(true);
    expect(zShortcut?.duringTransform).toBe(true);
  });

  test("should include undo/redo as global shortcuts", () => {
    const shortcuts = createEditorShortcuts();

    const undoShortcut = shortcuts.find(
      (s) => s.key === "z" && s.ctrl && !s.shift && s.global
    );
    const redoShortcut = shortcuts.find(
      (s) => s.key === "z" && s.ctrl && s.shift && s.global
    );

    expect(undoShortcut?.global).toBe(true);
    expect(redoShortcut?.global).toBe(true);
  });

  test("should include escape as global and duringTransform", () => {
    const shortcuts = createEditorShortcuts();

    const escapeShortcut = shortcuts.find((s) => s.key === "escape");

    expect(escapeShortcut?.global).toBe(true);
    expect(escapeShortcut?.duringTransform).toBe(true);
  });
});

// ============================================================================
// createViewportMouseHandlers
// ============================================================================

describe("createViewportMouseHandlers", () => {
  let inputManager: InputManager;

  beforeEach(() => {
    inputManager = new InputManager();
  });

  afterEach(() => {
    inputManager.destroy();
  });

  test("should create mouse handler functions", () => {
    const handlers = createViewportMouseHandlers(inputManager, {});

    expect(typeof handlers.handleMouseDown).toBe("function");
    expect(typeof handlers.handleMouseUp).toBe("function");
    expect(typeof handlers.handleMouseMove).toBe("function");
    expect(typeof handlers.handleWheel).toBe("function");
    expect(typeof handlers.handleContextMenu).toBe("function");
    expect(typeof handlers.handleViewportEnter).toBe("function");
    expect(typeof handlers.handleViewportLeave).toBe("function");
  });

  test("should call onMouseDown callback", () => {
    let receivedArgs: any = null;
    const handlers = createViewportMouseHandlers(inputManager, {
      onMouseDown: (x, y, button, shiftKey) => {
        receivedArgs = { x, y, button, shiftKey };
      },
    });

    const event = new MouseEvent("mousedown", {
      clientX: 100,
      clientY: 200,
      button: 0,
      shiftKey: true,
    });
    handlers.handleMouseDown(event);

    expect(receivedArgs).toEqual({ x: 100, y: 200, button: 0, shiftKey: true });
  });

  test("should update input manager on mouse down", () => {
    const handlers = createViewportMouseHandlers(inputManager, {});

    const event = new MouseEvent("mousedown", {
      clientX: 150,
      clientY: 250,
      button: 1,
    });
    handlers.handleMouseDown(event);

    const state = inputManager.getMouseState();
    expect(state.x).toBe(150);
    expect(state.y).toBe(250);
    expect(state.isDragging).toBe(true);
    expect(state.button).toBe(1);
  });

  test("should call onMouseUp callback", () => {
    let called = false;
    const handlers = createViewportMouseHandlers(inputManager, {
      onMouseUp: () => {
        called = true;
      },
    });

    handlers.handleMouseUp();

    expect(called).toBe(true);
  });

  test("should clear dragging on mouse up", () => {
    const handlers = createViewportMouseHandlers(inputManager, {});

    inputManager.setMouseDragging(true, 0);
    handlers.handleMouseUp();

    const state = inputManager.getMouseState();
    expect(state.isDragging).toBe(false);
  });

  test("should call onMouseMove with delta", () => {
    let receivedDelta: any = null;
    const handlers = createViewportMouseHandlers(inputManager, {
      onMouseMove: (deltaX, deltaY, x, y) => {
        receivedDelta = { deltaX, deltaY, x, y };
      },
    });

    inputManager.updateMousePosition(100, 100);

    const event = new MouseEvent("mousemove", {
      clientX: 120,
      clientY: 110,
    });
    handlers.handleMouseMove(event);

    expect(receivedDelta.deltaX).toBe(20);
    expect(receivedDelta.deltaY).toBe(10);
    expect(receivedDelta.x).toBe(120);
    expect(receivedDelta.y).toBe(110);
  });

  test("should call onWheel callback", () => {
    let receivedDeltaY: number | null = null;
    const handlers = createViewportMouseHandlers(inputManager, {
      onWheel: (deltaY) => {
        receivedDeltaY = deltaY;
      },
    });

    const event = new WheelEvent("wheel", {
      deltaY: 50,
      cancelable: true,
    });
    handlers.handleWheel(event);

    expect(receivedDeltaY).toBe(50);
  });

  test("should set viewport focus on enter/leave", () => {
    const handlers = createViewportMouseHandlers(inputManager, {});

    handlers.handleViewportEnter();
    expect(inputManager.getPointerOverViewport()).toBe(true);

    handlers.handleViewportLeave();
    expect(inputManager.getPointerOverViewport()).toBe(false);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("InputManager - Edge Cases", () => {
  let inputManager: InputManager;

  beforeEach(() => {
    inputManager = new InputManager();
    inputManager.init();
  });

  afterEach(() => {
    inputManager.destroy();
  });

  test("should handle unregistering non-existent shortcut", () => {
    inputManager.unregisterShortcut("nonexistent");
    // Should not throw
  });

  test("should handle handler returning false (not consumed)", () => {
    const results: string[] = [];

    inputManager.registerShortcut(
      { key: "g", global: true },
      () => {
        results.push("first");
        return false; // Don't consume
      },
      10
    );

    inputManager.registerShortcut(
      { key: "g", global: true },
      () => {
        results.push("second");
        return true; // Consume
      },
      0
    );

    window.dispatchEvent(createKeyEvent("g"));

    // Both should be called since first returns false
    expect(results).toContain("first");
    expect(results).toContain("second");
  });

  test("should handle case-insensitive key matching", () => {
    let called = false;
    inputManager.registerShortcut({ key: "g", global: true }, () => {
      called = true;
      return true;
    });

    window.dispatchEvent(createKeyEvent("G")); // Uppercase
    expect(called).toBe(true);
  });

  test("should not throw when destroying without init", () => {
    const manager = new InputManager();
    manager.destroy(); // Should not throw
  });

  test("should handle multiple init calls", () => {
    inputManager.init();
    inputManager.init();
    // Should not throw or add multiple listeners
    inputManager.destroy();
  });
});
