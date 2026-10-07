---
layout: base
permalink: /
wide: true
title: How MRI reconstruction methods compare
---

<p class="rg-howto">Methods from the studies behind Fig. 2 of the paper, joined when compared in the same paper. The closer to U-Net, the firmer the evidence (circles: ± standard error). Click a method for details.</p>

<div
  class="recon-graph"
  data-graph
  data-src="{{ '/assets/json/mri_recon_graph.json' | relative_url }}?v={{ site.time | date: '%s' }}"
>
  <div class="rg-controls">
    <div class="rg-seg" data-metric role="group" aria-label="Metric">
      <button type="button" aria-pressed="true" data-v="psnr">PSNR</button>
      <button type="button" aria-pressed="false" data-v="ssim">SSIM</button>
    </div>
    <select data-win aria-label="Publication window"></select>
    <div class="rg-seg" role="group" aria-label="Methods shown">
      <button type="button" aria-pressed="false" data-proposed>Proposed only</button>
    </div>
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
    </div>
    <aside class="rg-panel" data-panel aria-live="polite"></aside>
  </div>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
<script src="{{ '/assets/js/recon-graph.js' | relative_url }}?v={{ site.time | date: '%s' }}"></script>
