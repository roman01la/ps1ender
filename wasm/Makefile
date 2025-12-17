# WASM Rasterizer Makefile
# 
# Uses Emscripten for WASM compilation with SIMD support.
# Install: brew install emscripten

CXX := emcc

# Exported functions (shared between single and multi-threaded builds)
EXPORTS := ['_set_render_resolution','_get_render_width','_get_render_height','_get_pixel_count','_clear','_render_triangles','_render_triangles_parallel','_draw_line','_get_pixels','_get_depth','_get_vertices','_get_indices','_get_mvp_matrix','_get_model_matrix','_get_texture','_get_texture_sizes','_set_texture_size','_set_current_texture','_set_light_direction','_set_light_color','_set_vertex_count','_set_index_count','_set_ambient_light','_set_enable_lighting','_set_enable_dithering','_set_enable_texturing','_set_enable_backface_culling','_set_enable_vertex_snapping','_set_enable_smooth_shading','_set_snap_resolution','_render_point','_render_points_batch','_malloc','_free','_get_bake_output_ptr','_get_bake_program_ptr','_get_color_ramp_ptr','_set_bake_params','_set_color_ramp_count','_bake_material','_set_thread_count','_get_thread_count']

# Base compiler flags (removed -mrelaxed-simd for older emscripten compatibility)
BASE_FLAGS := -O3 \
            -msimd128 \
            -mbulk-memory \
            -fno-exceptions \
            -fno-rtti \
            -std=c++17 \
            -s WASM=1 \
            -s SIDE_MODULE=0 \
            -s EXPORTED_FUNCTIONS="$(EXPORTS)" \
            -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap']" \
            -s ALLOW_MEMORY_GROWTH=1 \
            -s INITIAL_MEMORY=67108864 \
            -s MAXIMUM_MEMORY=536870912

# Single-threaded build flags (standalone WASM)
CXXFLAGS_SINGLE := $(BASE_FLAGS) \
            -s STANDALONE_WASM=1 \
            --no-entry

# Multi-threaded build flags (pthreads enabled)
CXXFLAGS_THREADS := $(BASE_FLAGS) \
            -pthread \
            -s USE_PTHREADS=1 \
            -s PTHREAD_POOL_SIZE=4 \
            -s PROXY_TO_PTHREAD=0 \
            -s MODULARIZE=1 \
            -s EXPORT_NAME='RasterizerModule'

# Source files
SRC := rasterizer.cpp
OUT := rasterizer.wasm
OUT_JS := rasterizer.js
OUT_WORKER := rasterizer.worker.js

# Default target: single-threaded build (no JS glue needed, simpler to use)
all: $(OUT)
$(OUT): $(SRC)
	@echo "Building single-threaded WASM with Emscripten..."
	$(CXX) $(CXXFLAGS_SINGLE) -o $@ $<
	@echo "Built $@ ($$(wc -c < $@) bytes)"

# Multi-threaded build (creates .wasm + .js + .worker.js)
threads: $(SRC)
	@echo "Building multi-threaded WASM with pthreads..."
	$(CXX) $(CXXFLAGS_THREADS) -o $(OUT_JS) $<
	@echo "Built $(OUT_JS), $(OUT), $(OUT_WORKER)"
	@ls -la rasterizer.*

# Copy to public folder (single-threaded)
install: $(OUT)
	@mkdir -p ../public
	cp $(OUT) ../public/
	@echo "Installed to ../public/"

# Copy to public folder (multi-threaded)
install-threads: threads
	@mkdir -p ../public
	cp $(OUT) $(OUT_JS) $(OUT_WORKER) ../public/
	@echo "Installed multi-threaded build to ../public/"

# Clean build artifacts
clean:
	rm -f $(OUT) $(OUT_JS) $(OUT_WORKER) *.wasm *.js

# Debug build (no optimizations)
debug: CXXFLAGS_SINGLE := $(filter-out -O3,$(CXXFLAGS_SINGLE)) -O0 -g4
debug: $(OUT)

# Profile build (optimized but with function names for Chrome DevTools)
profile: CXXFLAGS_SINGLE := $(CXXFLAGS_SINGLE) --profiling-funcs
profile: $(OUT)
	@echo "Profile build ready - function names visible in Chrome DevTools Performance tab"

# Check if emcc is available
check:
	@if ! command -v emcc &> /dev/null; then \
		echo "Error: emcc not found"; \
		echo "Install with: brew install emscripten"; \
		exit 1; \
	fi
	@echo "Using: $$(which emcc)"
	@emcc --version | head -1

.PHONY: all threads install install-threads clean debug profile check
