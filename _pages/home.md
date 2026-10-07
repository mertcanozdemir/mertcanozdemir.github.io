---
layout: base
permalink: /
wide: true
title: How MRI reconstruction methods compare
---

<ul class="rg-howto">
  <li>Each dot is a reconstruction method evaluated in the studies behind Fig. 2 of the paper, proposed methods and their comparators alike; a line joins two methods measured side by side in the same paper.</li>
  <li>Distance from U-Net, in the middle, shows how firmly the evidence ties a method to it. The circles mark the standard error (±) of its effectiveness against U-Net, which grows with the effective resistance between the two in the graph: methods compared with U-Net across many papers sit close, methods resting on a single paper sit further out.</li>
  <li>Select a method to see where it stands against U-Net and what it has been compared with.</li>
  <li>Switch between PSNR and SSIM, or pick a publication window.</li>
  <li>Turn families on and off below the graph. Scroll to zoom, drag to pan.</li>
  <li>Reset view takes you back to the whole graph.</li>
</ul>

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
    </div>
    <aside class="rg-panel" data-panel aria-live="polite"></aside>
  </div>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
<script src="{{ '/assets/js/recon-graph.js' | relative_url }}"></script>
