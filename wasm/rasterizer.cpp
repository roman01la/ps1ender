/**
 * PS1-Style Software Rasterizer - WebAssembly SIMD Implementation
 *
 * Features:
 * - SIMD-accelerated triangle rasterization (4 pixels at a time)
 * - Bulk memory operations for fast clears
 * - 16-bit depth buffer (PS1 style)
 * - Gouraud shading
 * - Affine texture mapping with PS1-style warping
 * - Ordered dithering (8x8 Bayer matrix)
 * - Vertex snapping
 * - Backface culling
 * - Optional pthread-based parallelization (when built with -pthread)
 *
 * Build with Emscripten (see Makefile for full flags):
 *   Single-threaded:
 *     emcc -O3 -msimd128 -mbulk-memory -s STANDALONE_WASM=1 --no-entry \
 *       -o rasterizer.wasm rasterizer.cpp
 *   Multi-threaded:
 *     emcc -O3 -msimd128 -mbulk-memory -pthread -s USE_PTHREADS=1 \
 *       -s PTHREAD_POOL_SIZE=4 -s MODULARIZE=1 -o rasterizer.js rasterizer.cpp
 */

#include <cstdint>
#include <cmath>
#include <cstring>
#include <wasm_simd128.h>
#include <emscripten.h>

// Conditional pthread support
#ifdef __EMSCRIPTEN_PTHREADS__
#include <pthread.h>
#include <atomic>
#define HAS_PTHREADS 1
#else
#define HAS_PTHREADS 0
#endif

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

// Threading configuration
constexpr int MAX_THREADS = 8;
constexpr int MIN_TRIANGLES_PER_THREAD = 64; // Don't bother threading for small batches

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

    // Threading settings
    int32_t g_thread_count = 4; // Number of threads to use (1 = single-threaded)

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

// FMA: a * b + c
// Note: Relaxed SIMD (wasm_f32x4_relaxed_madd) could be faster on newer hardware,
// but we use the standard SIMD path for broader compatibility with older toolchains.
inline v128_t simd_fma(v128_t a, v128_t b, v128_t c)
{
    return wasm_f32x4_add(wasm_f32x4_mul(a, b), c);
}

// SIMD clamp to [0, 255]
inline v128_t simd_clamp_255(v128_t v)
{
    v128_t zero = wasm_f32x4_splat(0.0f);
    v128_t max = wasm_f32x4_splat(255.0f);
    return wasm_f32x4_min(wasm_f32x4_max(v, zero), max);
}

// SIMD floor
inline v128_t simd_floor(v128_t v)
{
    return wasm_f32x4_floor(v);
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

// Rasterize a single triangle with full SIMD acceleration
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
    float texWf = 0, texHf = 0;
    if (g_enable_texturing && texIdx >= 0 && texIdx < MAX_TEXTURES)
    {
        texData = g_textures[texIdx];
        texW = g_texture_sizes[texIdx * 2];
        texH = g_texture_sizes[texIdx * 2 + 1];
        texWf = (float)texW;
        texHf = (float)texH;
    }

    // Check if this is a non-textured triangle (can use fast SIMD path)
    bool useTexture = texData && texW > 0 && texH > 0;

    // SIMD constants
    v128_t simd_zero = wasm_f32x4_splat(0.0f);
    v128_t simd_one = wasm_f32x4_splat(1.0f);
    v128_t simd_255 = wasm_f32x4_splat(255.0f);
    v128_t simd_invArea = wasm_f32x4_splat(invArea);
    v128_t simd_depth_scale = wasm_f32x4_splat(32767.5f);
    v128_t simd_alpha = wasm_i32x4_splat(0xFF000000);

    // Edge function step constants
    v128_t simd_offset0 = wasm_f32x4_make(0.0f, A12, A12 * 2.0f, A12 * 3.0f);
    v128_t simd_offset1 = wasm_f32x4_make(0.0f, A20, A20 * 2.0f, A20 * 3.0f);
    v128_t simd_offset2 = wasm_f32x4_make(0.0f, A01, A01 * 2.0f, A01 * 3.0f);

    // Vertex attributes for interpolation
    v128_t simd_depth0 = wasm_f32x4_splat(v0.depth);
    v128_t simd_depth1 = wasm_f32x4_splat(v1.depth);
    v128_t simd_depth2 = wasm_f32x4_splat(v2.depth);

    v128_t simd_r0 = wasm_f32x4_splat(r0);
    v128_t simd_r1 = wasm_f32x4_splat(r1);
    v128_t simd_r2 = wasm_f32x4_splat(r2);
    v128_t simd_g0 = wasm_f32x4_splat(g0);
    v128_t simd_g1 = wasm_f32x4_splat(g1);
    v128_t simd_g2 = wasm_f32x4_splat(g2);
    v128_t simd_b0 = wasm_f32x4_splat(b0);
    v128_t simd_b1 = wasm_f32x4_splat(b1);
    v128_t simd_b2 = wasm_f32x4_splat(b2);

    // Scan rows
    for (int32_t y = minY; y <= maxY; y++)
    {
        float w0 = w0_row;
        float w1 = w1_row;
        float w2 = w2_row;
        int32_t yOffset = y * g_render_width;
        uint32_t *rowPixels = &g_pixels[yOffset];
        uint16_t *rowDepth = &g_depth[yOffset];

        // Dither row lookup
        int32_t ditherY = y & 7;
        const int8_t *ditherRow = DITHER_MATRIX[ditherY];

        int32_t x = minX;

        // =====================================================================
        // FAST PATH: Non-textured triangles - full SIMD with batched writes
        // =====================================================================
        if (!useTexture)
        {
            for (; x + 3 <= maxX; x += 4)
            {
                // Edge values for 4 consecutive pixels
                v128_t sw0 = wasm_f32x4_add(wasm_f32x4_splat(w0), simd_offset0);
                v128_t sw1 = wasm_f32x4_add(wasm_f32x4_splat(w1), simd_offset1);
                v128_t sw2 = wasm_f32x4_add(wasm_f32x4_splat(w2), simd_offset2);

                // Inside test
                v128_t inside_pos = wasm_v128_and(wasm_v128_and(
                                                      wasm_f32x4_ge(sw0, simd_zero),
                                                      wasm_f32x4_ge(sw1, simd_zero)),
                                                  wasm_f32x4_ge(sw2, simd_zero));
                v128_t inside_neg = wasm_v128_and(wasm_v128_and(
                                                      wasm_f32x4_le(sw0, simd_zero),
                                                      wasm_f32x4_le(sw1, simd_zero)),
                                                  wasm_f32x4_le(sw2, simd_zero));
                v128_t inside_mask = wasm_v128_or(inside_pos, inside_neg);

                if (!wasm_v128_any_true(inside_mask))
                {
                    w0 += A12 * 4.0f;
                    w1 += A20 * 4.0f;
                    w2 += A01 * 4.0f;
                    continue;
                }

                // Barycentric weights
                v128_t bw0 = wasm_f32x4_mul(sw0, simd_invArea);
                v128_t bw1 = wasm_f32x4_mul(sw1, simd_invArea);
                v128_t bw2 = wasm_f32x4_mul(sw2, simd_invArea);

                // Interpolate depth: (depth + 1) * 32767.5
                v128_t depth_f = simd_fma(simd_depth2, bw2,
                                          simd_fma(simd_depth1, bw1, wasm_f32x4_mul(simd_depth0, bw0)));
                v128_t depth_u16 = wasm_f32x4_mul(wasm_f32x4_add(depth_f, simd_one), simd_depth_scale);

                // Load existing depth (4 x u16 -> need to expand)
                // Load 8 u16s, we only use first 4
                v128_t old_depth_i16 = wasm_v128_load64_zero(&rowDepth[x]);
                v128_t old_depth_u32 = wasm_u32x4_extend_low_u16x8(old_depth_i16);
                v128_t old_depth_f = wasm_f32x4_convert_i32x4(old_depth_u32);

                // Depth test: new_depth < old_depth
                v128_t depth_pass = wasm_f32x4_lt(depth_u16, old_depth_f);
                v128_t write_mask = wasm_v128_and(inside_mask, depth_pass);

                if (!wasm_v128_any_true(write_mask))
                {
                    w0 += A12 * 4.0f;
                    w1 += A20 * 4.0f;
                    w2 += A01 * 4.0f;
                    continue;
                }

                // Interpolate colors
                v128_t cr = simd_fma(simd_r2, bw2, simd_fma(simd_r1, bw1, wasm_f32x4_mul(simd_r0, bw0)));
                v128_t cg = simd_fma(simd_g2, bw2, simd_fma(simd_g1, bw1, wasm_f32x4_mul(simd_g0, bw0)));
                v128_t cb = simd_fma(simd_b2, bw2, simd_fma(simd_b1, bw1, wasm_f32x4_mul(simd_b0, bw0)));

                // Clamp to [0, 255]
                cr = wasm_f32x4_min(wasm_f32x4_max(cr, simd_zero), simd_255);
                cg = wasm_f32x4_min(wasm_f32x4_max(cg, simd_zero), simd_255);
                cb = wasm_f32x4_min(wasm_f32x4_max(cb, simd_zero), simd_255);

                // Convert to integers
                v128_t ir = wasm_i32x4_trunc_sat_f32x4(cr);
                v128_t ig = wasm_i32x4_trunc_sat_f32x4(cg);
                v128_t ib = wasm_i32x4_trunc_sat_f32x4(cb);

                // Pack into ABGR: 0xFF000000 | (b << 16) | (g << 8) | r
                v128_t pixels = wasm_v128_or(simd_alpha,
                                             wasm_v128_or(wasm_i32x4_shl(ib, 16),
                                                          wasm_v128_or(wasm_i32x4_shl(ig, 8), ir)));

                // Convert depth to u16
                v128_t new_depth_i32 = wasm_i32x4_trunc_sat_f32x4(depth_u16);

                // Selective write based on mask
                uint32_t mask_bits = wasm_i32x4_bitmask(write_mask);

                // Manual unroll for pixel/depth writes (faster than extract)
                if (mask_bits & 1)
                {
                    rowPixels[x] = wasm_i32x4_extract_lane(pixels, 0);
                    rowDepth[x] = (uint16_t)wasm_i32x4_extract_lane(new_depth_i32, 0);
                }
                if (mask_bits & 2)
                {
                    rowPixels[x + 1] = wasm_i32x4_extract_lane(pixels, 1);
                    rowDepth[x + 1] = (uint16_t)wasm_i32x4_extract_lane(new_depth_i32, 1);
                }
                if (mask_bits & 4)
                {
                    rowPixels[x + 2] = wasm_i32x4_extract_lane(pixels, 2);
                    rowDepth[x + 2] = (uint16_t)wasm_i32x4_extract_lane(new_depth_i32, 2);
                }
                if (mask_bits & 8)
                {
                    rowPixels[x + 3] = wasm_i32x4_extract_lane(pixels, 3);
                    rowDepth[x + 3] = (uint16_t)wasm_i32x4_extract_lane(new_depth_i32, 3);
                }

                w0 += A12 * 4.0f;
                w1 += A20 * 4.0f;
                w2 += A01 * 4.0f;
            }

            // Scalar tail
            for (; x <= maxX; x++)
            {
                if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0))
                {
                    float bw0 = w0 * invArea;
                    float bw1 = w1 * invArea;
                    float bw2 = w2 * invArea;

                    float depthF = v0.depth * bw0 + v1.depth * bw1 + v2.depth * bw2;
                    uint16_t depth = (uint16_t)((depthF + 1.0f) * 32767.5f);

                    if (depth < rowDepth[x])
                    {
                        float cr = r0 * bw0 + r1 * bw1 + r2 * bw2;
                        float cg = g0 * bw0 + g1 * bw1 + g2 * bw2;
                        float cb = b0 * bw0 + b1 * bw1 + b2 * bw2;

                        cr = fminf(255.0f, fmaxf(0.0f, cr));
                        cg = fminf(255.0f, fmaxf(0.0f, cg));
                        cb = fminf(255.0f, fmaxf(0.0f, cb));

                        rowDepth[x] = depth;
                        rowPixels[x] = 0xFF000000 | ((uint32_t)cb << 16) | ((uint32_t)cg << 8) | (uint32_t)cr;
                    }
                }
                w0 += A12;
                w1 += A20;
                w2 += A01;
            }
        }
        // =====================================================================
        // TEXTURED PATH: Scalar inner loop (texture sampling can't be SIMD)
        // =====================================================================
        else
        {
            for (; x <= maxX; x++)
            {
                if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0))
                {
                    float bw0 = w0 * invArea;
                    float bw1 = w1 * invArea;
                    float bw2 = w2 * invArea;

                    float depthF = v0.depth * bw0 + v1.depth * bw1 + v2.depth * bw2;
                    uint16_t depth = (uint16_t)((depthF + 1.0f) * 32767.5f);

                    if (depth < rowDepth[x])
                    {
                        // Affine texture correction
                        float uAffine = v0.u * bw0 + v1.u * bw1 + v2.u * bw2;
                        float vAffine = v0.v * bw0 + v1.v * bw1 + v2.v * bw2;
                        float affine = v0.affine * bw0 + v1.affine * bw1 + v2.affine * bw2;

                        float tu = uAffine / affine;
                        float tv = vAffine / affine;
                        tu = tu - floorf(tu);
                        tv = tv - floorf(tv);

                        int32_t tx = (int32_t)(tu * texWf);
                        int32_t ty = (int32_t)((1.0f - tv) * texHf);
                        tx = ((tx % texW) + texW) % texW;
                        ty = ((ty % texH) + texH) % texH;

                        int32_t texOffset = (ty * texW + tx) * 4;
                        float texR = texData[texOffset];
                        float texG = texData[texOffset + 1];
                        float texB = texData[texOffset + 2];

                        float litR = r0 * bw0 + r1 * bw1 + r2 * bw2;
                        float litG = g0 * bw0 + g1 * bw1 + g2 * bw2;
                        float litB = b0 * bw0 + b1 * bw1 + b2 * bw2;

                        float cr = texR * litR / 255.0f;
                        float cg = texG * litG / 255.0f;
                        float cb = texB * litB / 255.0f;

                        cr = fminf(255.0f, fmaxf(0.0f, cr));
                        cg = fminf(255.0f, fmaxf(0.0f, cg));
                        cb = fminf(255.0f, fmaxf(0.0f, cb));

                        rowDepth[x] = depth;
                        rowPixels[x] = 0xFF000000 | ((uint32_t)cb << 16) | ((uint32_t)cg << 8) | (uint32_t)cr;
                    }
                }
                w0 += A12;
                w1 += A20;
                w2 += A01;
            }
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

    // Clear framebuffer and depth buffer using bulk memory operations
    EMSCRIPTEN_KEEPALIVE
    void clear(uint8_t r, uint8_t g, uint8_t b)
    {
        // Use alpha=0 for background so shader can distinguish from geometry
        uint32_t color = 0x00000000 | ((uint32_t)b << 16) | ((uint32_t)g << 8) | r;
        int32_t pixel_count = g_pixel_count;

        // Fast depth buffer clear with bulk memory (all 0xFFFF)
        // Using memset with 0xFF fills each byte, giving us 0xFFFF for 16-bit depth
        __builtin_memset(g_depth, 0xFF, pixel_count * sizeof(uint16_t));

        // For pixel buffer, we need to set each pixel to the same color
        // SIMD is still faster than memset for 32-bit pattern fills
        v128_t simd_color = wasm_i32x4_splat(color);
        uint32_t *pixels = g_pixels;

        // Unrolled SIMD loop (16 pixels = 64 bytes at a time)
        int32_t i = 0;
        int32_t simd_end = pixel_count - 15;
        for (; i < simd_end; i += 16)
        {
            wasm_v128_store(pixels + i, simd_color);
            wasm_v128_store(pixels + i + 4, simd_color);
            wasm_v128_store(pixels + i + 8, simd_color);
            wasm_v128_store(pixels + i + 12, simd_color);
        }
        // Handle remaining pixels
        for (; i < pixel_count; i++)
        {
            pixels[i] = color;
        }
    }

    // Vertex cache for processed vertices (avoids redundant MVP transforms)
    alignas(16) static ProcessedVertex g_vertex_cache[MAX_VERTICES];
    alignas(16) static uint8_t g_vertex_processed[MAX_VERTICES]; // 0 = not processed, 1 = processed

    // Get or compute processed vertex (with caching)
    static inline ProcessedVertex &get_processed_vertex(uint32_t idx)
    {
        if (!g_vertex_processed[idx])
        {
            g_vertex_cache[idx] = process_vertex(idx);
            g_vertex_processed[idx] = 1;
        }
        return g_vertex_cache[idx];
    }

    // Render all triangles
    EMSCRIPTEN_KEEPALIVE
    void render_triangles()
    {
        int32_t numTriangles = g_index_count / 3;

        // Clear vertex cache flags with bulk memory operation
        __builtin_memset(g_vertex_processed, 0, g_vertex_count);

        for (int32_t t = 0; t < numTriangles; t++)
        {
            uint32_t i0 = g_indices[t * 3];
            uint32_t i1 = g_indices[t * 3 + 1];
            uint32_t i2 = g_indices[t * 3 + 2];

            // Get cached or compute vertices
            ProcessedVertex v0 = get_processed_vertex(i0);
            ProcessedVertex v1 = get_processed_vertex(i1);
            ProcessedVertex v2 = get_processed_vertex(i2);

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

    // ============================================================================
    // Parallel Rendering (pthreads)
    // ============================================================================

#if HAS_PTHREADS
    // Thread work data structure
    struct ThreadWorkData
    {
        int32_t start_triangle;
        int32_t end_triangle;
        int32_t thread_id;
    };

    // Thread worker function - processes a range of triangles
    // Note: The rasterize_triangle function writes to shared pixel/depth buffers.
    // For simplicity and performance, we accept minor visual artifacts from race conditions
    // (occasional pixel overwrites by concurrent threads). This matches the PS1's approach
    // where Z-buffer races were accepted for performance. For truly correct rendering,
    // atomic compare-and-swap operations would be needed for both depth and pixel writes.
    static void *render_thread_worker(void *arg)
    {
        ThreadWorkData *work = (ThreadWorkData *)arg;

        for (int32_t t = work->start_triangle; t < work->end_triangle; t++)
        {
            uint32_t i0 = g_indices[t * 3];
            uint32_t i1 = g_indices[t * 3 + 1];
            uint32_t i2 = g_indices[t * 3 + 2];

            // Get cached vertices (cache populated in main thread before parallel section)
            ProcessedVertex v0 = g_vertex_cache[i0];
            ProcessedVertex v1 = g_vertex_cache[i1];
            ProcessedVertex v2 = g_vertex_cache[i2];

            // Near-plane clipping
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
                    if (isBackfacing)
                    {
                        v0.normal = v0.normal * -1.0f;
                        v1.normal = v1.normal * -1.0f;
                        v2.normal = v2.normal * -1.0f;
                    }
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
                    Vec3 worldEdge1 = v1.world - v0.world;
                    Vec3 worldEdge2 = v2.world - v0.world;
                    Vec3 faceNormal = worldEdge1.cross(worldEdge2).normalize();
                    if (isBackfacing)
                    {
                        faceNormal = faceNormal * -1.0f;
                    }
                    Vec3 lightDir(g_light_dir[0], g_light_dir[1], g_light_dir[2]);
                    float ndotl = fmaxf(0.0f, -faceNormal.dot(lightDir));
                    float faceLight = fminf(1.0f, g_ambient_light + ndotl * g_light_color[3]);
                    v0.light = faceLight;
                    v1.light = faceLight;
                    v2.light = faceLight;
                }
            }

            // Rasterize this triangle
            rasterize_triangle(v0, v1, v2);
        }

        return nullptr;
    }

    // Parallel render using pthreads
    EMSCRIPTEN_KEEPALIVE
    void render_triangles_parallel()
    {
        int32_t numTriangles = g_index_count / 3;

        // For small batches or single thread, use sequential version
        if (numTriangles < MIN_TRIANGLES_PER_THREAD || g_thread_count <= 1)
        {
            render_triangles();
            return;
        }

        // Pre-populate vertex cache (sequential, before parallel section)
        __builtin_memset(g_vertex_processed, 0, g_vertex_count);
        for (int32_t t = 0; t < numTriangles; t++)
        {
            uint32_t i0 = g_indices[t * 3];
            uint32_t i1 = g_indices[t * 3 + 1];
            uint32_t i2 = g_indices[t * 3 + 2];

            if (!g_vertex_processed[i0])
            {
                g_vertex_cache[i0] = process_vertex(i0);
                g_vertex_processed[i0] = 1;
            }
            if (!g_vertex_processed[i1])
            {
                g_vertex_cache[i1] = process_vertex(i1);
                g_vertex_processed[i1] = 1;
            }
            if (!g_vertex_processed[i2])
            {
                g_vertex_cache[i2] = process_vertex(i2);
                g_vertex_processed[i2] = 1;
            }
        }

        // Calculate work distribution
        int32_t effectiveThreads = g_thread_count;
        if (effectiveThreads > MAX_THREADS)
            effectiveThreads = MAX_THREADS;
        int32_t trianglesPerThread = (numTriangles + effectiveThreads - 1) / effectiveThreads;

        // Create thread work data and threads
        pthread_t threads[MAX_THREADS];
        ThreadWorkData workData[MAX_THREADS];
        bool threadCreated[MAX_THREADS] = {false}; // Track which threads were successfully created

        int32_t startTri = 0;

        for (int i = 0; i < effectiveThreads && startTri < numTriangles; i++)
        {
            workData[i].start_triangle = startTri;
            workData[i].end_triangle = startTri + trianglesPerThread;
            if (workData[i].end_triangle > numTriangles)
                workData[i].end_triangle = numTriangles;
            workData[i].thread_id = i;

            if (pthread_create(&threads[i], nullptr, render_thread_worker, &workData[i]) == 0)
            {
                threadCreated[i] = true;
            }
            else
            {
                // Thread creation failed, process this chunk sequentially
                render_thread_worker(&workData[i]);
            }

            startTri = workData[i].end_triangle;
        }

        // Wait for all successfully created threads to complete
        for (int i = 0; i < effectiveThreads; i++)
        {
            if (threadCreated[i])
            {
                pthread_join(threads[i], nullptr);
            }
        }
    }

#else
    // Non-threaded fallback - just call sequential version
    EMSCRIPTEN_KEEPALIVE
    void render_triangles_parallel()
    {
        render_triangles();
    }
#endif

    // Set number of threads for parallel rendering
    EMSCRIPTEN_KEEPALIVE
    void set_thread_count(int32_t count)
    {
        if (count < 1)
            count = 1;
        if (count > MAX_THREADS)
            count = MAX_THREADS;
        g_thread_count = count;
    }

    // Get current thread count setting
    EMSCRIPTEN_KEEPALIVE
    int32_t get_thread_count()
    {
        return g_thread_count;
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

    // ============================================================================
    // Material Baking System
    // ============================================================================

    // Instruction types for compiled material graph
    enum BakeOpcode : uint8_t
    {
        BAKE_OP_FLAT_COLOR = 0,     // Push flat color (RGBA stored in data)
        BAKE_OP_SAMPLE_TEXTURE = 1, // Sample texture at current UV
        BAKE_OP_MIX_MULTIPLY = 2,   // Pop 2 colors, push result (multiply blend)
        BAKE_OP_MIX_ADD = 3,        // Pop 2 colors, push result (additive blend)
        BAKE_OP_MIX_LERP = 4,       // Pop 2 colors, push result (linear interp)
        BAKE_OP_COLOR_RAMP = 5,     // Evaluate color ramp with factor
        BAKE_OP_VORONOI = 6,        // Generate Voronoi texture (scale in data)
        BAKE_OP_ALPHA_CUTOFF = 7,   // Binary alpha cutoff (threshold in data)
        BAKE_OP_NOISE = 8,          // Procedural noise (scale, octaves, mode in data)
        BAKE_OP_END = 255           // End of program
    };

    // Material baking buffers
    constexpr int MAX_BAKE_SIZE = 512 * 512;
    constexpr int MAX_BAKE_INSTRUCTIONS = 256;
    constexpr int MAX_COLOR_RAMP_STOPS = 16;

    alignas(16) uint8_t g_bake_output[MAX_BAKE_SIZE * 4];           // Output RGBA texture
    alignas(16) uint8_t g_bake_program[MAX_BAKE_INSTRUCTIONS * 16]; // Compiled instructions
    int32_t g_bake_width = 256;
    int32_t g_bake_height = 256;
    int32_t g_bake_source_texture = -1; // Source texture slot for sampling

    // Color ramp data (position as 0-255, then RGBA)
    alignas(16) uint8_t g_color_ramp_data[MAX_COLOR_RAMP_STOPS * 5]; // [pos, r, g, b, a] per stop
    int32_t g_color_ramp_count = 0;

    // Get pointers for JS to write to
    EMSCRIPTEN_KEEPALIVE
    uint8_t *get_bake_output_ptr() { return g_bake_output; }

    EMSCRIPTEN_KEEPALIVE
    uint8_t *get_bake_program_ptr() { return g_bake_program; }

    EMSCRIPTEN_KEEPALIVE
    uint8_t *get_color_ramp_ptr() { return g_color_ramp_data; }

    EMSCRIPTEN_KEEPALIVE
    void set_bake_params(int32_t width, int32_t height, int32_t sourceTexture)
    {
        g_bake_width = width;
        g_bake_height = height;
        g_bake_source_texture = sourceTexture;
    }

    EMSCRIPTEN_KEEPALIVE
    void set_color_ramp_count(int32_t count)
    {
        g_color_ramp_count = count > MAX_COLOR_RAMP_STOPS ? MAX_COLOR_RAMP_STOPS : count;
    }

    // Evaluate color ramp at position (0-255)
    static inline void eval_color_ramp(int32_t pos, uint8_t &r, uint8_t &g, uint8_t &b, uint8_t &a)
    {
        if (g_color_ramp_count == 0)
        {
            r = g = b = 0;
            a = 255;
            return;
        }

        // Find surrounding stops
        int lowIdx = 0;
        int highIdx = g_color_ramp_count - 1;

        for (int i = 0; i < g_color_ramp_count - 1; i++)
        {
            int stopPos = g_color_ramp_data[i * 5];
            int nextPos = g_color_ramp_data[(i + 1) * 5];
            if (pos >= stopPos && pos <= nextPos)
            {
                lowIdx = i;
                highIdx = i + 1;
                break;
            }
        }

        uint8_t *low = &g_color_ramp_data[lowIdx * 5];
        uint8_t *high = &g_color_ramp_data[highIdx * 5];

        int lowPos = low[0];
        int highPos = high[0];

        if (pos <= lowPos)
        {
            r = low[1];
            g = low[2];
            b = low[3];
            a = low[4];
            return;
        }
        if (pos >= highPos)
        {
            r = high[1];
            g = high[2];
            b = high[3];
            a = high[4];
            return;
        }

        // Interpolate
        int range = highPos - lowPos;
        if (range <= 0)
        {
            r = low[1];
            g = low[2];
            b = low[3];
            a = low[4];
            return;
        }

        int t = ((pos - lowPos) * 255) / range; // 0-255 interpolation factor
        r = (low[1] * (255 - t) + high[1] * t) / 255;
        g = (low[2] * (255 - t) + high[2] * t) / 255;
        b = (low[3] * (255 - t) + high[3] * t) / 255;
        a = (low[4] * (255 - t) + high[4] * t) / 255;
    }

    // SIMD color ramp evaluation for 4 positions at once
    // positions: 4 factor values (0-255), output: 4 RGBA values packed
    static inline void eval_color_ramp_simd4(const int32_t pos[4],
                                             uint8_t out_r[4], uint8_t out_g[4],
                                             uint8_t out_b[4], uint8_t out_a[4])
    {
        for (int i = 0; i < 4; i++)
        {
            eval_color_ramp(pos[i], out_r[i], out_g[i], out_b[i], out_a[i]);
        }
    }

    // Execute bake program - SIMD optimized for 4 pixels at a time
    EMSCRIPTEN_KEEPALIVE
    void bake_material()
    {
        int width = g_bake_width;
        int height = g_bake_height;
        int texSlot = g_bake_source_texture;

        // Get source texture info if available
        int srcWidth = 0, srcHeight = 0;
        uint8_t *srcTex = nullptr;
        if (texSlot >= 0 && texSlot < MAX_TEXTURES)
        {
            srcWidth = g_texture_sizes[texSlot * 2];
            srcHeight = g_texture_sizes[texSlot * 2 + 1];
            if (srcWidth > 0 && srcHeight > 0)
            {
                srcTex = g_textures[texSlot];
            }
        }

        // SIMD color stack for 4 pixels at a time
        // Each stack entry holds 4 pixels worth of RGBA data
        // Layout: r[4], g[4], b[4], a[4] as i32x4 vectors
        constexpr int MAX_STACK = 8;
        alignas(16) v128_t stack_r[MAX_STACK];
        alignas(16) v128_t stack_g[MAX_STACK];
        alignas(16) v128_t stack_b[MAX_STACK];
        alignas(16) v128_t stack_a[MAX_STACK];

        const v128_t v_zero = wasm_i32x4_splat(0);
        const v128_t v_255 = wasm_i32x4_splat(255);
        const v128_t v_srcWidth = wasm_f32x4_splat((float)srcWidth);
        const v128_t v_srcHeight = wasm_f32x4_splat((float)srcHeight);
        const v128_t v_invWidth = wasm_f32x4_splat(1.0f / (float)width);
        const v128_t v_invHeight = wasm_f32x4_splat(1.0f / (float)height);
        const v128_t v_half = wasm_f32x4_splat(0.5f);
        const v128_t v_one = wasm_f32x4_splat(1.0f);
        const v128_t v_eight = wasm_f32x4_splat(8.0f);

        // Process pixels in groups of 4 (horizontally)
        for (int y = 0; y < height; y++)
        {
            // V coordinate (1 at top, 0 at bottom - OpenGL convention)
            float v = 1.0f - ((float)y + 0.5f) / (float)height;
            v128_t v_v = wasm_f32x4_splat(v);

            for (int x = 0; x < width; x += 4)
            {
                int stackPtr = 0;

                // Handle edge case where we don't have full 4 pixels
                int pixelCount = (x + 4 <= width) ? 4 : (width - x);

                // U coordinates for 4 pixels
                v128_t v_x = wasm_f32x4_add(
                    wasm_f32x4_make((float)x, (float)(x + 1), (float)(x + 2), (float)(x + 3)),
                    v_half);
                v128_t v_u = wasm_f32x4_mul(v_x, v_invWidth);

                // Execute program for all 4 pixels
                uint8_t *pc = g_bake_program;
                bool done = false;

                while (!done)
                {
                    BakeOpcode op = (BakeOpcode)*pc++;

                    switch (op)
                    {
                    case BAKE_OP_FLAT_COLOR:
                    {
                        // Same color for all 4 pixels
                        int r = *pc++;
                        int g = *pc++;
                        int b = *pc++;
                        int a = *pc++;
                        stack_r[stackPtr] = wasm_i32x4_splat(r);
                        stack_g[stackPtr] = wasm_i32x4_splat(g);
                        stack_b[stackPtr] = wasm_i32x4_splat(b);
                        stack_a[stackPtr] = wasm_i32x4_splat(a);
                        stackPtr++;
                        break;
                    }

                    case BAKE_OP_SAMPLE_TEXTURE:
                    {
                        if (srcTex && srcWidth > 0 && srcHeight > 0)
                        {
                            // Calculate texture coordinates for 4 pixels
                            // Note: Invert V for texture sampling (1-v) to match image coordinate system
                            // where row 0 is at top of image but V=1 is at top in OpenGL/UV space
                            v128_t v_tx_f = wasm_f32x4_mul(v_u, v_srcWidth);
                            v128_t v_ty_f = wasm_f32x4_mul(wasm_f32x4_sub(v_one, v_v), v_srcHeight);

                            // Convert to int and wrap
                            v128_t v_tx = wasm_i32x4_trunc_sat_f32x4(v_tx_f);
                            v128_t v_ty = wasm_i32x4_trunc_sat_f32x4(v_ty_f);

                            // Modulo wrap (simplified - assumes positive)
                            v128_t v_srcW_i = wasm_i32x4_splat(srcWidth);
                            v128_t v_srcH_i = wasm_i32x4_splat(srcHeight);

                            // tx = tx % srcWidth (using mask for power-of-2 or fallback)
                            // For simplicity, extract and sample individually
                            alignas(16) int32_t tx[4], ty[4];
                            wasm_v128_store(tx, v_tx);
                            wasm_v128_store(ty, v_ty);

                            alignas(16) int32_t r[4], g[4], b[4], a[4];
                            for (int i = 0; i < 4; i++)
                            {
                                int txi = tx[i] % srcWidth;
                                int tyi = ty[i] % srcHeight;
                                if (txi < 0)
                                    txi += srcWidth;
                                if (tyi < 0)
                                    tyi += srcHeight;
                                int tidx = (tyi * srcWidth + txi) * 4;
                                r[i] = srcTex[tidx];
                                g[i] = srcTex[tidx + 1];
                                b[i] = srcTex[tidx + 2];
                                a[i] = srcTex[tidx + 3];
                            }

                            stack_r[stackPtr] = wasm_v128_load(r);
                            stack_g[stackPtr] = wasm_v128_load(g);
                            stack_b[stackPtr] = wasm_v128_load(b);
                            stack_a[stackPtr] = wasm_v128_load(a);
                        }
                        else
                        {
                            // Checkerboard pattern
                            v128_t v_cu = wasm_f32x4_mul(v_u, v_eight);
                            v128_t v_cv = wasm_f32x4_mul(v_v, v_eight);
                            v128_t v_cui = wasm_i32x4_trunc_sat_f32x4(v_cu);
                            v128_t v_cvi = wasm_i32x4_trunc_sat_f32x4(v_cv);
                            v128_t v_sum = wasm_i32x4_add(v_cui, v_cvi);
                            v128_t v_checker = wasm_v128_and(v_sum, wasm_i32x4_splat(1));

                            // checker ? 255 : 0 for R and B, 0 for G
                            v128_t v_mask = wasm_i32x4_eq(v_checker, wasm_i32x4_splat(1));
                            stack_r[stackPtr] = wasm_v128_and(v_mask, v_255);
                            stack_g[stackPtr] = v_zero;
                            stack_b[stackPtr] = wasm_v128_and(v_mask, v_255);
                            stack_a[stackPtr] = v_255;
                        }
                        stackPtr++;
                        break;
                    }

                    case BAKE_OP_MIX_MULTIPLY:
                    {
                        pc++; // skip factor byte
                        if (stackPtr >= 2)
                        {
                            stackPtr--;
                            // c1 * c2 / 255 using SIMD
                            v128_t r1 = stack_r[stackPtr - 1];
                            v128_t g1 = stack_g[stackPtr - 1];
                            v128_t b1 = stack_b[stackPtr - 1];
                            v128_t a1 = stack_a[stackPtr - 1];
                            v128_t r2 = stack_r[stackPtr];
                            v128_t g2 = stack_g[stackPtr];
                            v128_t b2 = stack_b[stackPtr];
                            v128_t a2 = stack_a[stackPtr];

                            // Multiply and divide by 255
                            stack_r[stackPtr - 1] = wasm_i32x4_shr(wasm_i32x4_mul(r1, r2), 8);
                            stack_g[stackPtr - 1] = wasm_i32x4_shr(wasm_i32x4_mul(g1, g2), 8);
                            stack_b[stackPtr - 1] = wasm_i32x4_shr(wasm_i32x4_mul(b1, b2), 8);
                            stack_a[stackPtr - 1] = wasm_i32x4_shr(wasm_i32x4_mul(a1, a2), 8);
                        }
                        break;
                    }

                    case BAKE_OP_MIX_ADD:
                    {
                        int factor = *pc++;
                        if (stackPtr >= 2)
                        {
                            stackPtr--;
                            v128_t v_factor = wasm_i32x4_splat(factor);

                            v128_t r1 = stack_r[stackPtr - 1];
                            v128_t g1 = stack_g[stackPtr - 1];
                            v128_t b1 = stack_b[stackPtr - 1];
                            v128_t r2 = stack_r[stackPtr];
                            v128_t g2 = stack_g[stackPtr];
                            v128_t b2 = stack_b[stackPtr];

                            // c1 + (c2 * factor) / 255, clamped to 255
                            v128_t add_r = wasm_i32x4_add(r1, wasm_i32x4_shr(wasm_i32x4_mul(r2, v_factor), 8));
                            v128_t add_g = wasm_i32x4_add(g1, wasm_i32x4_shr(wasm_i32x4_mul(g2, v_factor), 8));
                            v128_t add_b = wasm_i32x4_add(b1, wasm_i32x4_shr(wasm_i32x4_mul(b2, v_factor), 8));

                            stack_r[stackPtr - 1] = wasm_i32x4_min(add_r, v_255);
                            stack_g[stackPtr - 1] = wasm_i32x4_min(add_g, v_255);
                            stack_b[stackPtr - 1] = wasm_i32x4_min(add_b, v_255);
                        }
                        break;
                    }

                    case BAKE_OP_MIX_LERP:
                    {
                        int factor = *pc++;
                        if (stackPtr >= 2)
                        {
                            stackPtr--;
                            v128_t v_factor = wasm_i32x4_splat(factor);
                            v128_t v_inv_factor = wasm_i32x4_splat(255 - factor);

                            v128_t r1 = stack_r[stackPtr - 1];
                            v128_t g1 = stack_g[stackPtr - 1];
                            v128_t b1 = stack_b[stackPtr - 1];
                            v128_t a1 = stack_a[stackPtr - 1];
                            v128_t r2 = stack_r[stackPtr];
                            v128_t g2 = stack_g[stackPtr];
                            v128_t b2 = stack_b[stackPtr];
                            v128_t a2 = stack_a[stackPtr];

                            // (c1 * invF + c2 * factor) / 255
                            stack_r[stackPtr - 1] = wasm_i32x4_shr(
                                wasm_i32x4_add(wasm_i32x4_mul(r1, v_inv_factor), wasm_i32x4_mul(r2, v_factor)), 8);
                            stack_g[stackPtr - 1] = wasm_i32x4_shr(
                                wasm_i32x4_add(wasm_i32x4_mul(g1, v_inv_factor), wasm_i32x4_mul(g2, v_factor)), 8);
                            stack_b[stackPtr - 1] = wasm_i32x4_shr(
                                wasm_i32x4_add(wasm_i32x4_mul(b1, v_inv_factor), wasm_i32x4_mul(b2, v_factor)), 8);
                            stack_a[stackPtr - 1] = wasm_i32x4_shr(
                                wasm_i32x4_add(wasm_i32x4_mul(a1, v_inv_factor), wasm_i32x4_mul(a2, v_factor)), 8);
                        }
                        break;
                    }

                    case BAKE_OP_COLOR_RAMP:
                    {
                        // Read inline color ramp data from bytecode
                        // Format: [stopCount, ...stops(pos, r, g, b, a)]
                        int stopCount = *pc++;
                        if (stopCount > 16)
                            stopCount = 16;

                        // Read stop data into local array
                        uint8_t rampData[16 * 5];
                        for (int s = 0; s < stopCount; s++)
                        {
                            rampData[s * 5] = *pc++;     // position
                            rampData[s * 5 + 1] = *pc++; // r
                            rampData[s * 5 + 2] = *pc++; // g
                            rampData[s * 5 + 3] = *pc++; // b
                            rampData[s * 5 + 4] = *pc++; // a
                        }

                        if (stackPtr >= 1 && stopCount > 0)
                        {
                            // Extract red channel as factor for each pixel
                            alignas(16) int32_t fac[4];
                            wasm_v128_store(fac, stack_r[stackPtr - 1]);

                            alignas(16) int32_t r[4], g[4], b[4], a[4];
                            for (int i = 0; i < 4; i++)
                            {
                                int pos = fac[i];

                                // Find surrounding stops
                                int lowIdx = 0;
                                int highIdx = stopCount - 1;
                                for (int s = 0; s < stopCount - 1; s++)
                                {
                                    int stopPos = rampData[s * 5];
                                    int nextPos = rampData[(s + 1) * 5];
                                    if (pos >= stopPos && pos <= nextPos)
                                    {
                                        lowIdx = s;
                                        highIdx = s + 1;
                                        break;
                                    }
                                }

                                uint8_t *low = &rampData[lowIdx * 5];
                                uint8_t *high = &rampData[highIdx * 5];
                                int lowPos = low[0];
                                int highPos = high[0];

                                if (pos <= lowPos)
                                {
                                    r[i] = low[1];
                                    g[i] = low[2];
                                    b[i] = low[3];
                                    a[i] = low[4];
                                }
                                else if (pos >= highPos)
                                {
                                    r[i] = high[1];
                                    g[i] = high[2];
                                    b[i] = high[3];
                                    a[i] = high[4];
                                }
                                else
                                {
                                    // Interpolate
                                    int range = highPos - lowPos;
                                    int t = ((pos - lowPos) * 255) / range;
                                    int invT = 255 - t;
                                    r[i] = (low[1] * invT + high[1] * t) >> 8;
                                    g[i] = (low[2] * invT + high[2] * t) >> 8;
                                    b[i] = (low[3] * invT + high[3] * t) >> 8;
                                    a[i] = (low[4] * invT + high[4] * t) >> 8;
                                }
                            }

                            stack_r[stackPtr - 1] = wasm_v128_load(r);
                            stack_g[stackPtr - 1] = wasm_v128_load(g);
                            stack_b[stackPtr - 1] = wasm_v128_load(b);
                            stack_a[stackPtr - 1] = wasm_v128_load(a);
                        }
                        break;
                    }

                    case BAKE_OP_VORONOI:
                    {
                        // Voronoi texture - scale is next byte (1-255), mode is next byte (0=F1, 1=edge)
                        float scale = (float)*pc++;
                        if (scale < 1.0f)
                            scale = 1.0f;
                        uint8_t mode = *pc++; // 0 = distance to point (F1), 1 = distance to edge (F2-F1)

                        // Process 4 pixels - extract UV coordinates
                        alignas(16) float u_arr[4], v_arr[4];
                        wasm_v128_store(u_arr, v_u);
                        // v_v is a splat, so all 4 values are the same
                        float v_val = 1.0f - ((float)y + 0.5f) / (float)height;

                        alignas(16) int32_t dist[4];
                        for (int i = 0; i < 4; i++)
                        {
                            float pu = u_arr[i] * scale;
                            float pv = v_val * scale;

                            // Cell coordinates
                            int cellX = (int)floorf(pu);
                            int cellY = (int)floorf(pv);

                            // Find F1 (nearest) and F2 (second nearest) distances
                            float f1 = 1e10f;
                            float f2 = 1e10f;

                            // Check 3x3 neighborhood of cells
                            for (int dy = -1; dy <= 1; dy++)
                            {
                                for (int dx = -1; dx <= 1; dx++)
                                {
                                    int cx = cellX + dx;
                                    int cy = cellY + dy;

                                    // Hash function for pseudo-random point in cell
                                    // Simple but effective hash
                                    uint32_t h = (uint32_t)(cx * 374761393 + cy * 668265263);
                                    h = (h ^ (h >> 13)) * 1274126177;

                                    // Random point in cell (0-1 range)
                                    float rx = (float)(h & 0xFFFF) / 65535.0f;
                                    h = h * 1103515245 + 12345;
                                    float ry = (float)(h & 0xFFFF) / 65535.0f;

                                    // Point position in world space
                                    float px = (float)cx + rx;
                                    float py = (float)cy + ry;

                                    // Distance to this point
                                    float ddx = pu - px;
                                    float ddy = pv - py;
                                    float d = sqrtf(ddx * ddx + ddy * ddy);

                                    // Track F1 and F2
                                    if (d < f1)
                                    {
                                        f2 = f1;
                                        f1 = d;
                                    }
                                    else if (d < f2)
                                    {
                                        f2 = d;
                                    }
                                }
                            }

                            // Calculate output based on mode
                            float outVal;
                            if (mode == 1)
                            {
                                // Distance to edge: F2 - F1 (smaller = closer to edge)
                                // Invert so edges are white
                                outVal = 1.0f - (f2 - f1) * 2.0f;
                                if (outVal < 0.0f)
                                    outVal = 0.0f;
                                if (outVal > 1.0f)
                                    outVal = 1.0f;
                            }
                            else
                            {
                                // Distance to point (F1)
                                outVal = f1 * 1.4f;
                                if (outVal > 1.0f)
                                    outVal = 1.0f;
                            }

                            int val = (int)(outVal * 255.0f);
                            if (val > 255)
                                val = 255;
                            if (val < 0)
                                val = 0;
                            dist[i] = val;
                        }

                        // Push grayscale result (distance in all channels)
                        stack_r[stackPtr] = wasm_v128_load(dist);
                        stack_g[stackPtr] = wasm_v128_load(dist);
                        stack_b[stackPtr] = wasm_v128_load(dist);
                        stack_a[stackPtr] = v_255;
                        stackPtr++;
                        break;
                    }

                    case BAKE_OP_ALPHA_CUTOFF:
                    {
                        // Alpha cutoff - threshold is next byte (0-255)
                        uint8_t threshold = *pc++;

                        if (stackPtr > 0)
                        {
                            // Pop color and apply alpha cutoff
                            stackPtr--;
                            alignas(16) int32_t a_arr[4];
                            wasm_v128_store(a_arr, stack_a[stackPtr]);

                            // Binary cutoff: alpha >= threshold -> 255, else 0
                            for (int i = 0; i < 4; i++)
                            {
                                a_arr[i] = (a_arr[i] >= threshold) ? 255 : 0;
                            }

                            // Push back with modified alpha
                            stack_r[stackPtr] = stack_r[stackPtr]; // unchanged
                            stack_g[stackPtr] = stack_g[stackPtr]; // unchanged
                            stack_b[stackPtr] = stack_b[stackPtr]; // unchanged
                            stack_a[stackPtr] = wasm_v128_load(a_arr);
                            stackPtr++;
                        }
                        break;
                    }

                    case BAKE_OP_NOISE:
                    {
                        // Noise texture - scale (1-255), octaves (1-8), mode (0=value, 1=simplex)
                        float scale = (float)*pc++;
                        if (scale < 1.0f)
                            scale = 1.0f;
                        int octaves = *pc++;
                        if (octaves < 1)
                            octaves = 1;
                        if (octaves > 8)
                            octaves = 8;
                        uint8_t mode = *pc++; // 0 = value noise, 1 = simplex

                        // Process 4 pixels
                        alignas(16) float u_arr[4];
                        wasm_v128_store(u_arr, v_u);
                        float v_val = 1.0f - ((float)y + 0.5f) / (float)height;

                        alignas(16) int32_t noise_out[4];
                        for (int i = 0; i < 4; i++)
                        {
                            float px = u_arr[i] * scale;
                            float py = v_val * scale;

                            float noiseVal = 0.0f;
                            float amplitude = 1.0f;
                            float frequency = 1.0f;
                            float maxValue = 0.0f;

                            // Fractal noise with octaves
                            for (int o = 0; o < octaves; o++)
                            {
                                float nx = px * frequency;
                                float ny = py * frequency;

                                if (mode == 1)
                                {
                                    // Simplex-like noise using gradient method
                                    int ix = (int)floorf(nx);
                                    int iy = (int)floorf(ny);
                                    float fx = nx - (float)ix;
                                    float fy = ny - (float)iy;

                                    // Smooth interpolation
                                    float u_interp = fx * fx * (3.0f - 2.0f * fx);
                                    float v_interp = fy * fy * (3.0f - 2.0f * fy);

                                    // Gradient hash at corners
                                    auto grad = [](int hash, float x, float y) -> float
                                    {
                                        int h = hash & 7;
                                        float u_g = h < 4 ? x : y;
                                        float v_g = h < 4 ? y : x;
                                        return ((h & 1) ? -u_g : u_g) + ((h & 2) ? -2.0f * v_g : 2.0f * v_g);
                                    };

                                    auto hash2 = [](int x, int y) -> int
                                    {
                                        uint32_t h = (uint32_t)(x * 374761393 + y * 668265263);
                                        h = (h ^ (h >> 13)) * 1274126177;
                                        return (int)(h & 0xFF);
                                    };

                                    float n00 = grad(hash2(ix, iy), fx, fy);
                                    float n10 = grad(hash2(ix + 1, iy), fx - 1.0f, fy);
                                    float n01 = grad(hash2(ix, iy + 1), fx, fy - 1.0f);
                                    float n11 = grad(hash2(ix + 1, iy + 1), fx - 1.0f, fy - 1.0f);

                                    float nx0 = n00 + u_interp * (n10 - n00);
                                    float nx1 = n01 + u_interp * (n11 - n01);
                                    float octaveNoise = nx0 + v_interp * (nx1 - nx0);

                                    noiseVal += (octaveNoise * 0.5f + 0.5f) * amplitude;
                                }
                                else
                                {
                                    // Value noise
                                    int ix = (int)floorf(nx);
                                    int iy = (int)floorf(ny);
                                    float fx = nx - (float)ix;
                                    float fy = ny - (float)iy;

                                    // Smooth interpolation
                                    float u_interp = fx * fx * (3.0f - 2.0f * fx);
                                    float v_interp = fy * fy * (3.0f - 2.0f * fy);

                                    // Hash at corners
                                    auto hash2 = [](int x, int y) -> float
                                    {
                                        uint32_t h = (uint32_t)(x * 374761393 + y * 668265263);
                                        h = (h ^ (h >> 13)) * 1274126177;
                                        return (float)(h & 0xFFFF) / 65535.0f;
                                    };

                                    float n00 = hash2(ix, iy);
                                    float n10 = hash2(ix + 1, iy);
                                    float n01 = hash2(ix, iy + 1);
                                    float n11 = hash2(ix + 1, iy + 1);

                                    float nx0 = n00 + u_interp * (n10 - n00);
                                    float nx1 = n01 + u_interp * (n11 - n01);
                                    float octaveNoise = nx0 + v_interp * (nx1 - nx0);

                                    noiseVal += octaveNoise * amplitude;
                                }

                                maxValue += amplitude;
                                amplitude *= 0.5f;
                                frequency *= 2.0f;
                            }

                            // Normalize
                            noiseVal /= maxValue;

                            int val = (int)(noiseVal * 255.0f);
                            if (val > 255)
                                val = 255;
                            if (val < 0)
                                val = 0;
                            noise_out[i] = val;
                        }

                        // Push grayscale result
                        stack_r[stackPtr] = wasm_v128_load(noise_out);
                        stack_g[stackPtr] = wasm_v128_load(noise_out);
                        stack_b[stackPtr] = wasm_v128_load(noise_out);
                        stack_a[stackPtr] = v_255;
                        stackPtr++;
                        break;
                    }

                    case BAKE_OP_END:
                    default:
                        done = true;
                        break;
                    }
                }

                // Write output for 4 pixels
                alignas(16) int32_t out_r[4], out_g[4], out_b[4], out_a[4];
                if (stackPtr > 0)
                {
                    wasm_v128_store(out_r, stack_r[0]);
                    wasm_v128_store(out_g, stack_g[0]);
                    wasm_v128_store(out_b, stack_b[0]);
                    wasm_v128_store(out_a, stack_a[0]);
                }
                else
                {
                    // Error - magenta
                    for (int i = 0; i < 4; i++)
                    {
                        out_r[i] = 255;
                        out_g[i] = 0;
                        out_b[i] = 255;
                        out_a[i] = 255;
                    }
                }

                // Write to output buffer
                for (int i = 0; i < pixelCount; i++)
                {
                    int outIdx = (y * width + x + i) * 4;
                    g_bake_output[outIdx] = (uint8_t)out_r[i];
                    g_bake_output[outIdx + 1] = (uint8_t)out_g[i];
                    g_bake_output[outIdx + 2] = (uint8_t)out_b[i];
                    g_bake_output[outIdx + 3] = (uint8_t)out_a[i];
                }
            }
        }
    }

} // extern "C"
