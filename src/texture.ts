import { Color } from "./math";

/**
 * Texture class for storing and sampling image data
 */
export class Texture {
  private data: Uint8ClampedArray;
  public width: number;
  public height: number;
  public loaded: boolean = false;

  constructor(width: number = 1, height: number = 1) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
    // Default to white
    this.data.fill(255);
  }

  /**
   * Load texture from an image URL
   */
  static async load(url: string): Promise<Texture> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";

      img.onload = () => {
        const texture = new Texture(img.width, img.height);

        // Draw image to canvas to get pixel data
        const canvas = new OffscreenCanvas(img.width, img.height);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        texture.data = imageData.data;
        texture.loaded = true;

        resolve(texture);
      };

      img.onerror = () => {
        console.warn(`Failed to load texture: ${url}`);
        // Return a default texture
        const texture = new Texture(2, 2);
        // Create a checkerboard pattern for missing texture
        texture.setPixel(0, 0, new Color(255, 0, 255)); // Magenta
        texture.setPixel(1, 0, new Color(0, 0, 0)); // Black
        texture.setPixel(0, 1, new Color(0, 0, 0)); // Black
        texture.setPixel(1, 1, new Color(255, 0, 255)); // Magenta
        texture.loaded = true;
        resolve(texture);
      };

      img.src = url;
    });
  }

  /**
   * Get the raw pixel data buffer (for WASM upload)
   */
  getData(): Uint8ClampedArray {
    return this.data;
  }

  /**
   * Set a pixel in the texture
   */
  setPixel(x: number, y: number, color: Color): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const index = (y * this.width + x) * 4;
    this.data[index] = color.r;
    this.data[index + 1] = color.g;
    this.data[index + 2] = color.b;
    this.data[index + 3] = color.a;
  }

  /**
   * Get a pixel from the texture
   */
  getPixel(x: number, y: number): Color {
    x = Math.floor(x);
    y = Math.floor(y);

    // Wrap coordinates
    x = ((x % this.width) + this.width) % this.width;
    y = ((y % this.height) + this.height) % this.height;

    const index = (y * this.width + x) * 4;
    return new Color(
      this.data[index],
      this.data[index + 1],
      this.data[index + 2],
      this.data[index + 3]
    );
  }

  /**
   * Sample texture at UV coordinates (0-1 range) with nearest-neighbor filtering
   * PS1 used nearest-neighbor (no bilinear filtering)
   */
  sample(u: number, v: number): Color {
    // Wrap UV coordinates
    u = u - Math.floor(u);
    v = v - Math.floor(v);

    // Convert to pixel coordinates
    const x = (u * this.width) | 0;
    const y = ((1 - v) * this.height) | 0; // Flip V (OpenGL convention)

    // Wrap coordinates
    const wx = ((x % this.width) + this.width) % this.width;
    const wy = ((y % this.height) + this.height) % this.height;

    const index = (wy * this.width + wx) * 4;
    return new Color(
      this.data[index],
      this.data[index + 1],
      this.data[index + 2],
      this.data[index + 3]
    );
  }

  /**
   * Fast texture sampling that writes directly to output array (avoids object allocation)
   * Returns [r, g, b] in the provided output array
   */
  sampleFast(u: number, v: number, out: number[]): void {
    // Wrap UV coordinates
    u = u - Math.floor(u);
    v = v - Math.floor(v);

    // Convert to pixel coordinates
    const x = (u * this.width) | 0;
    const y = ((1 - v) * this.height) | 0;

    // Wrap coordinates (branchless for common case)
    const wx =
      x >= 0 && x < this.width
        ? x
        : ((x % this.width) + this.width) % this.width;
    const wy =
      y >= 0 && y < this.height
        ? y
        : ((y % this.height) + this.height) % this.height;

    const index = (wy * this.width + wx) * 4;
    out[0] = this.data[index];
    out[1] = this.data[index + 1];
    out[2] = this.data[index + 2];
  }

  /**
   * Sample texture with bilinear filtering (optional, not PS1-authentic)
   */
  sampleBilinear(u: number, v: number): Color {
    // Wrap UV coordinates
    u = u - Math.floor(u);
    v = 1 - (v - Math.floor(v)); // Flip V

    // Convert to pixel coordinates
    const x = u * this.width - 0.5;
    const y = v * this.height - 0.5;

    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;

    const fx = x - x0;
    const fy = y - y0;

    const c00 = this.getPixel(x0, y0);
    const c10 = this.getPixel(x1, y0);
    const c01 = this.getPixel(x0, y1);
    const c11 = this.getPixel(x1, y1);

    // Bilinear interpolation
    const r =
      (c00.r * (1 - fx) + c10.r * fx) * (1 - fy) +
      (c01.r * (1 - fx) + c11.r * fx) * fy;
    const g =
      (c00.g * (1 - fx) + c10.g * fx) * (1 - fy) +
      (c01.g * (1 - fx) + c11.g * fx) * fy;
    const b =
      (c00.b * (1 - fx) + c10.b * fx) * (1 - fy) +
      (c01.b * (1 - fx) + c11.b * fx) * fy;
    const a =
      (c00.a * (1 - fx) + c10.a * fx) * (1 - fy) +
      (c01.a * (1 - fx) + c11.a * fx) * fy;

    return new Color(
      Math.floor(r),
      Math.floor(g),
      Math.floor(b),
      Math.floor(a)
    );
  }

  /**
   * Create a solid color texture
   */
  static createSolid(
    color: Color,
    width: number = 1,
    height: number = 1
  ): Texture {
    const texture = new Texture(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        texture.setPixel(x, y, color);
      }
    }
    texture.loaded = true;
    return texture;
  }
}

/**
 * Material class for storing surface properties
 */
export class Material {
  public name: string;
  public diffuseColor: Color = Color.white();
  public diffuseTexture: Texture | null = null;
  public ambientColor: Color = new Color(50, 50, 50);
  public specularColor: Color = Color.white();
  public shininess: number = 32;
  public opacity: number = 1;

  constructor(name: string = "default") {
    this.name = name;
  }
}

/**
 * MTL file parser
 */
export class MTLLoader {
  /**
   * Parse MTL file content
   */
  static parse(mtlContent: string): Map<string, Material> {
    const materials = new Map<string, Material>();
    let currentMaterial: Material | null = null;

    const lines = mtlContent.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

      const parts = trimmed.split(/\s+/);
      const command = parts[0];

      switch (command) {
        case "newmtl":
          currentMaterial = new Material(parts[1] || "unnamed");
          materials.set(currentMaterial.name, currentMaterial);
          break;

        case "Kd": // Diffuse color
          if (currentMaterial) {
            currentMaterial.diffuseColor = new Color(
              Math.floor(parseFloat(parts[1]) * 255),
              Math.floor(parseFloat(parts[2]) * 255),
              Math.floor(parseFloat(parts[3]) * 255)
            );
          }
          break;

        case "Ka": // Ambient color
          if (currentMaterial) {
            currentMaterial.ambientColor = new Color(
              Math.floor(parseFloat(parts[1]) * 255),
              Math.floor(parseFloat(parts[2]) * 255),
              Math.floor(parseFloat(parts[3]) * 255)
            );
          }
          break;

        case "Ks": // Specular color
          if (currentMaterial) {
            currentMaterial.specularColor = new Color(
              Math.floor(parseFloat(parts[1]) * 255),
              Math.floor(parseFloat(parts[2]) * 255),
              Math.floor(parseFloat(parts[3]) * 255)
            );
          }
          break;

        case "Ns": // Shininess
          if (currentMaterial) {
            currentMaterial.shininess = parseFloat(parts[1]) || 32;
          }
          break;

        case "d": // Opacity
        case "Tr": // Transparency (inverted)
          if (currentMaterial) {
            const value = parseFloat(parts[1]) || 1;
            currentMaterial.opacity = command === "Tr" ? 1 - value : value;
          }
          break;

        case "map_Kd": // Diffuse texture map
          if (currentMaterial) {
            // Store texture path - will be loaded separately
            (currentMaterial as any).diffuseTexturePath = parts
              .slice(1)
              .join(" ");
          }
          break;
      }
    }

    return materials;
  }

  /**
   * Load MTL file and textures from URL
   */
  static async load(
    url: string,
    baseUrl: string = ""
  ): Promise<Map<string, Material>> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load MTL: ${response.statusText}`);
      }
      const content = await response.text();
      const materials = MTLLoader.parse(content);

      // Determine base URL for textures
      let textureBaseUrl = baseUrl;
      if (!textureBaseUrl) {
        const lastSlash = url.lastIndexOf("/");
        textureBaseUrl = lastSlash >= 0 ? url.substring(0, lastSlash + 1) : "";
      }

      // Load textures
      for (const [name, material] of materials) {
        const texturePath = (material as any).diffuseTexturePath;
        if (texturePath) {
          const textureUrl = texturePath.startsWith("http")
            ? texturePath
            : textureBaseUrl + texturePath;
          material.diffuseTexture = await Texture.load(textureUrl);
        }
      }

      return materials;
    } catch (error) {
      console.warn(`Could not load MTL file: ${error}`);
      return new Map();
    }
  }
}
