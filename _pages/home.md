---
layout: base
permalink: /
wide: true
---

{% include home/pieces.liquid %}

<script>
  window.DRILLS = {{ site.data.drills | where: 'id', 'two-on-one-give-and-go' | jsonify }};
</script>
<script src="{{ '/assets/js/drills.js' | relative_url }}"></script>
<script src="{{ '/assets/js/kspace.js' | relative_url }}"></script>
<script src="{{ '/assets/js/game.js' | relative_url }}"></script>
