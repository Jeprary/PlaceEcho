# PlaceEcho Repository Security

Treat all Git history as eventually public.

Do not commit credentials, `.env` files, private panoramas or personal media,
`.local-data/`, model weights, SDK binaries, generated Hero assets, Gaussian
worlds, Colliders, or other large generated 3D artifacts. Keep local runtime
data under the ignored `.local-data/` directory or an approved external storage
provider.

Before publishing a branch or changing repository visibility, review both the
current tree and reachable Git history for secrets and private assets.
