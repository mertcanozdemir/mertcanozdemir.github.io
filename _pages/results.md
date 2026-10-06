---
# The papers/results browser, hidden for now while the evidence graph is the
# home page. To open it again, drop `published: false`, take its data and
# script out of `exclude` in _config.yml, and give it a menu entry (nav: true).
published: false
layout: base
permalink: /results/
wide: true
title: MRI reconstruction results
description: From my work at UMRAM — PSNR and SSIM values reported in the MRI reconstruction literature, each traced to its source.
---

<div
  class="recon"
  data-src="{{ '/assets/json/mri_recon_data.json' | relative_url }}"
>
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

</div>

<script src="{{ '/assets/js/recon.js' | relative_url }}" defer></script>
