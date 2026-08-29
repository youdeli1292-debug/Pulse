# CI templates

These are ready-to-use GitHub Actions workflows. They live in `docs/ci/`
instead of `.github/workflows/` only because the token that pushed this commit
had no `workflows` permission — copy them one level up to activate them:

```bat
:: Windows (CMD)
mkdir .github\workflows
copy docs\ci\build-windows.yml .github\workflows\
copy docs\ci\pages.yml .github\workflows\
```

```bash
# macOS / Linux
mkdir -p .github/workflows
cp docs/ci/*.yml .github/workflows/
```

| Workflow | Trigger | Result |
| --- | --- | --- |
| `build-windows.yml` | tag `v*` or manual | builds the portable `.exe` on `windows-latest`, uploads it as an artifact and attaches it to the release |
| `pages.yml` | push to `main` touching `site/**` or manual | publishes `site/` to GitHub Pages (enable Pages → *GitHub Actions* once) |
