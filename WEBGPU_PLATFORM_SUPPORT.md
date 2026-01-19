# WebGPU Platform Support

This document outlines the platform-specific WebGPU support implemented in AI-Worker.

## Main Process Configuration (`src/main/index.ts`)

### Platform-Specific WebGPU Flags

The application now configures WebGPU differently based on the operating system:

#### Linux
- **Backend**: Vulkan
- **Flags**: `--enable-webgpu --enable-vulkan --use-vulkan=native`
- **Requirements**: Vulkan drivers must be installed
- **Driver Installation**:
  - Intel: `sudo apt install mesa-vulkan-drivers`
  - NVIDIA: Latest NVIDIA drivers (535+)
  - AMD: `sudo apt install mesa-vulkan-drivers`

#### Windows
- **Backend**: DirectX 12 (with D3D11 fallback)
- **Flags**: `--enable-webgpu --use-angle=d3d11`
- **Requirements**: DirectX 12 compatible GPU and drivers
- **Notes**: Falls back to D3D11 if D3D12 is not available

#### macOS
- **Backend**: Metal
- **Flags**: `--enable-webgpu`
- **Requirements**: macOS 13.0+ (Ventura) with Metal-compatible Mac (2012+)
- **Notes**: Native Metal backend provides best performance

## Renderer Process Detection (`src/renderer/src/lib/webllm.ts`)

### Platform-Specific Error Messages

The WebGPU detection now provides detailed troubleshooting information based on the user's platform:

#### Linux Error Messages Include:
- Vulkan driver installation instructions
- GPU-specific driver recommendations
- Virtual machine warnings
- Verification commands (`vulkaninfo --summary`)

#### Windows Error Messages Include:
- DirectX 12 requirements
- GPU driver update instructions
- Hardware acceleration settings
- Browser restart requirements

#### macOS Error Messages Include:
- macOS version requirements
- Metal compatibility information
- Safari vs Chrome differences
- Developer menu instructions

## Orchestrator Fallback (`src/renderer/src/lib/orchestrator.ts`)

### Platform-Aware Fallback Behavior

When WebGPU is not available, the orchestrator provides platform-specific reasoning:

- **Linux**: "WebGPU may require Vulkan drivers on Linux"
- **Windows**: "WebGPU requires DirectX 12 support"
- **macOS**: "WebGPU requires macOS 13.0+ with Metal support"

## Testing by Platform

### Linux Testing Checklist
- [ ] Vulkan drivers installed
- [ ] `vulkaninfo --summary` shows GPU support
- [ ] Chrome/Chromium with WebGPU flags enabled
- [ ] Not running in VM without GPU passthrough

### Windows Testing Checklist
- [ ] DirectX 12 support available
- [ ] Latest GPU drivers installed
- [ ] Hardware acceleration enabled
- [ ] Chrome/Edge 113+ with WebGPU enabled

### macOS Testing Checklist
- [ ] macOS 13.0+ (Ventura)
- [ ] Metal-compatible hardware (2012+)
- [ ] Safari 16.0+ or Chrome 113+
- [ ] WebGPU enabled in browser flags/settings

## Graceful Degradation

The application follows a graceful degradation approach:

1. **Primary**: Try to use WebGPU for on-device AI
2. **Fallback**: Use cloud-based AI when WebGPU is unavailable
3. **User Experience**: Provide clear error messages and troubleshooting steps
4. **Platform Awareness**: Tailor messages and configuration to each OS

## Browser Compatibility

### Minimum Browser Versions
- **Chrome/Edge**: 113+
- **Safari**: 16.0+ (macOS only)
- **Firefox**: WebGPU support in progress (not recommended)

### Required Flags
- Chrome/Edge: `chrome://flags/#enable-webgpu`
- Safari: Enable in Developer menu (Experimental Features)

## Troubleshooting Commands

### Linux
```bash
# Check GPU info
glxinfo | grep -E "OpenGL version|OpenGL renderer"

# Check Vulkan support
vulkaninfo --summary

# Install Intel drivers
sudo apt install mesa-vulkan-drivers

# Install NVIDIA drivers
sudo ubuntu-drivers autoinstall
```

### Windows
- Update GPU drivers through Device Manager
- Enable hardware acceleration in browser settings
- Check DirectX 12 support with `dxdiag`

### macOS
- Check macOS version: `sw_vers`
- Update through System Preferences
- Enable WebGPU in Safari Develop menu

## Future Enhancements

Potential improvements for platform support:

1. **Automatic Driver Detection**: Detect installed drivers and provide specific instructions
2. **GPU Capability Detection**: Check GPU memory and performance characteristics
3. **Hybrid Mode**: Use WebGPU for some tasks and cloud for others based on complexity
4. **Progressive Enhancement**: Start with cloud AI, fall back to WebGPU when available
