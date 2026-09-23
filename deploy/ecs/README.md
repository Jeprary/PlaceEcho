# Alibaba GPU ECS deployment

The current deployment deliberately keeps both services on loopback. It does not require or authorize a shared security-group change.

## Layout

```text
/opt/placeecho/current-api -> releases/api-*/ (active API release)
/opt/placeecho/releases/  immutable source and API release directories
/opt/placeecho/data/      API storage plus worker input/output mount
/mnt/placeecho-oss/       optional Cloud Storage Gateway NFS mount
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

Direct OSS SDK access through an ECS RAM role is preferred. If the account administrator does not permit role attachment or AccessKey creation, use Cloud Storage Gateway (CSG) with NFS. Do not use BatchCompute mappings, which do not apply to a normal ECS instance, and do not use ossfs for this large-file pipeline. In either remote mode, only the inputs needed by one MediaSDK invocation are staged into `/opt/placeecho/data`; its output is copied back to durable storage and the scratch files are removed.

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

### Cloud Storage Gateway fallback

Create a CSG file gateway in `cn-hangzhou`, in the same VPC and vSwitch as Team28, and expose the `placeecho` bucket prefix through NFS. CSG is separately billed and requires a cache disk; confirm its price before creation. Once the console provides the NFS server mount point:

1. Install the NFS client on the ECS and mount the share at `/mnt/placeecho-oss` with `_netdev` persistence.
2. Verify the mount is writable by the `placeecho` service user.
3. Install `deploy/ecs/placeecho-api-mounted.conf` as a systemd drop-in so the API cannot start before the remote filesystem is mounted.
4. Configure `/etc/placeecho/api.env` as follows:

```text
STORAGE_PROVIDER=mounted
MOUNTED_STORAGE_DIR=/mnt/placeecho-oss
WORKER_DATA_DIR=/opt/placeecho/data
```

The mounted directory is durable storage only. MediaSDK inputs and outputs still use local scratch storage and are cleaned after each job.

The checked-in helper performs those steps idempotently after an administrator supplies the CSG mount point:

```bash
bash /opt/placeecho/releases/source-20260922-csg/deploy/ecs/configure-csg-mount.sh \
  172.16.0.2:/share-name
```

It does not change any security-group rule. If the OSS console reports `NoPermission` for `hcs-sgw:*`, the current RAM user cannot create or even inspect the gateway; an account administrator must create it and provide the non-secret NFS mount point.

## Marble activation

The API implements the asynchronous World Labs boundary at `POST /api/scenes/:sceneId/world/generate`. Put `WLT_API_KEY` only in `/etc/placeecho/api.env` with mode `0600`; never commit it. The default model is `marble-1.1-plus`; `MARBLE_API_BASE_URL` and `MARBLE_MODEL` are optional overrides. Legacy names such as `Marble 0.1-mini` are deprecated and must not be used for new deployments. The ECS only needs outbound HTTPS access—no inbound security-group rule is required.

## Aholo Lux3D Hero Objects

The optional Aholo provider uses outbound HTTPS and does not require a new
security-group rule. Create the key in the matching Aholo region, then place it
only in `/etc/placeecho/api.env` (mode `0600`):

```text
AHOLO_API_KEY=<secret managed outside Git>
AHOLO_REGION=cn
```

Use `AHOLO_REGION=com` only with a Global Aholo key. Restart the API after the
environment file changes. Do not paste the key into chat, commit it, put it in a
container image, or send it in a browser request. A real Hero request transmits
the supplied image URLs to Aholo and may consume credits, so the public route
requires `confirm_external_processing: true` on every submission. Contract tests
use an injected fake provider and never upload media or create a paid task.

## End-to-end smoke test

From the ECS host, pass one or more private `.insp` paths to:

```bash
bash /opt/placeecho/deploy/smoke-panorama-api.sh /path/to/one.insp /path/to/two.insp
```

The script creates a Scene, uploads each file through the public API contract, creates a panorama job, polls job state, and prints the completed job and updated Scene. It does not publish or delete media.
