const MODELS_JSON_PATH = "models.json";
const CONTRIBUTORS_JSON_PATH = "contributors.json";

/**
 * Try to build a lightweight hardware profile from browser APIs.
 * This is necessarily approximate; it informs ranking but is never strict.
 */
function detectHardware() {
  const nav = navigator || {};
  const ua = nav.userAgent || "";
  const platform = nav.platform || "";
  const cores =
    typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null;
  const memory =
    typeof nav.deviceMemory === "number" ? nav.deviceMemory : null; // in GB, very rough

  let os = "Unknown";
  if (/Mac OS X/.test(ua) || /Macintosh/.test(ua)) os = "macOS";
  else if (/Windows NT/.test(ua)) os = "Windows";
  else if (/Linux/.test(ua)) os = "Linux";

  // Attempt crude Apple Silicon detection from user agent hints
  const isAppleSilicon =
    os === "macOS" &&
    (/Apple Silicon/.test(ua) ||
      /arm64/.test(ua) ||
      /; U; CPU OS/.test(ua)); // very weak heuristic

  // GPU info from WebGL
  let gpu = null;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (gl) {
      const dbgInfo = gl.getExtension("WEBGL_debug_renderer_info");
      if (dbgInfo) {
        const renderer = gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL);
        const vendor = gl.getParameter(dbgInfo.UNMASKED_VENDOR_WEBGL);
        gpu = `${vendor} ${renderer}`.trim();
      }
    }
  } catch {
    // ignore
  }

  return {
    os,
    userAgent: ua,
    platform,
    cores,
    approxMemoryGb: memory,
    isAppleSilicon,
    gpu
  };
}

function renderHardwareSummary(hw) {
  const el = document.getElementById("hardware-detected");
  if (!el) return;

  if (!hw) {
    el.textContent = "Could not detect hardware information in this browser.";
    return;
  }

  const items = [];
  items.push({
    label: "OS",
    value: hw.os
  });
  if (hw.isAppleSilicon) {
    items.push({
      label: "CPU",
      value: "Apple Silicon (approximate)"
    });
  }
  if (hw.cores != null) {
    items.push({
      label: "Cores",
      value: `${hw.cores} logical`
    });
  }
  if (hw.approxMemoryGb != null) {
    items.push({
      label: "RAM",
      value: `≈${hw.approxMemoryGb} GB (browser estimate)`
    });
  }
  if (hw.gpu) {
    items.push({
      label: "GPU",
      value: hw.gpu
    });
  }

  el.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "wm-hardware-grid";

  items.forEach((item) => {
    const wrap = document.createElement("div");
    const label = document.createElement("div");
    label.className = "wm-hardware-label";
    label.textContent = item.label;
    const value = document.createElement("div");
    value.className = "wm-hardware-value";
    value.textContent = item.value;
    wrap.appendChild(label);
    wrap.appendChild(value);
    grid.appendChild(wrap);
  });

  el.appendChild(grid);
}

async function loadModels() {
  const res = await fetch(MODELS_JSON_PATH, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load models.json: ${res.status}`);
  }
  return res.json();
}

async function loadContributors() {
  try {
    const res = await fetch(CONTRIBUTORS_JSON_PATH, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Failed to load contributors.json: ${res.status}`);
    }
    return res.json();
  } catch (err) {
    console.error(err);
    return [];
  }
}

/**
 * Simple ranking: prefer models whose hardware_profile is <= detected capabilities,
 * and use purpose/tools filters; then sort by a hand-wavy score.
 */
function scoreModelForHardware(model, hw) {
  if (!hw) return 0;
  const prof = model.hardware_profile || {};

  let score = 0;

  // OS / arch hints
  if (hw.isAppleSilicon && prof.arch === "arm64") score += 3;
  if (!hw.isAppleSilicon && prof.arch === "x86_64") score += 2;

  if (typeof hw.approxMemoryGb === "number" && prof.min_ram_gb != null) {
    if (hw.approxMemoryGb >= prof.min_ram_gb) score += 3;
    else score -= 2;
  }

  if (typeof hw.cores === "number" && prof.min_cores != null) {
    if (hw.cores >= prof.min_cores) score += 1;
  }

  // GPU string contains RTX/AMD etc.
  if (hw.gpu && Array.isArray(model.recommended_for)) {
    const g = hw.gpu.toLowerCase();
    const match = model.recommended_for.some((s) =>
      g.includes(String(s).toLowerCase().split(" ")[1] || "")
    );
    if (match) score += 2;
  }

  return score;
}

const PAGE_SIZE = 10;

function filterAndRender(models, hw) {
  const search = document
    .getElementById("search-input")
    .value.toLowerCase()
    .trim();
  const purpose = document.getElementById("purpose-select").value;
  const tools = document.getElementById("tools-select").value;

  let filtered = models.slice();

  if (purpose) {
    filtered = filtered.filter((m) => m.purpose === purpose);
  }

  if (tools) {
    const val = tools === "true";
    filtered = filtered.filter((m) => !!m.supports_tools === val);
  }

  if (search) {
    filtered = filtered.filter((m) => {
      const haystack = [
        m.model_name,
        m.display_name,
        m.provider,
        m.notes,
        ...(m.recommended_for || [])
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    });
  }

  // Score and sort
  const scored = filtered
    .map((m) => ({
      model: m,
      score: scoreModelForHardware(m, hw)
    }))
    .sort((a, b) => b.score - a.score);

  const listEl = document.getElementById("models-list");
  const summaryEl = document.getElementById("results-summary");
  listEl.innerHTML = "";

  if (!scored.length) {
    summaryEl.textContent = "No models match the current filters.";
    return;
  }

  summaryEl.textContent = `${scored.length} model${
    scored.length === 1 ? "" : "s"
  } match your filters. Showing up to ${Math.min(
    PAGE_SIZE,
    scored.length
  )} at a time. Top results are biased towards your detected hardware.`;

  const topScore = scored[0].score;

  // Pagination: render only the first PAGE_SIZE by default
  const pageSlice = scored.slice(0, PAGE_SIZE);

  pageSlice.forEach(({ model, score }) => {
    const card = document.createElement("article");
    card.className = "wm-model";

    const header = document.createElement("div");
    header.className = "wm-model-header";
    const name = document.createElement("div");
    name.className = "wm-model-name";
    name.textContent = model.display_name || model.model_name;
    const tagline = document.createElement("div");
    tagline.className = "wm-model-tagline";
    tagline.textContent =
      model.notes ||
      "Community suggestion. See models.json for more information.";

    const chips = document.createElement("div");
    chips.className = "wm-chip-row";

    const purposeChip = document.createElement("span");
    purposeChip.className = `wm-chip purpose-${model.purpose}`;
    purposeChip.textContent =
      model.purpose === "coding" ? "Coding" : "General assistant";
    chips.appendChild(purposeChip);

    const toolsChip = document.createElement("span");
    toolsChip.className = `wm-chip tools-${
      model.supports_tools ? "yes" : "no"
    }`;
    toolsChip.textContent = model.supports_tools
      ? "Tools / function calling"
      : "No tools";
    chips.appendChild(toolsChip);

    if (score >= topScore && score > 0) {
      const recChip = document.createElement("span");
      recChip.className = "wm-chip recommended";
      recChip.textContent = "Best match for your machine";
      chips.appendChild(recChip);
    }

    header.appendChild(name);
    header.appendChild(tagline);
    header.appendChild(chips);

    const meta = document.createElement("div");
    meta.className = "wm-model-meta";

    const providerLine = document.createElement("div");
    providerLine.className = "wm-meta-line";
    providerLine.innerHTML = `<span class="wm-small-label">Model</span><br>${
      model.model_name
    } · ${model.provider}`;

    const hwLine = document.createElement("div");
    hwLine.className = "wm-meta-line";
    hwLine.innerHTML = `<span class="wm-small-label">Runs well on</span><br>${(
      model.recommended_for || []
    ).join(", ") || "Community to fill in"}`;

    const linkLine = document.createElement("div");
    linkLine.className = "wm-meta-line";
    if (model.links && model.links.ollama) {
      const a = document.createElement("a");
      a.href = model.links.ollama;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "View on Ollama";
      a.style.color = "#93c5fd";
      linkLine.appendChild(a);
    }

    meta.appendChild(providerLine);
    meta.appendChild(hwLine);
    if (linkLine.childNodes.length) meta.appendChild(linkLine);

    card.appendChild(header);
    card.appendChild(meta);
    listEl.appendChild(card);
  });
  // Add \"Show more\" button if there are more results
  if (scored.length > PAGE_SIZE) {
    const showMoreWrapper = document.createElement("div");
    showMoreWrapper.style.marginTop = "0.75rem";
    showMoreWrapper.style.textAlign = "center";

    const showMoreButton = document.createElement("button");
    showMoreButton.textContent = `Show ${Math.min(
      PAGE_SIZE,
      scored.length - PAGE_SIZE
    )} more`;
    showMoreButton.style.borderRadius = "999px";
    showMoreButton.style.border = "1px solid rgba(148, 163, 184, 0.6)";
    showMoreButton.style.background = "rgba(15, 23, 42, 0.9)";
    showMoreButton.style.color = "#e5e7eb";
    showMoreButton.style.padding = "0.35rem 0.9rem";
    showMoreButton.style.fontSize = "0.85rem";
    showMoreButton.style.cursor = "pointer";

    showMoreButton.addEventListener("click", () => {
      const alreadyShown = listEl.querySelectorAll(".wm-model").length;
      const nextSlice = scored.slice(alreadyShown, alreadyShown + PAGE_SIZE);
      nextSlice.forEach(({ model, score }) => {
        const card = document.createElement("article");
        card.className = "wm-model";

        const header = document.createElement("div");
        header.className = "wm-model-header";
        const name = document.createElement("div");
        name.className = "wm-model-name";
        name.textContent = model.display_name || model.model_name;
        const tagline = document.createElement("div");
        tagline.className = "wm-model-tagline";
        tagline.textContent =
          model.notes ||
          "Community suggestion. See models.json for more information.";

        const chips = document.createElement("div");
        chips.className = "wm-chip-row";

        const purposeChip = document.createElement("span");
        purposeChip.className = `wm-chip purpose-${model.purpose}`;
        purposeChip.textContent =
          model.purpose === "coding" ? "Coding" : "General assistant";
        chips.appendChild(purposeChip);

        const toolsChip = document.createElement("span");
        toolsChip.className = `wm-chip tools-${
          model.supports_tools ? "yes" : "no"
        }`;
        toolsChip.textContent = model.supports_tools
          ? "Tools / function calling"
          : "No tools";
        chips.appendChild(toolsChip);

        if (score >= topScore && score > 0 && alreadyShown === 0) {
          const recChip = document.createElement("span");
          recChip.className = "wm-chip recommended";
          recChip.textContent = "Best match for your machine";
          chips.appendChild(recChip);
        }

        header.appendChild(name);
        header.appendChild(tagline);
        header.appendChild(chips);

        const meta = document.createElement("div");
        meta.className = "wm-model-meta";

        const providerLine = document.createElement("div");
        providerLine.className = "wm-meta-line";
        providerLine.innerHTML =
          `<span class="wm-small-label">Model</span><br>${model.model_name} · ${model.provider}`;

        const hwLine = document.createElement("div");
        hwLine.className = "wm-meta-line";
        hwLine.innerHTML =
          `<span class="wm-small-label">Runs well on</span><br>${(model.recommended_for || []).join(", ") || "Community to fill in"}`;

        const linkLine = document.createElement("div");
        linkLine.className = "wm-meta-line";
        if (model.links && model.links.ollama) {
          const a = document.createElement("a");
          a.href = model.links.ollama;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = "View on Ollama";
          a.style.color = "#93c5fd";
          linkLine.appendChild(a);
        }

        meta.appendChild(providerLine);
        meta.appendChild(hwLine);
        if (linkLine.childNodes.length) meta.appendChild(linkLine);

        card.appendChild(header);
        card.appendChild(meta);
        listEl.appendChild(card);
      });

      const remaining = scored.length - listEl.querySelectorAll(".wm-model").length;
      if (remaining <= 0) {
        showMoreWrapper.remove();
      } else {
        showMoreButton.textContent = `Show ${Math.min(PAGE_SIZE, remaining)} more`;
      }
    });

    showMoreWrapper.appendChild(showMoreButton);
    listEl.parentNode.appendChild(showMoreWrapper);
  }
}

async function init() {
  const repoLink = document.getElementById("repo-link");
  if (repoLink && window.location.hostname.includes("github.io")) {
    // Infer GitHub repo URL from Pages URL if hosted there
    const parts = window.location.pathname.split("/").filter(Boolean);
    if (parts.length >= 1) {
      const user = window.location.hostname.split(".")[0];
      const repo = parts[0];
      repoLink.href = `https://github.com/${user}/${repo}`;
      repoLink.textContent = `${user}/${repo}`;
    }
  }

  const hw = detectHardware();
  renderHardwareSummary(hw);

  let models = [];
  try {
    models = await loadModels();
  } catch (err) {
    console.error(err);
    const listEl = document.getElementById("models-list");
    if (listEl) {
      listEl.textContent =
        "Failed to load models.json. Check that GitHub Pages is serving static assets correctly.";
    }
  }

  const rerender = () => filterAndRender(models, hw);

  document
    .getElementById("search-input")
    .addEventListener("input", rerender);
  document
    .getElementById("purpose-select")
    .addEventListener("change", rerender);
  document
    .getElementById("tools-select")
    .addEventListener("change", rerender);

  if (models.length) {
    rerender();
  }

  // Load contributors in parallel but independently of models
  const contributorsContainer = document.getElementById("contributors-list");
  if (contributorsContainer) {
    const contributors = await loadContributors();
    contributorsContainer.innerHTML = "";
    if (!contributors.length) {
      contributorsContainer.textContent =
        "No contributors listed yet. Be the first by sending a pull request!";
    } else {
      contributors.forEach((c) => {
        const badge = document.createElement("div");
        badge.className = "wm-contributor";
        const name = document.createElement("span");
        name.textContent = c.name || c.github;
        badge.appendChild(name);
        if (c.github) {
          const link = document.createElement("a");
          link.href = `https://github.com/${c.github}`;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = ` @${c.github}`;
          link.style.marginLeft = "0.35rem";
          badge.appendChild(link);
        }
        contributorsContainer.appendChild(badge);
      });
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  init().catch((err) => {
    console.error("Initialization failed", err);
  });
});

