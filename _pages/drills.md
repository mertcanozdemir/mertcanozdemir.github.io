---
layout: page
permalink: /drills/
title: drills
description: Ice hockey drill diagrams from my own training notes.
nav: true
nav_order: 4
---

<p class="drill-intro">
  Press play to run a drill, or drag the slider to step through it.
  Dashed lines are passes, solid red is a shot.
</p>

{% for drill in site.data.drills %}
  <article class="drill" data-drill="{{ drill.id }}">
    <h2>{{ drill.title }}</h2>
    <p class="drill-meta">{{ drill.category }} · {{ drill.duration }} min</p>
    {% if drill.notes %}<p class="drill-notes">{{ drill.notes }}</p>{% endif %}
    <svg viewBox="-31.5 -16.5 63 33" role="img" aria-label="{{ drill.title }} diagram">
      <g class="trails"></g>
      <g class="events"></g>
      <g class="actors"></g>
    </svg>
    <div class="drill-controls">
      <button type="button" class="drill-play" aria-label="Play drill">▶ Play</button>
      <input type="range" min="0" max="1000" value="0" aria-label="Drill progress" />
      <button type="button" class="drill-reset" aria-label="Reset drill">↺</button>
    </div>
  </article>
{% endfor %}

<script>
  window.DRILLS = {{ site.data.drills | jsonify }};
</script>
<script src="{{ '/assets/js/drills.js' | relative_url }}"></script>
