---
layout: page
permalink: /recon/
title: recon results
description: Reported MRI reconstruction results from the literature, with provenance.
nav: true
nav_order: 0
---

<div class="recon" data-src="{{ '/assets/json/mri_recon_data.json' | relative_url }}">
  <p class="recon-scope" data-scope>Loading…</p>

  <div class="recon-controls" hidden data-controls>
    <input type="search" data-q placeholder="model, paper title or dataset" aria-label="Search" />
    <select data-f="anatomy" aria-label="Anatomy"></select>
    <select data-f="family" aria-label="Architecture family"></select>
    <div class="recon-chips" data-chips role="group" aria-label="Acceleration"></div>
    <label class="recon-toggle">
      <input type="checkbox" data-inmain checked />
      main analysis only
    </label>
  </div>

  <p class="recon-count" data-count></p>
  <div data-results></div>
</div>

---

## How to read this

Reported values are **not comparable across papers**. Preprocessing, evaluation
masks, coil combination, normalisation and metric implementations all differ, so
a PSNR of 33.2 in one paper is not better than 33.0 in another. There is no
ranking here and no overall leaderboard.

Values are only comparable **within a cell** — rows a single paper ran side by
side under one protocol. Select any row to see its cell: those models were
measured together, so their differences mean something.

## How the numbers were extracted

<p class="recon-extraction" data-extraction></p>

Every value carries its source: the paper, the table or figure it was read from,
and the page. Follow the link and check it. If a value is wrong,
[report it](https://github.com/mertcanozdemir/mertcanozdemir.github.io/issues/new?title=Data+error)
with the paper and table, and it will be corrected at source.

<script src="{{ '/assets/js/recon.js' | relative_url }}" defer></script>
