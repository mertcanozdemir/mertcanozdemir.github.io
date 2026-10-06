---
layout: base
permalink: /
wide: true
title: MRI reconstruction results
description: From my work at UMRAM — PSNR and SSIM values reported in the MRI reconstruction literature, each traced to its source.
---

<div class="recon" data-src="{{ '/assets/json/mri_recon_data.json' | relative_url }}">
  <p class="recon-scope" data-scope>Loading…</p>

  <div class="recon-controls" hidden data-controls>
    <div class="recon-views" data-views role="group" aria-label="View"></div>
    <div class="recon-filters" data-filters>
      <input type="search" data-q placeholder="model, paper title or dataset" aria-label="Search" />
      <select data-f="anatomy" aria-label="Anatomy"></select>
      <select data-f="family" aria-label="Architecture family"></select>
      <div class="recon-chips" data-chips role="group" aria-label="Acceleration"></div>
      <label class="recon-toggle">
        <input type="checkbox" data-inmain checked />
        main analysis only
      </label>
    </div>
  </div>

  <div data-list>
    <p class="recon-count" data-count></p>
    <div data-results></div>
  </div>

  <div
    class="recon-graph"
    data-graph
    hidden
    data-src="{{ '/assets/json/mri_recon_graph.json' | relative_url }}"
    data-script="{{ '/assets/js/recon-graph.js' | relative_url }}"
  >
    <div class="rg-controls">
      <div class="rg-seg" data-metric role="group" aria-label="Metric">
        <button type="button" aria-pressed="true" data-v="psnr">PSNR</button>
        <button type="button" aria-pressed="false" data-v="ssim">SSIM</button>
      </div>
      <select data-win aria-label="Publication window"></select>
      <select data-min aria-label="Minimum number of studies">
        <option value="1">all methods</option>
        <option value="2">in ≥2 studies</option>
        <option value="3">in ≥3 studies</option>
        <option value="5">in ≥5 studies</option>
      </select>
      <input type="search" data-find list="rg-names" placeholder="find a method" aria-label="Find a method" />
      <datalist id="rg-names"></datalist>
    </div>
    <div class="rg-explorer">
      <div class="rg-main">
        <div class="rg-stage" data-stage>
          <canvas aria-label="Evidence graph of reconstruction methods"></canvas>
          <button type="button" class="rg-reset" data-reset>reset view</button>
          <div class="rg-tip" data-tip hidden></div>
        </div>
        <div class="rg-legend" data-legend role="group" aria-label="Model families"></div>
        <p class="rg-hint" data-hint></p>
      </div>
      <aside class="rg-panel" data-panel aria-live="polite"></aside>
    </div>
  </div>

</div>

<script src="{{ '/assets/js/recon.js' | relative_url }}" defer></script>
