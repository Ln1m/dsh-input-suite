# dsh-input-suite

[中文](README.md) | English

Composer area: skill sets

## Packages

| Directory | What it does |
|---|---|
| `dsh-skill-sets` | Group skills into task-type sets; switching a set swaps the injected skill list |

## Release lines

| Release | DSH line | Notes |
|---|---|---|
| `v0.1.3` | 0.1.7 | This sync: right-column two-axis docking, plus this batch of skeleton and column changes |
| `v0.1.2` | 0.1.7 | Previous release of the 0.1.7 line |
| `v0.1.0` | 0.1.6 | Last release of the DSH 0.1.6 line; stays usable, no further updates |

## Install

```sh
# one package
dsh plugin --profile web add file:<this repo>/dsh-skill-sets
```

Or install the whole family on Windows PowerShell:

```powershell
./install.ps1
```

Install straight from the release, no clone needed:

```sh
dsh plugin --profile web add "https://github.com/Ln1m/dsh-input-suite/releases/download/v0.1.3/dsh-skill-sets-0.1.3.tgz"
```

If the install fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` (a TLS-intercepting proxy; Node does not read the system CA store by default), run `$env:NODE_OPTIONS='--use-system-ca'` first.

Restart the web instance afterwards. Each package directory carries its own README.

## Screenshots

![dsh-skill-sets](dsh-skill-sets/assets/dsh-skill-sets.png)

## License

MIT
