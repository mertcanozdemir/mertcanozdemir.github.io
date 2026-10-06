---
layout: base
permalink: /drills/
title: drills
nav: true
nav_order: 2
wide: true
---

<ul class="drill-legend" aria-label="Key">
  <li>
    <svg viewBox="0 0 26 10" aria-hidden="true"><line x1="1" y1="5" x2="25" y2="5" stroke="var(--rink-pass)" stroke-width="1.6" stroke-dasharray="4 2.5" /></svg>
    pass
  </li>
  <li>
    <svg viewBox="0 0 26 10" aria-hidden="true"><line x1="1" y1="5" x2="25" y2="5" stroke="var(--rink-shot)" stroke-width="1.6" /></svg>
    shot
  </li>
  <li>
    <svg viewBox="0 0 26 10" aria-hidden="true"><path d="M 1 7 Q 13 0 25 6" fill="none" stroke="var(--rink-team-a)" stroke-width="1.2" stroke-dasharray="3.5 2.5" opacity=".6" /></svg>
    skating path
  </li>
  <li>
    <svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.6" fill="var(--rink-team-a)" stroke="var(--rink-puck)" stroke-width="1.4" /></svg>
    has the puck
  </li>
  <li>
    <svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="2" fill="var(--rink-puck)" stroke="var(--rink-puck-edge)" stroke-width=".5" /></svg>
    loose puck
  </li>
  <li>
    <svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="var(--rink-team-b)" /></svg>
    opposition
  </li>
  <li>
    <svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="var(--rink-team-n)" /></svg>
    passer or coach
  </li>
  <li>
    <svg viewBox="0 0 12 12" aria-hidden="true"><polygon points="6,1.5 2,10 10,10" fill="var(--rink-cone)" stroke="var(--rink-cone-edge)" stroke-width=".6" /></svg>
    pylon
  </li>
</ul>
<p class="drill-intro">Select a step to jump to it.</p>

{% include drills/sections.liquid %}

<script>
  window.DRILLS = {{ site.data.drills | jsonify }};
</script>
<script src="{{ '/assets/js/drills.js' | relative_url }}"></script>
