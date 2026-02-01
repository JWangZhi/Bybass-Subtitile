# ============================================
# Bypass Subtitles Backend - Dockerfile
# Supports GPU (CUDA) and CPU modes
# ============================================

FROM python:3.11-slim AS base

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast Python package management
RUN pip install uv

WORKDIR /app

# Copy project files
COPY pyproject.toml uv.lock ./
COPY *.py ./
COPY services/ ./services/
COPY models/ ./models/

# Install Python dependencies
RUN uv pip install --system .

# Expose port
EXPOSE 8765

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8765/health || exit 1

# Default command
CMD ["python", "main.py"]

# ============================================
# GPU Stage (for CUDA support) - Commented out for Render CPU Deploy
# ============================================
# FROM nvidia/cuda:12.1-cudnn8-runtime-ubuntu22.04 AS gpu

# # Install Python and system dependencies
# RUN apt-get update && apt-get install -y --no-install-recommends \
#     python3.11 \
#     python3-pip \
#     python3.11-venv \
#     ffmpeg \
#     libsndfile1 \
#     curl \
#     && rm -rf /var/lib/apt/lists/* \
#     && ln -sf /usr/bin/python3.11 /usr/bin/python

# # Install uv
# RUN pip install uv

# WORKDIR /app

# # Copy project files
# COPY pyproject.toml .
# COPY *.py ./
# COPY services/ ./services/
# COPY models/ ./models/

# # Install Python dependencies
# RUN uv pip install --system .

# EXPOSE 8765

# HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
#     CMD curl -f http://localhost:8765/health || exit 1

# CMD ["python", "main.py"]
