FROM nvcr.io/nvidia/cuda:12.8.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src \
    PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ \
    PIP_DEFAULT_TIMEOUT=120

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# The proprietary SDK package is supplied at deploy time and is never committed.
COPY vendor/MediaSDK-3.1.7-linux-amd64.deb /tmp/MediaSDK.deb
RUN apt-get update \
    && apt-get install -y --no-install-recommends /tmp/MediaSDK.deb \
    && rm -f /tmp/MediaSDK.deb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY src ./src
RUN python3 -m pip install --no-cache-dir \
    "fastapi>=0.116,<1" \
    "uvicorn[standard]>=0.35,<1"

EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "placeecho_gpu_worker.main:app", "--host", "0.0.0.0", "--port", "8000"]
