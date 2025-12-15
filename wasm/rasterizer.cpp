/**
 * PS1-Style Software Rasterizer - WebAssembly SIMD Implementation
 *
 * Features:
 * - SIMD-accelerated triangle rasterization (4 pixels at a time)
 * - 16-bit depth buffer (PS1 style)
 * - Gouraud shading
 * - Affine texture mapping with PS1-style warping
 * - Ordered dithering (8x8 Bayer matrix)
 * - Vertex snapping
 * - Backface culling
 *
 * Build with Emscripten:
 *   emcc -O3 -msimd128 -s WASM=1 -s STANDALONE_WASM=1 --no-entry \
 *     -o rasterizer.wasm rasterizer.cpp
 */

#include <cstdint>
#include <cmath>
#include <wasm_simd128.h>
#include <emscripten.h>

// ============================================================================
// Configuration
// ============================================================================

// Maximum supported resolution (allocate buffers for this size)
constexpr int MAX_RENDER_WIDTH = 1920;
constexpr int MAX_RENDER_HEIGHT = 1200;
constexpr int MAX_PIXEL_COUNT = MAX_RENDER_WIDTH * MAX_RENDER_HEIGHT;
constexpr int MAX_VERTICES = 65536;
constexpr int MAX_INDICES = 65536 * 3;
constexpr int MAX_TRIANGLES = 65536;
constexpr int MAX_TEXTURES = 16;
constexpr int MAX_TEXTURE_SIZE = 512 * 512 * 4;

// ============================================================================
// Memory Layout (Shared with JavaScript)
// ============================================================================

extern "C"
{

    // Current render resolution (set by JS)
    int32_t g_render_width = 640;
    int32_t g_render_height = 480;
    int32_t g_pixel_count = 640 * 480;

    // Output buffers (read by JS) - sized for max resolution
    alignas(16) uint32_t g_pixels[MAX_PIXEL_COUNT];
    alignas(16) uint16_t g_depth[MAX_PIXEL_COUNT];

    // Vertex data (written by JS)
    // Format per vertex: x, y, z, nx, ny, nz, u, v, r, g, b, a (12 floats)
    alignas(16) float g_vertices[MAX_VERTICES * 12];
    alignas(16) uint32_t g_indices[MAX_INDICES];

    // Texture data (written by JS)
    alignas(16) uint8_t g_textures[MAX_TEXTURES][MAX_TEXTURE_SIZE];
    alignas(16) int32_t g_texture_sizes[MAX_TEXTURES * 2]; // width, height pairs

    // Transform matrices (written by JS)
    alignas(16) float g_mvp_matrix[16];
    alignas(16) float g_model_matrix[16];
    alignas(16) float g_view_matrix[16];

    // Light data (written by JS)
    alignas(16) float g_light_dir[4];   // xyz, padding
    alignas(16) float g_light_color[4]; // rgb, intensity

    // Settings (written by JS)
    int32_t g_vertex_count = 0;
    int32_t g_index_count = 0;
    int32_t g_current_texture = -1;
    float g_ambient_light = 0.2f;
    int32_t g_enable_lighting = 1;
    int32_t g_enable_dithering = 1;
    int32_t g_enable_texturing = 1;
    int32_t g_enable_backface_culling = 1;
    int32_t g_enable_vertex_snapping = 1;
    int32_t g_enable_smooth_shading = 0;
    float g_snap_resolution_x = 320.0f;
    float g_snap_resolution_y = 240.0f;

} // extern "C"

// ============================================================================
// 8x8 Bayer Dither Matrix
// ============================================================================

alignas(16) static const int8_t DITHER_MATRIX[8][8] = {
    {0, 32, 8, 40, 2, 34, 10, 42},
    {48, 16, 56, 24, 50, 18, 58, 26},
    {12, 44, 4, 36, 14, 46, 6, 38},
    {60, 28, 52, 20, 62, 30, 54, 22},
    {3, 35, 11, 43, 1, 33, 9, 41},
    {51, 19, 59, 27, 49, 17, 57, 25},
    {15, 47, 7, 39, 13, 45, 5, 37},
    {63, 31, 55, 23, 61, 29, 53, 21}};

// ============================================================================
// Math Utilities
// ============================================================================

struct Vec3
{
    float x, y, z;

    Vec3() : x(0), y(0), z(0) {}
    Vec3(float x_, float y_, float z_) : x(x_), y(y_), z(z_) {}

    Vec3 operator+(const Vec3 &v) const { return Vec3(x + v.x, y + v.y, z + v.z); }
    Vec3 operator-(const Vec3 &v) const { return Vec3(x - v.x, y - v.y, z - v.z); }
    Vec3 operator*(float s) const { return Vec3(x * s, y * s, z * s); }

    float dot(const Vec3 &v) const { return x * v.x + y * v.y + z * v.z; }

    Vec3 cross(const Vec3 &v) const
    {
        return Vec3(
            y * v.z - z * v.y,
            z * v.x - x * v.z,
            x * v.y - y * v.x);
    }

    float length() const { return sqrtf(x * x + y * y + z * z); }

    Vec3 normalize() const
    {
        float len = length();
        if (len < 0.0001f)
            return Vec3();
        return *this * (1.0f / len);
    }
};

struct Vec4
{
    float x, y, z, w;

    Vec4() : x(0), y(0), z(0), w(1) {}
    Vec4(float x_, float y_, float z_, float w_) : x(x_), y(y_), z(z_), w(w_) {}

    Vec3 perspectiveDivide() const
    {
        if (fabsf(w) < 0.0001f)
            return Vec3(x, y, z);
        float inv = 1.0f / w;
        return Vec3(x * inv, y * inv, z * inv);
    }
};

// Matrix-vector multiply (row-major order to match JavaScript)
inline Vec4 mat4_mul_vec4(const float *m, const Vec4 &v)
{
    return Vec4(
        m[0] * v.x + m[1] * v.y + m[2] * v.z + m[3] * v.w,
        m[4] * v.x + m[5] * v.y + m[6] * v.z + m[7] * v.w,
        m[8] * v.x + m[9] * v.y + m[10] * v.z + m[11] * v.w,
        m[12] * v.x + m[13] * v.y + m[14] * v.z + m[15] * v.w);
}

// Transform direction (ignores translation, row-major)
inline Vec3 mat4_mul_dir(const float *m, const Vec3 &v)
{
    return Vec3(
        m[0] * v.x + m[1] * v.y + m[2] * v.z,
        m[4] * v.x + m[5] * v.y + m[6] * v.z,
        m[8] * v.x + m[9] * v.y + m[10] * v.z);
}

inline float clamp(float v, float lo, float hi)
{
    return v < lo ? lo : (v > hi ? hi : v);
}

inline int32_t min3(int32_t a, int32_t b, int32_t c)
{
    return a < b ? (a < c ? a : c) : (b < c ? b : c);
}

inline int32_t max3(int32_t a, int32_t b, int32_t c)
{
    return a > b ? (a > c ? a : c) : (b > c ? b : c);
}

inline float min3f(float a, float b, float c)
{
    return a < b ? (a < c ? a : c) : (b < c ? b : c);
}

inline float max3f(float a, float b, float c)
{
    return a > b ? (a > c ? a : c) : (b > c ? b : c);
}

// ============================================================================
// Processed Vertex (after MVP transform)
// ============================================================================

struct ProcessedVertex
{
    Vec3 screen;   // Screen-space position
    Vec3 world;    // World-space position (for lighting)
    Vec3 normal;   // World-space normal
    float depth;   // NDC depth [-1, 1]
    float u, v;    // Texture coordinates
    float r, g, b; // Vertex color (0-255)
    float affine;  // Affine texture factor
    float light;   // Pre-computed lighting
};

// ============================================================================
// SIMD Helpers
// ============================================================================

// Load 4 floats into a SIMD register
inline v128_t simd_load4f(float a, float b, float c, float d)
{
    return wasm_f32x4_make(a, b, c, d);
}

// Horizontal min of 4 floats
inline float simd_hmin(v128_t v)
{
    v128_t min1 = wasm_f32x4_pmin(v, wasm_i32x4_shuffle(v, v, 2, 3, 0, 1));
    v128_t min2 = wasm_f32x4_pmin(min1, wasm_i32x4_shuffle(min1, min1, 1, 0, 3, 2));
    return wasm_f32x4_extract_lane(min2, 0);
}

// ============================================================================
// Core Rasterization
// ============================================================================

// Process a single vertex through MVP pipeline
static ProcessedVertex process_vertex(int vertex_idx)
{
    const float *v = &g_vertices[vertex_idx * 12];

    Vec4 pos(v[0], v[1], v[2], 1.0f);
    Vec3 normal(v[3], v[4], v[5]);
    float u = v[6], vt = v[7];
    float r = v[8], g = v[9], b = v[10];

    // Transform through MVP
    Vec4 clip = mat4_mul_vec4(g_mvp_matrix, pos);

    // Perspective divide
    Vec3 ndc = clip.perspectiveDivide();

    // PS1-style vertex snapping
    if (g_enable_vertex_snapping)
    {
        ndc.x = floorf(ndc.x * g_snap_resolution_x) / g_snap_resolution_x;
        ndc.y = floorf(ndc.y * g_snap_resolution_y) / g_snap_resolution_y;
    }

    // Viewport transform (NDC to screen) - use runtime resolution
    float screenX = (ndc.x + 1.0f) * 0.5f * (float)g_render_width;
    float screenY = (1.0f - ndc.y) * 0.5f * (float)g_render_height;

    // World-space normal for lighting
    Vec3 worldNormal = mat4_mul_dir(g_model_matrix, normal).normalize();

    // World-space position
    Vec4 worldPos = mat4_mul_vec4(g_model_matrix, pos);

    // PS1-style affine factor
    float dist = fmaxf(0.001f, clip.w);
    float affine = dist + (clip.w * 8.0f / dist) * 0.5f;

    // Pre-compute lighting
    float light = 1.0f;
    if (g_enable_lighting)
    {
        Vec3 lightDir(g_light_dir[0], g_light_dir[1], g_light_dir[2]);
        float ndotl = fmaxf(0.0f, -worldNormal.dot(lightDir));
        light = fminf(1.0f, g_ambient_light + ndotl * g_light_color[3]);
    }

    ProcessedVertex pv;
    pv.screen = Vec3(screenX, screenY, ndc.z);
    pv.world = Vec3(worldPos.x, worldPos.y, worldPos.z);
    pv.normal = worldNormal;
    pv.depth = ndc.z;
    pv.u = u * affine; // Pre-multiply for affine
    pv.v = vt * affine;
    pv.r = r;
    pv.g = g;
    pv.b = b;
    pv.affine = affine;
    pv.light = light;

    return pv;
}

// Rasterize a single triangle with SIMD acceleration
static void rasterize_triangle(
    const ProcessedVertex &v0,
    const ProcessedVertex &v1,
    const ProcessedVertex &v2)
{
    // Bounding box (integer) - use runtime resolution
    int32_t minX = max3(0, (int32_t)min3f(v0.screen.x, v1.screen.x, v2.screen.x), 0);
    int32_t maxX = min3((int32_t)max3f(v0.screen.x, v1.screen.x, v2.screen.x) + 1,
                        g_render_width - 1, g_render_width - 1);
    int32_t minY = max3(0, (int32_t)min3f(v0.screen.y, v1.screen.y, v2.screen.y), 0);
    int32_t maxY = min3((int32_t)max3f(v0.screen.y, v1.screen.y, v2.screen.y) + 1,
                        g_render_height - 1, g_render_height - 1);

    // Early reject
    if (minX > maxX || minY > maxY)
        return;

    // Cache screen positions
    float x0 = v0.screen.x, y0 = v0.screen.y;
    float x1 = v1.screen.x, y1 = v1.screen.y;
    float x2 = v2.screen.x, y2 = v2.screen.y;

    // Edge function coefficients
    float A01 = y0 - y1, B01 = x1 - x0;
    float A12 = y1 - y2, B12 = x2 - x1;
    float A20 = y2 - y0, B20 = x0 - x2;

    // Triangle area * 2
    float area = A01 * (x2 - x0) + B01 * (y2 - y0);
    if (fabsf(area) < 0.0001f)
        return; // Degenerate
    float invArea = 1.0f / area;

    // Starting point
    float px = minX + 0.5f;
    float py = minY + 0.5f;

    // Initial edge values
    float w0_row = A12 * (px - x1) + B12 * (py - y1);
    float w1_row = A20 * (px - x2) + B20 * (py - y2);
    float w2_row = A01 * (px - x0) + B01 * (py - y0);

    // Pre-multiply colors with lighting
    float r0 = v0.r * v0.light, g0 = v0.g * v0.light, b0 = v0.b * v0.light;
    float r1 = v1.r * v1.light, g1 = v1.g * v1.light, b1 = v1.b * v1.light;
    float r2 = v2.r * v2.light, g2 = v2.g * v2.light, b2 = v2.b * v2.light;

    // Texture info
    int32_t texIdx = g_current_texture;
    const uint8_t *texData = nullptr;
    int32_t texW = 0, texH = 0;
    if (g_enable_texturing && texIdx >= 0 && texIdx < MAX_TEXTURES)
    {
        texData = g_textures[texIdx];
        texW = g_texture_sizes[texIdx * 2];
        texH = g_texture_sizes[texIdx * 2 + 1];
    }

    // SIMD setup for processing 4 pixels at a time
    v128_t simd_A12 = wasm_f32x4_splat(A12);
    v128_t simd_A20 = wasm_f32x4_splat(A20);
    v128_t simd_A01 = wasm_f32x4_splat(A01);
    v128_t simd_offset = wasm_f32x4_make(0.0f, A12, A12 * 2.0f, A12 * 3.0f);
    v128_t simd_offset1 = wasm_f32x4_make(0.0f, A20, A20 * 2.0f, A20 * 3.0f);
    v128_t simd_offset2 = wasm_f32x4_make(0.0f, A01, A01 * 2.0f, A01 * 3.0f);
    v128_t simd_step = wasm_f32x4_splat(A12 * 4.0f);
    v128_t simd_step1 = wasm_f32x4_splat(A20 * 4.0f);
    v128_t simd_step2 = wasm_f32x4_splat(A01 * 4.0f);
    v128_t simd_zero = wasm_f32x4_splat(0.0f);
    v128_t simd_invArea = wasm_f32x4_splat(invArea);

    // Scan rows
    for (int32_t y = minY; y <= maxY; y++)
    {
        float w0 = w0_row;
        float w1 = w1_row;
        float w2 = w2_row;
        int32_t yOffset = y * g_render_width;

        // Process 4 pixels at a time with SIMD
        int32_t x = minX;

        // SIMD loop (4 pixels at a time)
        for (; x + 3 <= maxX; x += 4)
        {
            // Edge values for 4 pixels
            v128_t sw0 = wasm_f32x4_add(wasm_f32x4_splat(w0), simd_offset);
            v128_t sw1 = wasm_f32x4_add(wasm_f32x4_splat(w1), simd_offset1);
            v128_t sw2 = wasm_f32x4_add(wasm_f32x4_splat(w2), simd_offset2);

            // Check if all 4 pixels are inside (all positive or all negative)
            v128_t ge0_w0 = wasm_f32x4_ge(sw0, simd_zero);
            v128_t ge0_w1 = wasm_f32x4_ge(sw1, simd_zero);
            v128_t ge0_w2 = wasm_f32x4_ge(sw2, simd_zero);
            v128_t le0_w0 = wasm_f32x4_le(sw0, simd_zero);
            v128_t le0_w1 = wasm_f32x4_le(sw1, simd_zero);
            v128_t le0_w2 = wasm_f32x4_le(sw2, simd_zero);

            v128_t inside_pos = wasm_v128_and(wasm_v128_and(ge0_w0, ge0_w1), ge0_w2);
            v128_t inside_neg = wasm_v128_and(wasm_v128_and(le0_w0, le0_w1), le0_w2);
            v128_t inside = wasm_v128_or(inside_pos, inside_neg);

            // If any pixel is inside, process them using scalar code
            // (SIMD is used for early-out check only)
            if (wasm_v128_any_true(inside))
            {
                // Process 4 pixels with unrolled scalar code
                // (wasm_f32x4_extract_lane requires compile-time constant)
                float pw0_arr[4], pw1_arr[4], pw2_arr[4];
                wasm_v128_store(pw0_arr, sw0);
                wasm_v128_store(pw1_arr, sw1);
                wasm_v128_store(pw2_arr, sw2);

                for (int i = 0; i < 4 && x + i <= maxX; i++)
                {
                    float pw0 = pw0_arr[i];
                    float pw1 = pw1_arr[i];
                    float pw2 = pw2_arr[i];

                    // Inside test
                    bool isInside = (pw0 >= 0 && pw1 >= 0 && pw2 >= 0) ||
                                    (pw0 <= 0 && pw1 <= 0 && pw2 <= 0);
                    if (!isInside)
                        continue;

                    float pbw0 = pw0 * invArea;
                    float pbw1 = pw1 * invArea;
                    float pbw2 = pw2 * invArea;

                    // Interpolate depth
                    float depthF = v0.depth * pbw0 + v1.depth * pbw1 + v2.depth * pbw2;
                    uint16_t depth = (uint16_t)((depthF + 1.0f) * 32767.5f);

                    int32_t idx = yOffset + x + i;

                    // Depth test
                    if (depth >= g_depth[idx])
                        continue;

                    // Interpolate color
                    float cr, cg, cb;

                    if (texData && texW > 0 && texH > 0)
                    {
                        // Texture sampling with affine correction
                        float uAffine = v0.u * pbw0 + v1.u * pbw1 + v2.u * pbw2;
                        float vAffine = v0.v * pbw0 + v1.v * pbw1 + v2.v * pbw2;
                        float affine = v0.affine * pbw0 + v1.affine * pbw1 + v2.affine * pbw2;

                        float tu = uAffine / affine;
                        float tv = vAffine / affine;

                        // Wrap
                        tu = tu - floorf(tu);
                        tv = tv - floorf(tv);

                        int32_t tx = (int32_t)(tu * texW);
                        int32_t ty = (int32_t)((1.0f - tv) * texH);
                        tx = ((tx % texW) + texW) % texW;
                        ty = ((ty % texH) + texH) % texH;

                        int32_t texOffset = (ty * texW + tx) * 4;
                        float texR = texData[texOffset];
                        float texG = texData[texOffset + 1];
                        float texB = texData[texOffset + 2];

                        // Modulate with vertex colors
                        float litR = r0 * pbw0 + r1 * pbw1 + r2 * pbw2;
                        float litG = g0 * pbw0 + g1 * pbw1 + g2 * pbw2;
                        float litB = b0 * pbw0 + b1 * pbw1 + b2 * pbw2;

                        cr = texR * litR / 255.0f;
                        cg = texG * litG / 255.0f;
                        cb = texB * litB / 255.0f;
                    }
                    else
                    {
                        // Gouraud shading only
                        cr = r0 * pbw0 + r1 * pbw1 + r2 * pbw2;
                        cg = g0 * pbw0 + g1 * pbw1 + g2 * pbw2;
                        cb = b0 * pbw0 + b1 * pbw1 + b2 * pbw2;
                    }

                    // Dithering
                    if (g_enable_dithering)
                    {
                        int32_t ix = (x + i) & 7;
                        int32_t iy = y & 7;
                        int32_t threshold = DITHER_MATRIX[iy][ix];
                        int32_t ditherAmt = (threshold - 32) >> 2;

                        cr = (float)(((int32_t)(cr + ditherAmt) >> 3) << 3);
                        cg = (float)(((int32_t)(cg + ditherAmt) >> 3) << 3);
                        cb = (float)(((int32_t)(cb + ditherAmt) >> 3) << 3);

                        cr = clamp(cr, 0.0f, 255.0f);
                        cg = clamp(cg, 0.0f, 255.0f);
                        cb = clamp(cb, 0.0f, 255.0f);
                    }
                    else
                    {
                        cr = fminf(255.0f, cr);
                        cg = fminf(255.0f, cg);
                        cb = fminf(255.0f, cb);
                    }

                    // Write pixel (ABGR format)
                    g_depth[idx] = depth;
                    g_pixels[idx] = 0xFF000000 |
                                    ((uint32_t)cb << 16) |
                                    ((uint32_t)cg << 8) |
                                    (uint32_t)cr;
                }
            }

            w0 += A12 * 4.0f;
            w1 += A20 * 4.0f;
            w2 += A01 * 4.0f;
        }

        // Scalar tail for remaining pixels
        for (; x <= maxX; x++)
        {
            // Inside test
            if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0))
            {
                float bw0 = w0 * invArea;
                float bw1 = w1 * invArea;
                float bw2 = w2 * invArea;

                // Depth
                float depthF = v0.depth * bw0 + v1.depth * bw1 + v2.depth * bw2;
                uint16_t depth = (uint16_t)((depthF + 1.0f) * 32767.5f);

                int32_t idx = yOffset + x;
                if (depth < g_depth[idx])
                {
                    float cr, cg, cb;

                    if (texData && texW > 0 && texH > 0)
                    {
                        float uAffine = v0.u * bw0 + v1.u * bw1 + v2.u * bw2;
                        float vAffine = v0.v * bw0 + v1.v * bw1 + v2.v * bw2;
                        float affine = v0.affine * bw0 + v1.affine * bw1 + v2.affine * bw2;

                        float tu = uAffine / affine;
                        float tv = vAffine / affine;
                        tu = tu - floorf(tu);
                        tv = tv - floorf(tv);

                        int32_t tx = (int32_t)(tu * texW);
                        int32_t ty = (int32_t)((1.0f - tv) * texH);
                        tx = ((tx % texW) + texW) % texW;
                        ty = ((ty % texH) + texH) % texH;

                        int32_t texOffset = (ty * texW + tx) * 4;
                        float texR = texData[texOffset];
                        float texG = texData[texOffset + 1];
                        float texB = texData[texOffset + 2];

                        float litR = r0 * bw0 + r1 * bw1 + r2 * bw2;
                        float litG = g0 * bw0 + g1 * bw1 + g2 * bw2;
                        float litB = b0 * bw0 + b1 * bw1 + b2 * bw2;

                        cr = texR * litR / 255.0f;
                        cg = texG * litG / 255.0f;
                        cb = texB * litB / 255.0f;
                    }
                    else
                    {
                        cr = r0 * bw0 + r1 * bw1 + r2 * bw2;
                        cg = g0 * bw0 + g1 * bw1 + g2 * bw2;
                        cb = b0 * bw0 + b1 * bw1 + b2 * bw2;
                    }

                    if (g_enable_dithering)
                    {
                        int32_t ix = x & 7;
                        int32_t iy = y & 7;
                        int32_t threshold = DITHER_MATRIX[iy][ix];
                        int32_t ditherAmt = (threshold - 32) >> 2;

                        cr = (float)(((int32_t)(cr + ditherAmt) >> 3) << 3);
                        cg = (float)(((int32_t)(cg + ditherAmt) >> 3) << 3);
                        cb = (float)(((int32_t)(cb + ditherAmt) >> 3) << 3);

                        cr = clamp(cr, 0.0f, 255.0f);
                        cg = clamp(cg, 0.0f, 255.0f);
                        cb = clamp(cb, 0.0f, 255.0f);
                    }
                    else
                    {
                        cr = fminf(255.0f, cr);
                        cg = fminf(255.0f, cg);
                        cb = fminf(255.0f, cb);
                    }

                    g_depth[idx] = depth;
                    g_pixels[idx] = 0xFF000000 |
                                    ((uint32_t)cb << 16) |
                                    ((uint32_t)cg << 8) |
                                    (uint32_t)cr;
                }
            }

            w0 += A12;
            w1 += A20;
            w2 += A01;
        }

        w0_row += B12;
        w1_row += B20;
        w2_row += B01;
    }
}

// ============================================================================
// Exported API
// ============================================================================

extern "C"
{

    // Set render resolution (must be called before rendering)
    EMSCRIPTEN_KEEPALIVE
    void set_render_resolution(int32_t width, int32_t height)
    {
        // Clamp to max supported resolution
        if (width > MAX_RENDER_WIDTH)
            width = MAX_RENDER_WIDTH;
        if (height > MAX_RENDER_HEIGHT)
            height = MAX_RENDER_HEIGHT;
        if (width < 1)
            width = 1;
        if (height < 1)
            height = 1;

        g_render_width = width;
        g_render_height = height;
        g_pixel_count = width * height;
    }

    // Get current render width
    EMSCRIPTEN_KEEPALIVE
    int32_t get_render_width()
    {
        return g_render_width;
    }

    // Get current render height
    EMSCRIPTEN_KEEPALIVE
    int32_t get_render_height()
    {
        return g_render_height;
    }

    // Get current pixel count
    EMSCRIPTEN_KEEPALIVE
    int32_t get_pixel_count()
    {
        return g_pixel_count;
    }

    // Clear framebuffer and depth buffer
    EMSCRIPTEN_KEEPALIVE
    void clear(uint8_t r, uint8_t g, uint8_t b)
    {
        uint32_t color = 0xFF000000 | ((uint32_t)b << 16) | ((uint32_t)g << 8) | r;

        // SIMD clear (16 pixels at a time) - use runtime pixel count
        v128_t simd_color = wasm_i32x4_splat(color);
        v128_t simd_depth = wasm_i16x8_splat(0xFFFF);

        uint32_t *pixels = g_pixels;
        uint16_t *depth = g_depth;

        // Clear only the active portion of buffers
        int32_t pixel_count = g_pixel_count;

        // SIMD loop (16 pixels at a time)
        int32_t i = 0;
        for (; i + 15 < pixel_count; i += 16)
        {
            wasm_v128_store(pixels + i, simd_color);
            wasm_v128_store(pixels + i + 4, simd_color);
            wasm_v128_store(pixels + i + 8, simd_color);
            wasm_v128_store(pixels + i + 12, simd_color);
            wasm_v128_store(depth + i, simd_depth);
            wasm_v128_store(depth + i + 8, simd_depth);
        }
        // Handle remaining pixels
        for (; i < pixel_count; i++)
        {
            pixels[i] = color;
            depth[i] = 0xFFFF;
        }
    }

    // Render all triangles
    EMSCRIPTEN_KEEPALIVE
    void render_triangles()
    {
        int32_t numTriangles = g_index_count / 3;

        for (int32_t t = 0; t < numTriangles; t++)
        {
            uint32_t i0 = g_indices[t * 3];
            uint32_t i1 = g_indices[t * 3 + 1];
            uint32_t i2 = g_indices[t * 3 + 2];

            // Process vertices
            ProcessedVertex v0 = process_vertex(i0);
            ProcessedVertex v1 = process_vertex(i1);
            ProcessedVertex v2 = process_vertex(i2);

            // Near-plane clipping (PS1 style - reject if any vertex behind camera)
            if (v0.depth < -1.0f || v1.depth < -1.0f || v2.depth < -1.0f)
                continue;
            if (v0.depth > 1.0f || v1.depth > 1.0f || v2.depth > 1.0f)
                continue;

            // Check if backfacing
            Vec3 edge1 = v1.screen - v0.screen;
            Vec3 edge2 = v2.screen - v0.screen;
            float cross_z = edge1.x * edge2.y - edge1.y * edge2.x;
            bool isBackfacing = cross_z >= 0;

            // Lighting calculation
            if (g_enable_lighting)
            {
                if (g_enable_smooth_shading)
                {
                    // Smooth (Gouraud) shading: use per-vertex normals
                    // Flip normals for backfaces (double-sided rendering)
                    if (isBackfacing)
                    {
                        v0.normal = v0.normal * -1.0f;
                        v1.normal = v1.normal * -1.0f;
                        v2.normal = v2.normal * -1.0f;
                    }

                    // Recalculate per-vertex lighting
                    Vec3 lightDir(g_light_dir[0], g_light_dir[1], g_light_dir[2]);
                    float ndotl0 = fmaxf(0.0f, -v0.normal.dot(lightDir));
                    float ndotl1 = fmaxf(0.0f, -v1.normal.dot(lightDir));
                    float ndotl2 = fmaxf(0.0f, -v2.normal.dot(lightDir));
                    v0.light = fminf(1.0f, g_ambient_light + ndotl0 * g_light_color[3]);
                    v1.light = fminf(1.0f, g_ambient_light + ndotl1 * g_light_color[3]);
                    v2.light = fminf(1.0f, g_ambient_light + ndotl2 * g_light_color[3]);
                }
                else
                {
                    // Flat shading: compute face normal from world positions
                    Vec3 worldEdge1 = v1.world - v0.world;
                    Vec3 worldEdge2 = v2.world - v0.world;
                    Vec3 faceNormal = worldEdge1.cross(worldEdge2).normalize();

                    // Flip normal for backfaces (double-sided rendering)
                    if (isBackfacing)
                    {
                        faceNormal = faceNormal * -1.0f;
                    }

                    // Calculate single light value for entire face
                    Vec3 lightDir(g_light_dir[0], g_light_dir[1], g_light_dir[2]);
                    float ndotl = fmaxf(0.0f, -faceNormal.dot(lightDir));
                    float faceLight = fminf(1.0f, g_ambient_light + ndotl * g_light_color[3]);

                    // Apply same light to all vertices (flat shading)
                    v0.light = faceLight;
                    v1.light = faceLight;
                    v2.light = faceLight;
                }
            }

            // Rasterize
            rasterize_triangle(v0, v1, v2);
        }
    }

    // Draw a single line (for wireframe/overlays)
    EMSCRIPTEN_KEEPALIVE
    void draw_line(float x0, float y0, float x1, float y1,
                   uint8_t r, uint8_t g, uint8_t b, uint16_t depth_value)
    {
        uint32_t color = 0xFF000000 | ((uint32_t)b << 16) | ((uint32_t)g << 8) | r;

        int32_t ix0 = (int32_t)x0;
        int32_t iy0 = (int32_t)y0;
        int32_t ix1 = (int32_t)x1;
        int32_t iy1 = (int32_t)y1;

        int32_t dx = ix1 > ix0 ? ix1 - ix0 : ix0 - ix1;
        int32_t dy = iy1 > iy0 ? iy0 - iy1 : iy1 - iy0;
        int32_t sx = ix0 < ix1 ? 1 : -1;
        int32_t sy = iy0 < iy1 ? 1 : -1;
        int32_t err = dx + dy;

        while (true)
        {
            if (ix0 >= 0 && ix0 < g_render_width && iy0 >= 0 && iy0 < g_render_height)
            {
                int32_t idx = iy0 * g_render_width + ix0;
                if (depth_value <= g_depth[idx])
                {
                    g_pixels[idx] = color;
                    g_depth[idx] = depth_value;
                }
            }

            if (ix0 == ix1 && iy0 == iy1)
                break;

            int32_t e2 = 2 * err;
            if (e2 >= dy)
            {
                err += dy;
                ix0 += sx;
            }
            if (e2 <= dx)
            {
                err += dx;
                iy0 += sy;
            }
        }
    }

    // Get pointer to pixel buffer (for JS to read)
    EMSCRIPTEN_KEEPALIVE
    uint32_t *get_pixels()
    {
        return g_pixels;
    }

    // Get pointer to depth buffer
    EMSCRIPTEN_KEEPALIVE
    uint16_t *get_depth()
    {
        return g_depth;
    }

    // Get pointer to vertex buffer (for JS to write)
    EMSCRIPTEN_KEEPALIVE
    float *get_vertices()
    {
        return g_vertices;
    }

    // Get pointer to index buffer
    EMSCRIPTEN_KEEPALIVE
    uint32_t *get_indices()
    {
        return g_indices;
    }

    // Get pointer to MVP matrix
    EMSCRIPTEN_KEEPALIVE
    float *get_mvp_matrix()
    {
        return g_mvp_matrix;
    }

    // Get pointer to model matrix
    EMSCRIPTEN_KEEPALIVE
    float *get_model_matrix()
    {
        return g_model_matrix;
    }

    // Get pointer to texture data for a specific slot
    EMSCRIPTEN_KEEPALIVE
    uint8_t *get_texture(int32_t slot)
    {
        if (slot < 0 || slot >= MAX_TEXTURES)
            return nullptr;
        return g_textures[slot];
    }

    // Get pointer to texture sizes array
    EMSCRIPTEN_KEEPALIVE
    int32_t *get_texture_sizes()
    {
        return g_texture_sizes;
    }

    // Set texture for slot
    EMSCRIPTEN_KEEPALIVE
    void set_texture_size(int32_t slot, int32_t width, int32_t height)
    {
        if (slot < 0 || slot >= MAX_TEXTURES)
            return;
        g_texture_sizes[slot * 2] = width;
        g_texture_sizes[slot * 2 + 1] = height;
    }

    // Set active texture
    EMSCRIPTEN_KEEPALIVE
    void set_current_texture(int32_t slot)
    {
        g_current_texture = slot;
    }

    // Set light direction
    EMSCRIPTEN_KEEPALIVE
    void set_light_direction(float x, float y, float z)
    {
        float len = sqrtf(x * x + y * y + z * z);
        if (len > 0.0001f)
        {
            g_light_dir[0] = x / len;
            g_light_dir[1] = y / len;
            g_light_dir[2] = z / len;
        }
    }

    // Set light color and intensity
    EMSCRIPTEN_KEEPALIVE
    void set_light_color(float r, float g, float b, float intensity)
    {
        g_light_color[0] = r;
        g_light_color[1] = g;
        g_light_color[2] = b;
        g_light_color[3] = intensity;
    }

    // Set counts
    EMSCRIPTEN_KEEPALIVE
    void set_vertex_count(int32_t count)
    {
        g_vertex_count = count;
    }

    EMSCRIPTEN_KEEPALIVE
    void set_index_count(int32_t count)
    {
        g_index_count = count;
    }

    // Settings setters
    EMSCRIPTEN_KEEPALIVE
    void set_ambient_light(float ambient)
    {
        g_ambient_light = ambient;
    }

    EMSCRIPTEN_KEEPALIVE
    void set_enable_lighting(int32_t enable)
    {
        g_enable_lighting = enable;
    }

    EMSCRIPTEN_KEEPALIVE
    void set_enable_dithering(int32_t enable)
    {
        g_enable_dithering = enable;
    }

    EMSCRIPTEN_KEEPALIVE
    void set_enable_texturing(int32_t enable)
    {
        g_enable_texturing = enable;
    }

    EMSCRIPTEN_KEEPALIVE
    void set_enable_backface_culling(int32_t enable)
    {
        g_enable_backface_culling = enable;
    }

    EMSCRIPTEN_KEEPALIVE
    void set_enable_vertex_snapping(int32_t enable)
    {
        g_enable_vertex_snapping = enable;
    }

    EMSCRIPTEN_KEEPALIVE
    void set_snap_resolution(float x, float y)
    {
        g_snap_resolution_x = x;
        g_snap_resolution_y = y;
    }

    EMSCRIPTEN_KEEPALIVE
    void set_enable_smooth_shading(int32_t enable)
    {
        g_enable_smooth_shading = enable;
    }

    // Render a point (square) at screen coordinates with given color
    // Points are always rendered on top (depth = 0)
    EMSCRIPTEN_KEEPALIVE
    void render_point(float screenX, float screenY, uint32_t color, int32_t pointSize)
    {
        int cx = (int)screenX;
        int cy = (int)screenY;
        int halfSize = pointSize / 2;

        for (int py = -halfSize; py <= halfSize; py++)
        {
            for (int px = -halfSize; px <= halfSize; px++)
            {
                int sx = cx + px;
                int sy = cy + py;
                if (sx >= 0 && sx < g_render_width && sy >= 0 && sy < g_render_height)
                {
                    int idx = sy * g_render_width + sx;
                    g_pixels[idx] = color;
                    g_depth[idx] = 0; // Always on top
                }
            }
        }
    }

    // Render multiple points from vertex data
    // vertexData format: [x, y, z, r, g, b, ...] (6 floats per vertex, xyz in world space)
    // The function transforms vertices through MVP internally
    EMSCRIPTEN_KEEPALIVE
    void render_points_batch(
        float *vertexData,
        int32_t *indices,
        int32_t indexCount,
        float *mvpMatrix,
        int32_t pointSize)
    {
        int halfSize = pointSize / 2;

        for (int i = 0; i < indexCount; i++)
        {
            int idx = indices[i];
            float *v = &vertexData[idx * 6];

            // Get world position
            Vec4 worldPos = {v[0], v[1], v[2], 1.0f};

            // Transform through MVP (mvpMatrix is a float*)
            Vec4 clip = mat4_mul_vec4(mvpMatrix, worldPos);

            // Skip if behind camera
            if (clip.w < 0.1f)
                continue;

            // Perspective divide
            Vec3 ndc = {clip.x / clip.w, clip.y / clip.w, clip.z / clip.w};

            // Skip if outside NDC bounds
            if (ndc.x < -1.0f || ndc.x > 1.0f || ndc.y < -1.0f || ndc.y > 1.0f)
                continue;

            // Viewport transform
            int screenX = (int)((ndc.x + 1.0f) * 0.5f * g_render_width);
            int screenY = (int)((1.0f - ndc.y) * 0.5f * g_render_height);

            // Compute depth value (16-bit, PS1 style)
            // NDC z is in [-1, 1], map to [0, 65535]
            uint16_t depthVal = (uint16_t)((ndc.z + 1.0f) * 0.5f * 65534.0f);
            // Apply small bias to render dots slightly in front of geometry
            // Use small bias (1) to avoid z-fighting but not jump over other geometry
            depthVal = depthVal > 1 ? depthVal - 1 : 0;

            // Get color (RGB floats 0-255)
            uint8_t r = (uint8_t)v[3];
            uint8_t g = (uint8_t)v[4];
            uint8_t b = (uint8_t)v[5];
            uint32_t color = 0xFF000000 | ((uint32_t)b << 16) | ((uint32_t)g << 8) | r;

            // Draw point with depth testing
            for (int py = -halfSize; py <= halfSize; py++)
            {
                for (int px = -halfSize; px <= halfSize; px++)
                {
                    int sx = screenX + px;
                    int sy = screenY + py;
                    if (sx >= 0 && sx < g_render_width && sy >= 0 && sy < g_render_height)
                    {
                        int pidx = sy * g_render_width + sx;
                        // Depth test: only render if point is in front
                        if (depthVal < g_depth[pidx])
                        {
                            g_pixels[pidx] = color;
                            g_depth[pidx] = depthVal;
                        }
                    }
                }
            }
        }
    }

    // Memory allocation helper for larger buffers
    EMSCRIPTEN_KEEPALIVE
    void *allocate(int32_t size)
    {
        // Simple bump allocator (WASM memory grows as needed)
        static uint8_t *heap_ptr = nullptr;
        if (!heap_ptr)
        {
            // Start after static allocations
            heap_ptr = (uint8_t *)(((uintptr_t)&g_texture_sizes + sizeof(g_texture_sizes) + 15) & ~15);
        }
        void *result = heap_ptr;
        heap_ptr += (size + 15) & ~15; // Align to 16 bytes
        return result;
    }

} // extern "C"
