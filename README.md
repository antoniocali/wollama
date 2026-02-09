
## Which local model?

Static GitHub Pages site plus a `models.json` file that the community can edit
to recommend the best Ollama models for different hardware setups.

### How it works

- **Data source**: `models.json` at the repo root lists recommended models, their purpose
  (e.g. general vs coding), whether they support tools, and which hardware they run well on.
- **Frontend**: `index.html`, `style.css`, and `script.js` form a small SPA:
  - Detects limited hardware info from the browser (OS, cores, rough RAM, GPU string).
  - Ranks and highlights models that are a good match for your machine.
  - Provides search and filters for purpose (general/coding) and tools (yes/no).
- **Hosting**: GitHub Pages serves the static site directly from this repository.
- **Author**: Antonio Davide Cali (`https://github.com/antoniocali`)

### Contributing models

1. Edit `models.json` and add a new entry following the existing examples:
   - **id**: unique string identifier.
   - **model_name**: Ollama model name (e.g. `llama3.1:8b`).
   - **display_name**: human-readable label for the UI.
   - **provider**: usually `"Ollama"`.
   - **purpose**: `"general"` or `"coding"` (more can be added later if needed).
   - **supports_tools**: `true` if the model is intended for tool use/function calling.
   - **recommended_for**: array of strings describing hardware it runs well on
     (e.g. `"Apple M1 Pro"`, `"RTX 3060 12GB"`, `"32GB RAM desktop"`).
   - **hardware_profile**: approximate minimum requirements (RAM, VRAM, cores, arch).
   - **notes**: short explanation of tradeoffs, quality, and usage tips.
   - **links**: optional URLs (e.g. `{"ollama": "https://ollama.com/library/llama3.1"}`).
2. Run a quick JSON validation locally if you can (e.g. `jq . models.json`).
3. Open a pull request describing:
   - Your hardware (CPU, GPU, RAM).
   - Latency/throughput experience.
   - Any caveats (swapping, overheating, batch size limits, etc.).

### GitHub Pages / CI

This repository is configured with a simple GitHub Actions workflow in
`.github/workflows/pages.yml` that:

- Builds nothing (the site is static) and uploads the root directory as an artifact.
- Deploys that artifact to GitHub Pages on every push to `main`.

To enable Pages:

1. Go to **Settings → Pages** in your GitHub repo.
2. Select **GitHub Actions** as the source.
3. Push to `main` and wait for the `Deploy GitHub Pages` workflow to complete.

### Local preview

Since it is a static site, you must serve it over HTTP (opening `index.html` via `file://`
won't allow `fetch()` to load `models.json`).

Use any static server you like. For example:

```bash
npx serve .
```

Then open the URL printed by the command (usually `http://localhost:3000`).

