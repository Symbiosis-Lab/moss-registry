# registry/keys/

The public keys moss pins for the catalog, one minisign `.pub` file each: the key the publish run signs with, and a backup made at the same time and kept offline. The same keys are compiled into moss; a key changes only through a moss release.

The publish run refuses to deploy `index.json` or `revoked.json` without a valid signature by one of these keys, and refuses too if this folder holds no key.

The private halves are never in this repository. The signing key lives in the `MOSS_REGISTRY_SIGNING_KEY` secret of the `catalog-signing` environment, which accepts only `main`; the backup stays offline.

Setting a key up goes in this order, because GitHub creates an environment named in a workflow with no branch rule, and a manual run from any branch could then read the secret:

1. Make the key pair with `minisign -G -W`. The `-W` leaves the secret key without a passphrase, because the signing job has no terminal to type one into; the secret store encrypts it instead.
2. In the repository's settings, create the `catalog-signing` environment and limit its deployment branches to `main`.
3. Add the secret key file's contents to that environment as `MOSS_REGISTRY_SIGNING_KEY`.
4. Commit the signing key's and the backup key's `.pub` files here. Pinning them in moss ships separately, after a publish has signed the catalog.
