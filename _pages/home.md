---
layout: base
permalink: /
wide: true
---

{% comment %}
Draft: the home page as a list of pieces, newest first. The pictures are
placeholders until each piece has its own live preview.
{% endcomment %}

<p class="pieces-intro">Mertcan Özdemir · MRI, ice hockey, small electronics</p>

<div class="pieces">

<div class="piece is-lead is-soon">
  <svg class="piece-art" viewBox="0 0 200 100" aria-hidden="true">
    <rect x="6" y="6" width="88" height="88" rx="4" class="art-panel" />
    <g class="art-lines">
      <line x1="10" x2="90" y1="14" y2="14" /><line x1="10" x2="90" y1="26" y2="26" />
      <line x1="10" x2="90" y1="38" y2="38" /><line x1="10" x2="90" y1="46" y2="46" />
      <line x1="10" x2="90" y1="50" y2="50" /><line x1="10" x2="90" y1="54" y2="54" />
      <line x1="10" x2="90" y1="62" y2="62" /><line x1="10" x2="90" y1="74" y2="74" />
      <line x1="10" x2="90" y1="86" y2="86" />
    </g>
    <rect x="106" y="6" width="88" height="88" rx="4" class="art-panel" />
    <ellipse cx="150" cy="50" rx="26" ry="30" class="art-head" />
    <ellipse cx="150" cy="38" rx="26" ry="30" class="art-ghost" />
    <ellipse cx="150" cy="62" rx="26" ry="30" class="art-ghost" />
  </svg>
  <span class="piece-text">
    <span class="piece-title">Why does an MRI take so long?</span>
    <span class="piece-desc">Sample k-space yourself and watch the image come together.</span>
    <span class="piece-meta">coming soon</span>
  </span>
</div>

<a class="piece" href="{{ '/drills/' | relative_url }}">
  <span class="piece-art piece-drill" data-drill="two-on-one-give-and-go" data-preview>
    <svg viewBox="-30.6 -16.8 61.2 34.2" aria-hidden="true">
      <g class="trails"></g>
      <g class="events"></g>
      <g class="actors"></g>
    </svg>
  </span>
  <span class="piece-text">
    <span class="piece-title">Hockey drills, animated</span>
    <span class="piece-desc">Fifty-two practice drills you can play step by step.</span>
  </span>
</a>

<div class="piece is-soon">
  <svg class="piece-art" viewBox="0 0 200 100" aria-hidden="true">
    <rect x="6" y="6" width="188" height="88" rx="4" class="art-panel" />
    <path d="M 14 50 h 30 l 6 -24 l 10 48 l 10 -48 l 10 48 l 6 -24 h 100" class="art-path" />
  </svg>
  <span class="piece-text">
    <span class="piece-title">Why is an MRI so loud?</span>
    <span class="piece-meta">coming soon</span>
  </span>
</div>

</div>

<script>
  window.DRILLS = {{ site.data.drills | where: 'id', 'two-on-one-give-and-go' | jsonify }};
</script>
<script src="{{ '/assets/js/drills.js' | relative_url }}"></script>
