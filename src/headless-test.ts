/**
 * Simple headless renderer test for Node.js
 *
 * Run with: npx tsx src/headless-test.ts
 */

import { HeadlessRenderer } from "./headless-rasterizer";
import { createCubeMesh } from "./primitives";
import { SceneObject, Camera } from "./scene";
import { Vector3 } from "./math";
import { existsSync, mkdirSync } from "fs";

const TEST_OUTPUT_DIR = "test-output";

async function main() {
  console.log("Creating test output directory...");
  if (!existsSync(TEST_OUTPUT_DIR)) {
    mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
  }

  console.log("Creating headless renderer...");
  const renderer = await HeadlessRenderer.create(
    640,
    480,
    "wasm/rasterizer.wasm",
    {
      enableVertexSnapping: false,
      enableDithering: false,
    }
  );
  console.log(
    `Renderer created: ${renderer.getDimensions().width}x${
      renderer.getDimensions().height
    }`
  );

  console.log("Creating scene...");
  const cube = new SceneObject("Cube", createCubeMesh());
  cube.position = new Vector3(0, 0, 0);

  const camera = new Camera();
  camera.position = new Vector3(3, -3, 3);
  camera.target = Vector3.zero();

  console.log("Rendering scene...");
  renderer.renderScene([cube], camera);

  console.log("Saving PNG...");
  await renderer.savePNG(`${TEST_OUTPUT_DIR}/headless-cube.png`);
  console.log(`Saved to ${TEST_OUTPUT_DIR}/headless-cube.png`);

  // Verify some pixels were rendered
  const pixels = renderer.getPixelsRaw();
  let nonZeroPixels = 0;
  for (let i = 0; i < pixels.length; i++) {
    if (pixels[i] !== 0) nonZeroPixels++;
  }
  console.log(`Non-zero pixels: ${nonZeroPixels} / ${pixels.length}`);

  // Test multiple objects
  console.log("\nRendering multiple cubes...");
  const cube1 = new SceneObject("Cube1", createCubeMesh());
  cube1.position = new Vector3(-2, 0, 0);

  const cube2 = new SceneObject("Cube2", createCubeMesh());
  cube2.position = new Vector3(2, 0, 0);

  const cube3 = new SceneObject("Cube3", createCubeMesh());
  cube3.position = new Vector3(0, 0, 2);
  cube3.scale = new Vector3(0.5, 0.5, 0.5);

  camera.position = new Vector3(5, -5, 5);
  renderer.renderScene([cube1, cube2, cube3], camera);
  await renderer.savePNG(`${TEST_OUTPUT_DIR}/headless-three-cubes.png`);
  console.log(`Saved to ${TEST_OUTPUT_DIR}/headless-three-cubes.png`);

  // Test with PS1 effects
  console.log("\nRendering with PS1 effects...");
  renderer.setSettings({
    enableVertexSnapping: true,
    enableDithering: true,
    snapResolutionX: 160,
    snapResolutionY: 120,
  });
  renderer.renderScene([cube1, cube2, cube3], camera);
  await renderer.savePNG(`${TEST_OUTPUT_DIR}/headless-ps1-style.png`);
  console.log(`Saved to ${TEST_OUTPUT_DIR}/headless-ps1-style.png`);

  console.log("\n✅ All tests passed!");
}

main().catch(console.error);
