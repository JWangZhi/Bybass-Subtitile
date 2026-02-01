#!/bin/bash
# Run script for Bypass Subtitles Backend
# Sets up CUDA library paths for WSL2

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Set CUDA library paths from pip packages
VENV_DIR="$SCRIPT_DIR/.venv"
if [ -d "$VENV_DIR" ]; then
    # Dynamically find python version directory
    PY_VER=$(ls "$VENV_DIR/lib" | grep "python3." | head -n 1)
    NVIDIA_LIBS="$VENV_DIR/lib/$PY_VER/site-packages/nvidia"
else
    # Fallback or assume system python (less likely to work for this specific nvidia setup)
    echo "Warning: .venv not found at $VENV_DIR"
    NVIDIA_LIBS=""
fi

# Export library paths
export LD_LIBRARY_PATH="$NVIDIA_LIBS/cublas/lib:$NVIDIA_LIBS/cudnn/lib:$LD_LIBRARY_PATH"

# Run the server
cd "$SCRIPT_DIR"
uv run python main.py "$@"
