/**
 * Unit tests for the History System
 *
 * Tests the GenericHistoryStack, History, and MultiStackHistoryManager classes
 * for undo/redo functionality.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  GenericHistoryStack,
  History,
  historyManager,
  serializeMesh,
  deserializeMesh,
  HistoryAction,
} from "./history";
import { Mesh, Vertex } from "../primitives";
import { Vector3, Color } from "../math";

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a simple triangle mesh for serialization tests
 */
function createTestMesh(): Mesh {
  const vertices = [
    new Vertex(new Vector3(0, 0, 0), Color.white()),
    new Vertex(new Vector3(1, 0, 0), Color.white()),
    new Vertex(new Vector3(0.5, 1, 0), Color.white()),
  ];
  const mesh = new Mesh(vertices, [0, 1, 2]);
  return mesh;
}

/**
 * Create a test history action
 */
function createTestAction(description: string): HistoryAction {
  return {
    type: "object-transform",
    description,
    objectTransform: {
      before: {
        objectName: "Cube",
        position: new Vector3(0, 0, 0),
        rotation: new Vector3(0, 0, 0),
        scale: new Vector3(1, 1, 1),
      },
      after: {
        objectName: "Cube",
        position: new Vector3(1, 0, 0),
        rotation: new Vector3(0, 0, 0),
        scale: new Vector3(1, 1, 1),
      },
    },
  };
}

// ============================================================================
// GenericHistoryStack Tests
// ============================================================================

describe("GenericHistoryStack - Basic Operations", () => {
  let stack: GenericHistoryStack<string>;

  beforeEach(() => {
    stack = new GenericHistoryStack<string>(10);
  });

  test("should initialize with empty stacks", () => {
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
    expect(stack.getStackSizes()).toEqual({ undo: 0, redo: 0 });
  });

  test("should push states to undo stack", () => {
    stack.push("state1");
    stack.push("state2");

    expect(stack.canUndo()).toBe(true);
    expect(stack.getStackSizes().undo).toBe(2);
  });

  test("should clear redo stack on new push", () => {
    stack.push("state1");
    stack.push("state2");

    // Undo to create redo item
    stack.popUndo("current");
    expect(stack.canRedo()).toBe(true);

    // New push should clear redo
    stack.push("state3");
    expect(stack.canRedo()).toBe(false);
  });

  test("should trigger onChange callback", () => {
    let callCount = 0;
    stack.setOnChange(() => callCount++);

    stack.push("state1");
    expect(callCount).toBe(1);

    stack.push("state2");
    expect(callCount).toBe(2);
  });
});

describe("GenericHistoryStack - Undo/Redo", () => {
  let stack: GenericHistoryStack<string>;

  beforeEach(() => {
    stack = new GenericHistoryStack<string>(10);
    stack.push("state1");
    stack.push("state2");
    stack.push("state3");
  });

  test("should pop from undo stack", () => {
    const result = stack.popUndo("current");
    expect(result).toBe("state3");
    expect(stack.canRedo()).toBe(true);
    expect(stack.getStackSizes().undo).toBe(2);
  });

  test("should pop from redo stack", () => {
    stack.popUndo("current");
    const result = stack.popRedo("afterUndo");

    expect(result).toBe("current");
    expect(stack.getStackSizes().redo).toBe(0);
    expect(stack.getStackSizes().undo).toBe(3);
  });

  test("should return null when popping empty undo stack", () => {
    stack.clear();
    const result = stack.popUndo("current");
    expect(result).toBe(null);
  });

  test("should return null when popping empty redo stack", () => {
    const result = stack.popRedo("current");
    expect(result).toBe(null);
  });

  test("should handle multiple undo/redo operations", () => {
    // Undo all
    stack.popUndo("current");
    stack.popUndo("current");
    stack.popUndo("current");

    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(true);
    expect(stack.getStackSizes().redo).toBe(3);

    // Redo all
    stack.popRedo("current");
    stack.popRedo("current");
    stack.popRedo("current");

    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
  });
});

describe("GenericHistoryStack - Max Levels", () => {
  test("should limit undo stack to max levels", () => {
    const stack = new GenericHistoryStack<number>(3);

    stack.push(1);
    stack.push(2);
    stack.push(3);
    stack.push(4); // Should remove 1

    expect(stack.getStackSizes().undo).toBe(3);

    // First pop should return 4
    const result1 = stack.popUndo(0);
    expect(result1).toBe(4);

    // Then 3
    const result2 = stack.popUndo(0);
    expect(result2).toBe(3);

    // Then 2
    const result3 = stack.popUndo(0);
    expect(result3).toBe(2);

    // No more
    expect(stack.canUndo()).toBe(false);
  });
});

describe("GenericHistoryStack - Clear", () => {
  test("should clear both stacks", () => {
    const stack = new GenericHistoryStack<string>(10);
    stack.push("state1");
    stack.push("state2");
    stack.popUndo("current");

    stack.clear();

    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
    expect(stack.getStackSizes()).toEqual({ undo: 0, redo: 0 });
  });

  test("should trigger onChange when clearing", () => {
    const stack = new GenericHistoryStack<string>(10);
    let callCount = 0;
    stack.setOnChange(() => callCount++);

    stack.push("state1");
    stack.clear();

    expect(callCount).toBe(2); // push + clear
  });
});

// ============================================================================
// History (Action-based) Tests
// ============================================================================

describe("History - Basic Operations", () => {
  let history: History;

  beforeEach(() => {
    history = new History(50);
  });

  test("should initialize with empty stacks", () => {
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.getStackSizes()).toEqual({ undo: 0, redo: 0 });
  });

  test("should push actions", () => {
    const action = createTestAction("Move Cube");
    history.push(action);

    expect(history.canUndo()).toBe(true);
    expect(history.getUndoDescription()).toBe("Move Cube");
  });

  test("should clear redo on new action", () => {
    history.push(createTestAction("Action 1"));
    history.push(createTestAction("Action 2"));
    history.popUndo();

    expect(history.canRedo()).toBe(true);

    history.push(createTestAction("Action 3"));
    expect(history.canRedo()).toBe(false);
  });
});

describe("History - Undo/Redo", () => {
  let history: History;

  beforeEach(() => {
    history = new History(50);
    history.push(createTestAction("Action 1"));
    history.push(createTestAction("Action 2"));
    history.push(createTestAction("Action 3"));
  });

  test("should undo actions in order", () => {
    const action1 = history.popUndo();
    expect(action1?.description).toBe("Action 3");

    const action2 = history.popUndo();
    expect(action2?.description).toBe("Action 2");

    const action3 = history.popUndo();
    expect(action3?.description).toBe("Action 1");

    expect(history.canUndo()).toBe(false);
  });

  test("should redo actions in order", () => {
    history.popUndo();
    history.popUndo();

    const action1 = history.popRedo();
    expect(action1?.description).toBe("Action 2");

    const action2 = history.popRedo();
    expect(action2?.description).toBe("Action 3");

    expect(history.canRedo()).toBe(false);
  });

  test("should return null when undo stack is empty", () => {
    history.clear();
    const result = history.popUndo();
    expect(result).toBe(null);
  });

  test("should return null when redo stack is empty", () => {
    const result = history.popRedo();
    expect(result).toBe(null);
  });
});

describe("History - Descriptions", () => {
  let history: History;

  beforeEach(() => {
    history = new History(50);
  });

  test("should return empty string for empty undo description", () => {
    expect(history.getUndoDescription()).toBe("");
  });

  test("should return empty string for empty redo description", () => {
    expect(history.getRedoDescription()).toBe("");
  });

  test("should return correct undo description", () => {
    history.push(createTestAction("Move Cube"));
    history.push(createTestAction("Rotate Cube"));

    expect(history.getUndoDescription()).toBe("Rotate Cube");
  });

  test("should return correct redo description", () => {
    history.push(createTestAction("Move Cube"));
    history.push(createTestAction("Rotate Cube"));
    history.popUndo();

    expect(history.getRedoDescription()).toBe("Rotate Cube");
  });
});

describe("History - Status", () => {
  let history: History;

  beforeEach(() => {
    history = new History(50);
  });

  test("should return correct status", () => {
    history.push(createTestAction("Action 1"));
    history.push(createTestAction("Action 2"));
    history.popUndo();

    const status = history.getStatus();

    expect(status.canUndo).toBe(true);
    expect(status.canRedo).toBe(true);
    expect(status.undoDesc).toBe("Action 1");
    expect(status.redoDesc).toBe("Action 2");
  });
});

describe("History - Max Levels", () => {
  test("should limit undo stack", () => {
    const history = new History(3);

    history.push(createTestAction("Action 1"));
    history.push(createTestAction("Action 2"));
    history.push(createTestAction("Action 3"));
    history.push(createTestAction("Action 4"));

    expect(history.getStackSizes().undo).toBe(3);
    expect(history.getUndoDescription()).toBe("Action 4");
  });
});

describe("History - onChange Callback", () => {
  let history: History;
  let callCount: number;

  beforeEach(() => {
    history = new History(50);
    callCount = 0;
    history.setOnChange(() => callCount++);
  });

  test("should trigger on push", () => {
    history.push(createTestAction("Action"));
    expect(callCount).toBe(1);
  });

  test("should trigger on undo", () => {
    history.push(createTestAction("Action"));
    history.popUndo();
    expect(callCount).toBe(2);
  });

  test("should trigger on redo", () => {
    history.push(createTestAction("Action"));
    history.popUndo();
    history.popRedo();
    expect(callCount).toBe(3);
  });

  test("should trigger on clear", () => {
    history.push(createTestAction("Action"));
    history.clear();
    expect(callCount).toBe(2);
  });

  test("should not trigger after callback cleared", () => {
    history.setOnChange(null);
    history.push(createTestAction("Action"));
    expect(callCount).toBe(0);
  });
});

// ============================================================================
// Mesh Serialization Tests
// ============================================================================

describe("Mesh Serialization", () => {
  test("should serialize mesh correctly", () => {
    const mesh = createTestMesh();
    const serialized = serializeMesh(mesh);

    expect(serialized.vertices.length).toBe(3);
    expect(serialized.indices).toEqual([0, 1, 2]);
    expect(serialized.vertices[0].position.x).toBe(0);
    expect(serialized.vertices[1].position.x).toBe(1);
    expect(serialized.vertices[2].position.x).toBe(0.5);
  });

  test("should deserialize mesh correctly", () => {
    const mesh = createTestMesh();
    const serialized = serializeMesh(mesh);
    const deserialized = deserializeMesh(serialized);

    expect(deserialized.vertices.length).toBe(3);
    expect(deserialized.indices).toEqual([0, 1, 2]);
    expect(deserialized.vertices[0].position.x).toBe(0);
    expect(deserialized.vertices[1].position.x).toBe(1);
    expect(deserialized.vertices[2].position.x).toBe(0.5);
  });

  test("should preserve vertex colors", () => {
    const vertices = [
      new Vertex(new Vector3(0, 0, 0), new Color(1, 0, 0)),
      new Vertex(new Vector3(1, 0, 0), new Color(0, 1, 0)),
      new Vertex(new Vector3(0, 1, 0), new Color(0, 0, 1)),
    ];
    const mesh = new Mesh(vertices, [0, 1, 2]);

    const serialized = serializeMesh(mesh);
    const deserialized = deserializeMesh(serialized);

    expect(deserialized.vertices[0].color.r).toBe(1);
    expect(deserialized.vertices[1].color.g).toBe(1);
    expect(deserialized.vertices[2].color.b).toBe(1);
  });

  test("should preserve UV coordinates", () => {
    const v1 = new Vertex(new Vector3(0, 0, 0), Color.white());
    v1.u = 0;
    v1.v = 0;
    const v2 = new Vertex(new Vector3(1, 0, 0), Color.white());
    v2.u = 1;
    v2.v = 0;
    const v3 = new Vertex(new Vector3(0, 1, 0), Color.white());
    v3.u = 0;
    v3.v = 1;

    const mesh = new Mesh([v1, v2, v3], [0, 1, 2]);
    const serialized = serializeMesh(mesh);
    const deserialized = deserializeMesh(serialized);

    expect(deserialized.vertices[0].u).toBe(0);
    expect(deserialized.vertices[0].v).toBe(0);
    expect(deserialized.vertices[1].u).toBe(1);
    expect(deserialized.vertices[2].v).toBe(1);
  });
});

// ============================================================================
// MultiStackHistoryManager Tests (via global instance)
// ============================================================================

describe("MultiStackHistoryManager", () => {
  beforeEach(() => {
    // Clear all stacks before each test
    historyManager.clearAll();
  });

  test("should create and retrieve generic stacks", () => {
    const stack = historyManager.getStack<string>("test-stack");
    stack.push("state1");

    const sameStack = historyManager.getStack<string>("test-stack");
    expect(sameStack.canUndo()).toBe(true);
  });

  test("should manage independent stacks", () => {
    const stack1 = historyManager.getStack<string>("stack1");
    const stack2 = historyManager.getStack<number>("stack2");

    stack1.push("hello");
    stack2.push(42);

    expect(stack1.getStackSizes().undo).toBe(1);
    expect(stack2.getStackSizes().undo).toBe(1);
  });

  test("should clear specific stack", () => {
    const stack = historyManager.getStack<string>("test-stack");
    stack.push("state");

    historyManager.clearStack("test-stack");
    expect(stack.canUndo()).toBe(false);
  });

  test("should clear all stacks", () => {
    const stack1 = historyManager.getStack<string>("stack1");
    const stack2 = historyManager.getStack<string>("stack2");

    stack1.push("state1");
    stack2.push("state2");

    historyManager.clearAll();

    expect(stack1.canUndo()).toBe(false);
    expect(stack2.canUndo()).toBe(false);
  });

  test("should delete specific stack", () => {
    historyManager.getStack<string>("temp-stack");
    historyManager.deleteStack("temp-stack");

    // Getting same ID creates new stack
    const newStack = historyManager.getStack<string>("temp-stack");
    expect(newStack.canUndo()).toBe(false);
  });

  test("should register external history stacks", () => {
    const externalHistory = new History(50);
    externalHistory.push(createTestAction("External Action"));

    historyManager.registerStack("external", externalHistory);

    const retrieved = historyManager.getRegisteredStack<History>("external");
    expect(retrieved?.canUndo()).toBe(true);
  });

  test("should get all stack IDs", () => {
    historyManager.getStack<string>("stack-a");
    historyManager.getStack<string>("stack-b");

    const ids = historyManager.getAllStackIds();
    expect(ids).toContain("stack-a");
    expect(ids).toContain("stack-b");
  });

  test("should get combined status of all stacks", () => {
    const stack1 = historyManager.getStack<string>("status-test-1");
    const stack2 = historyManager.getStack<string>("status-test-2");

    stack1.push("state");
    stack2.push("state");
    stack2.popUndo("current");

    const status = historyManager.getStatus();

    expect(status.get("status-test-1")?.canUndo).toBe(true);
    expect(status.get("status-test-1")?.canRedo).toBe(false);
    expect(status.get("status-test-2")?.canUndo).toBe(false);
    expect(status.get("status-test-2")?.canRedo).toBe(true);
  });
});

// ============================================================================
// History Action Types Tests
// ============================================================================

describe("History - Action Types", () => {
  let history: History;

  beforeEach(() => {
    history = new History(50);
  });

  test("should handle object transform actions", () => {
    const action: HistoryAction = {
      type: "object-transform",
      description: "Move Cube",
      objectTransform: {
        before: {
          objectName: "Cube",
          position: new Vector3(0, 0, 0),
          rotation: new Vector3(0, 0, 0),
          scale: new Vector3(1, 1, 1),
        },
        after: {
          objectName: "Cube",
          position: new Vector3(5, 0, 0),
          rotation: new Vector3(0, 0, 0),
          scale: new Vector3(1, 1, 1),
        },
      },
    };

    history.push(action);
    const undone = history.popUndo();

    expect(undone?.type).toBe("object-transform");
    expect(undone?.objectTransform?.before.position.x).toBe(0);
    expect(undone?.objectTransform?.after.position.x).toBe(5);
  });

  test("should handle multi-object transform actions", () => {
    const action: HistoryAction = {
      type: "multi-object-transform",
      description: "Move Multiple Objects",
      multiObjectTransform: {
        objects: [
          {
            before: {
              objectName: "Cube1",
              position: new Vector3(0, 0, 0),
              rotation: new Vector3(0, 0, 0),
              scale: new Vector3(1, 1, 1),
            },
            after: {
              objectName: "Cube1",
              position: new Vector3(1, 0, 0),
              rotation: new Vector3(0, 0, 0),
              scale: new Vector3(1, 1, 1),
            },
          },
          {
            before: {
              objectName: "Cube2",
              position: new Vector3(2, 0, 0),
              rotation: new Vector3(0, 0, 0),
              scale: new Vector3(1, 1, 1),
            },
            after: {
              objectName: "Cube2",
              position: new Vector3(3, 0, 0),
              rotation: new Vector3(0, 0, 0),
              scale: new Vector3(1, 1, 1),
            },
          },
        ],
      },
    };

    history.push(action);
    const undone = history.popUndo();

    expect(undone?.type).toBe("multi-object-transform");
    expect(undone?.multiObjectTransform?.objects.length).toBe(2);
  });

  test("should handle vertex move actions", () => {
    const action: HistoryAction = {
      type: "vertex-move",
      description: "Move Vertices",
      vertexMove: {
        before: {
          objectName: "Cube",
          vertices: new Map([
            [0, new Vector3(0, 0, 0)],
            [1, new Vector3(1, 0, 0)],
          ]),
        },
        after: {
          objectName: "Cube",
          vertices: new Map([
            [0, new Vector3(0, 1, 0)],
            [1, new Vector3(1, 1, 0)],
          ]),
        },
      },
    };

    history.push(action);
    const undone = history.popUndo();

    expect(undone?.type).toBe("vertex-move");
    expect(undone?.vertexMove?.before.vertices.get(0)?.y).toBe(0);
    expect(undone?.vertexMove?.after.vertices.get(0)?.y).toBe(1);
  });

  test("should handle selection change actions", () => {
    const action: HistoryAction = {
      type: "selection-change",
      description: "Select Objects",
      selectionChange: {
        before: {
          selectedObjectNames: ["Cube1"],
        },
        after: {
          selectedObjectNames: ["Cube1", "Cube2"],
        },
      },
    };

    history.push(action);
    const undone = history.popUndo();

    expect(undone?.type).toBe("selection-change");
    expect(undone?.selectionChange?.before.selectedObjectNames).toEqual([
      "Cube1",
    ]);
    expect(undone?.selectionChange?.after.selectedObjectNames).toEqual([
      "Cube1",
      "Cube2",
    ]);
  });

  test("should handle mode change actions", () => {
    const action: HistoryAction = {
      type: "mode-change",
      description: "Enter Edit Mode",
      modeChange: {
        before: {
          mode: "object",
          selection: { selectedObjectNames: ["Cube"] },
        },
        after: {
          mode: "edit",
          selection: { selectedObjectNames: ["Cube"] },
        },
      },
    };

    history.push(action);
    const undone = history.popUndo();

    expect(undone?.type).toBe("mode-change");
    expect(undone?.modeChange?.before.mode).toBe("object");
    expect(undone?.modeChange?.after.mode).toBe("edit");
  });
});
