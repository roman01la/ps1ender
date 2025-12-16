# WASM Rasterizer Makefile
# 
# Uses Emscripten for WASM compilation with SIMD support.
# Install: brew install emscripten

CXX := emcc

# Compiler flags
CXXFLAGS := -O3 \
            -msimd128 \
            -mrelaxed-simd \
            -mbulk-memory \
            -fno-exceptions \
            -fno-rtti \
            -std=c++17 \
            -s WASM=1 \
            -s SIDE_MODULE=0 \
            -s EXPORTED_FUNCTIONS="['_set_render_resolution','_get_render_width','_get_render_height','_get_pixel_count','_clear','_render_triangles','_draw_line','_get_pixels','_get_depth','_get_vertices','_get_indices','_get_mvp_matrix','_get_model_matrix','_get_texture','_get_texture_sizes','_set_texture_size','_set_current_texture','_set_light_direction','_set_light_color','_set_vertex_count','_set_index_count','_set_ambient_light','_set_enable_lighting','_set_enable_dithering','_set_enable_texturing','_set_enable_backface_culling','_set_enable_vertex_snapping','_set_enable_smooth_shading','_set_snap_resolution','_render_point','_render_points_batch','_malloc','_free']" \
            -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap']" \
            -s ALLOW_MEMORY_GROWTH=1 \
            -s INITIAL_MEMORY=67108864 \
            -s MAXIMUM_MEMORY=536870912 \
            -s STANDALONE_WASM=1 \
            --no-entry

# Source files
SRC := rasterizer.cpp
OUT := rasterizer.wasm

# Default target
all: $(OUT)
$(OUT): $(SRC)
	@echo "Building with Emscripten..."
	$(CXX) $(CXXFLAGS) -o $@ $<
	@echo "Built $@ ($$(wc -c < $@) bytes)"

# Copy to public folder
install: $(OUT)
	@mkdir -p ../public
	cp $(OUT) ../public/
	@echo "Installed to ../public/"

# Clean build artifacts
clean:
	rm -f $(OUT) *.js

# Debug build (no optimizations)
debug: CXXFLAGS := $(filter-out -O3,$(CXXFLAGS)) -O0 -g4
debug: $(OUT)

# Profile build (optimized but with function names for Chrome DevTools)
profile: CXXFLAGS := $(CXXFLAGS) --profiling-funcs
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

.PHONY: all install clean debug profile check
