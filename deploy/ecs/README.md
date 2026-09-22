# Alibaba GPU ECS deployment

The current deployment deliberately keeps both services on loopback. It does not require or authorize a shared security-group change.

## Layout

```text
/opt/placeecho/current-api -> releases/api-*/ (active API release)
/opt/placeecho/releases/  immutable source and API release directories
/opt/placeecho/data/      API storage plus worker input/output mount
/opt/placeecho/app/       deployment source/build context
/opt/placeecho/vendor/    private Insta360 delivery archive
```

The API runs as the unprivileged `placeecho` system user. Docker owns the GPU Worker process and mounts `/opt/placeecho/data` at `/data`. The worker container is Ubuntu 22.04 with the host A10 driver passed through by NVIDIA Container Toolkit.

## Private services

- API: `127.0.0.1:3000`
- GPU Worker: `127.0.0.1:8001`

Use an authenticated HTTPS gateway before making the API externally reachable. Never open the Worker port.

## OSS activation

The target bucket is `team28-insta360xboldmaker` in `oss-cn-hangzhou`. `OSSStorageProvider` is implemented with auto-refreshing ECS-role STS credentials. Bind a least-privilege ECS RAM role for only the required bucket prefixes, then select it in `/etc/placeecho/api.env`. Do not put a long-lived AccessKey in `.env`, a systemd unit, Git, or a container image.

Do not mount the bucket with ossfs, BatchCompute mappings, or Cloud Storage Gateway for this pipeline. The API reads and writes durable objects through the OSS SDK. Only the inputs needed by one MediaSDK invocation are staged into `/opt/placeecho/data`; its output is uploaded to OSS and the scratch files are removed. This preserves object-storage semantics and avoids adding a paid gateway or treating large `.insp` objects as a general-purpose filesystem.

Recommended private prefixes:

```text
placeecho/scenes/*/media/*
placeecho/scenes/*/panorama/*
placeecho/jobs/*
```

Example service configuration after the role is attached:

```text
STORAGE_PROVIDER=oss
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=team28-insta360xboldmaker
OSS_PREFIX=placeecho/
OSS_INTERNAL=true
ALIBABA_CLOUD_IMDSV1_DISABLED=true
WORKER_DATA_DIR=/opt/placeecho/data
```

`OSS_ECS_RAM_ROLE` is optional because the metadata service can return the attached role name. Until the role exists, `LocalStorageProvider` remains active so the API does not fail at startup.

## Marble activation

The API implements the asynchronous World Labs boundary at `POST /api/scenes/:sceneId/world/generate`. Put `WLT_API_KEY` only in `/etc/placeecho/api.env` with mode `0600`; never commit it. `MARBLE_API_BASE_URL` and `MARBLE_MODEL` are optional overrides. The ECS only needs outbound HTTPS access—no inbound security-group rule is required.

## End-to-end smoke test

From the ECS host, pass one or more private `.insp` paths to:

```bash
bash /opt/placeecho/deploy/smoke-panorama-api.sh /path/to/one.insp /path/to/two.insp
```

The script creates a Scene, uploads each file through the public API contract, creates a panorama job, polls job state, and prints the completed job and updated Scene. It does not publish or delete media.
