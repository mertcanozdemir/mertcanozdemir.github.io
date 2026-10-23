---
layout: base
permalink: /
wide: true
title: How MRI reconstruction methods compare
---

<p class="rg-howto">Methods from the studies behind Fig. 2 of the paper, joined when a study measured them side by side. Distance from U-Net is not quality: the closer a method, the more firmly the comparisons tie it to U-Net (circles: ± standard error, the same in every window). Click one for details; the notes under the graph explain the controls.</p>

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
        <canvas aria-label="Comparison graph of reconstruction methods"></canvas>
        <div class="rg-seg rg-view" data-view role="group" aria-label="View">
          <button type="button" aria-pressed="true" data-v="2d">2D</button>
          <button type="button" aria-pressed="false" data-v="3d">3D</button>
        </div>
        <button type="button" class="rg-reset" data-reset>reset view</button>
        <button type="button" class="rg-straighten" data-straighten hidden>straighten axes</button>
        <p class="rg-hint" data-hint hidden>Height: difference from U-Net. Drag to turn.</p>
        <div class="rg-tip" data-tip hidden></div>
      </div>
      <div class="rg-legend" data-legend role="group" aria-label="Model families"></div>
    </div>
    <aside class="rg-panel" data-panel aria-live="polite"></aside>
  </div>
</div>

<ul class="rg-guide">
  <li><b>θ</b> is the difference from U-Net (fastMRI), in dB for PSNR or logit for SSIM, fitted only on differences within a study, so methods never compared directly still share one scale.</li>
  <li><b>A window</b> (2025 covers 2024–2026) is fitted on its studies alone and shows every method they measured, older baselines included: a 2019 method appears in 2026 when a 2026 study compared against it.</li>
  <li><b>Proposed only</b> hides the methods no study proposed. In a window it keeps only those that came out in its years.</li>
  <li><b>Measured in</b>, on a method's card, lists the studies its θ comes from; a comparator's own paper is usually not one of them.</li>
  <li><b>Since</b> marks a proposed method's first year in these studies. Comparators get none, as their own paper can be much older than the studies that compared them.</li>
  <li><b>3D</b> lifts each method to its θ, so height is the difference from U-Net: drag down to tilt into it, drag to turn, let go near the top view to return to 2D.</li>
  <li><b>Other</b>, classical and miscellaneous methods, starts hidden; click a family under the graph to show or hide it. <b>In ≥2 studies</b> keeps the methods measured that often.</li>
</ul>

<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
<script src="{{ '/assets/js/recon-graph.js' | relative_url }}?v={{ site.time | date: '%s' }}"></script>
