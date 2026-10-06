---
layout: base
permalink: /
wide: true
title: How MRI reconstruction methods compare
# The counts are the PSNR all-years graph's largest component (802 methods, 322
# studies, from umram 542a2dca); update them when mri_recon_graph.json changes.
description: About 800 reconstruction methods from 322 studies, linked whenever a paper measured two of them side by side. Select a method to see where it stands against U-Net and what it has been compared with.
---

<div
  class="recon-graph"
  data-graph
  data-src="{{ '/assets/json/mri_recon_graph.json' | relative_url }}"
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

<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
<script src="{{ '/assets/js/recon-graph.js' | relative_url }}"></script>
