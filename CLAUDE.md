# CLAUDE.md

Working notes for this repository. Read this before making changes.

## What this is

Mertcan Özdemir's personal site at **mertcanozdemir.com**, built on the
[al-folio](https://github.com/alshedivat/al-folio) Jekyll theme. Mertcan is a
biomedical engineer (PhD, 2025, on diffusion models for cardiac cine MRI
synthesis), now a researcher at UMRAM, Bilkent University, working on fast MRI
reconstruction. He also played ice hockey for the Turkish national team, and
programs microcontrollers for hobby electronics projects.

## How it deploys

Push to `master` → `.github/workflows/deploy.yml` builds with Jekyll and pushes
to `gh-pages` → GitHub Pages serves it. **Never edit `gh-pages` by hand**; it is
generated output and every deploy overwrites it.

CI that must stay green: `Deploy site`, `Prettier code formatter`,
`Check for broken links`, `Check for broken links on site`.

## Local environment

There is no Ruby or Jekyll on this machine, but **Docker is installed and the
site builds locally**: `docker compose up` in the repository root serves it on
localhost:8080 with live reload. Prefer this over deploying to check a change.

The prebuilt image now ships Ruby 4.0, which dropped `ostruct` from the default
gems. `jekyll-twitter-plugin` required it and crashed the container on startup;
the plugin was unused and has been removed. If another gem fails the same way,
adding `gem 'ostruct'` to the Gemfile is the fallback — CI is unaffected either
way, since it pins Ruby 3.2.2 and Gemfile.lock is untracked.

`node` is available, and `node_modules/` holds prettier and js-yaml (both
pinned in `package.json`).

In a Claude Code cloud session the Docker container cannot reach rubygems.org
through the session's proxy, but the container has Ruby 3.3:
`bundle config set --local path vendor/bundle`, then
`SSL_CERT_FILE=/root/.ccr/ca-bundle.crt bundle install`, then
`LANG=C.UTF-8 LC_ALL=C.UTF-8 bundle exec jekyll serve`. Without the UTF-8 locale
bibtex-ruby fails on the Turkish letters in `papers.bib`.

## Prettier

`.github/workflows/prettier.yml` runs `npm install --save-dev --save-exact
prettier @shopify/prettier-plugin-liquid`, which **ignores package-lock.json and
installs the latest**. Local and CI once disagreed for exactly this reason, so
`package.json` now pins prettier and the plugin exactly. Keep them pinned, and
run `npx prettier . --check` before committing.

## CSS minifier trap

jekyll-minifier mangles `var()` inside `calc()` — `calc(var(--gutter) - 6px)`
is served as `calc(var( -  - gutter) - 6px)`, which browsers drop. Use a plain
value there, or compute the whole thing in a custom property.

## What the site is built from

al-folio's layouts were removed in "Delete al-folio" (2d89e38): every page goes
through `_layouts/base.liquid` (with `_includes/site/` for the head, the menu
and the foot), styled by `assets/css/site.scss`, which imports `_custom.scss`.
Older notes about al-folio's CV page (`resume.json`) and distill posts no longer
apply. jekyll-scholar still renders `{% bibliography %}` on the about page.

What is Mertcan's:

- `_pages/about.md` — two paragraphs, publications, teaching, links.
- `_bibliography/papers.bib` — 10 publications including the 2025 _Diagnostics_
  paper and patent WO2023163682A1.
- `assets/pdf/MertcanOzdemirCV.pdf`, linked from the about page.
- `assets/img/` — `prof_pic.jpg` and `favicon.svg`.
- The drills, the home pieces and the game, below.

The spin-echo post, the cuff-pressure project page and the teaching page went
with al-folio; git history has them if they are wanted back.

## Conventions

- **Navigation** is a menu behind the button top left: home, then about →
  drills → play (`nav_order` 1–3).
- Upstream workflows that publish Docker images are guarded with
  `github.repository_owner == 'alshedivat'` so they never run here. `Dockerfile`
  and `docker-compose.yml` are kept: they are how INSTALL.md runs the site locally.
- `docs/POST-FEATURES.md` documents the theme's post features (math, mermaid,
  charts, citations…) distilled from the 24 demo posts that were deleted. Its
  Liquid examples are wrapped in `{% raw %}` and `docs/` is in `exclude`.

## Style

Mertcan reads Turkish; write conversational replies in Turkish. Commit messages,
code comments, and site content stay in English — the site is entirely English
(`lang: en`).

He has asked for short answers, and for filler or try-hard phrasing to be
flagged rather than left in ("cringe" was his word — the GIF caption "my brain"
was removed for this reason). He does not want a CV-shaped site that nobody
returns to; usefulness matters more than presentation.

Site copy should be short and plain but still read as normal prose. The about
page was cut from four paragraphs to two; a further telegraphic pass ("I'm a
biomedical engineer. I work on…") went too far and was reverted.

Do not deploy after every change. Commit locally, let work accumulate, and push
when he says so.

## Home (/)

Mertcan wants the site to be a place to try popular-science pieces, not a CV:
`about` is where people find out who he is. The home page is a list of pieces,
each something to play with beside a few lines on where it leads, and he asked
for them to be fun — "fantastic, funny, creative" — rather than sober. The
markup is in `_includes/home/pieces.liquid` (prettier flattens HTML nested in
the Markdown page), the styles under "Home page" in `assets/css/_custom.scss`.
A "coming soon" placeholder was tried and dropped: a piece goes up when it works.

- **Why does an MRI take so long?** (`assets/js/kspace.js`): popular science
  about fast MRI. The patient is a cat (or, from a button, a dog), drawn in code
  as an MR scan might show it. k-space sits beside the image rebuilt from the
  lines measured so far (zero-filled inverse FFT, 128×128, in the browser, each
  line density compensated, the display windowed to the brightest pixels). The
  visitor chooses one of three scans and the scanner measures it on its own, a
  line a TR (0.5 s, as in a T1 spin echo, shown eight times as fast: `SPEED`),
  with its noise (`NOISE`), the line being measured in white-blue: every line
  (1:04), every fourth (0:16) or every eighth (0:08). The cat keeps still for
  30 s of scanning (`PATIENCE`), then moves; lines measured after that come from
  the moved cat (orange in k-space), so the full scan has motion ghosts. The
  quick scans are over before it moves, but fold it over itself. Then two ways
  to fill in the lines skipped, the filled-in lines blue in k-space and the
  measured ones kept as measured:
  - **"unfold with 8 coils"**: SENSE with eight simulated receiver coils
    (`coilMaps()`, `COIL_NOISE`), a least-squares solve for each pixel with a
    little regularisation (1e-4 of the trace). Clean at 4×; at 8× the copies do
    not quite come apart.
  - **"coils and a network"**, as today's fastest scans do: a U-Net cleans up
    what the coils leave. 404,417 weights in half floats
    (`assets/models/catnet.bin`, 809 KB, fetched on the first click and run in a
    worker, about a second), taught on 15,744 drawn cats with JAX
    (`bin/catnet/`: `cats.py` draws them varied, `train.py` scans them with the
    page's coils and teaches the network, `export.py` writes the weights in the
    order `network()` reads them). On cats it has not seen: 35.3 dB at 4×
    (the coils alone 28.9), 27.5 dB at 8× (19.6). It has only ever seen cats,
    which the dog is there to show: at 4× the coils have done most of the work
    and the dog comes out right; at 8× its muzzle and nose come out smudged
    or not at all. A first network, working from the folded image of a
    single coil, was worse than the coils at 8× (18 dB) and was dropped.

  Mertcan asked where the deep learning was (the point is fast MRI), and for it
  to read as popular science. Earlier versions: the visitor measured lines by
  moving over k-space, the cat moving after 84 of them, which read as caused by
  the visitor, not by time; then four scans including top to bottom against
  centre first, an order that told nothing about speed; and one with the hockey
  game's ideas (an LED clock like its scoreboard, scanner sounds, a shake when
  the cat moved), dropped: "buz hokeyi ayrı, MRI ayrı".

  To teach the network again (in a cloud session download.pytorch.org is closed
  but PyPI is open, so JAX; its large wheels may need fetching with curl), with
  `DIR` a scratch directory:

  ```bash
  python3 -m venv --system-site-packages venv && venv/bin/pip install jax
  for i in 1 2 3 4; do venv/bin/python bin/catnet/cats.py DIR/cats-$i.npy 4000 $i; done
  venv/bin/python bin/catnet/train.py DIR 3000  # about 20 minutes on four CPU cores
  venv/bin/python bin/catnet/export.py DIR/params.pkl assets/models/catnet.bin
  ```

  Keep the coils, the noise and the regularisation the same in `train.py` and
  `kspace.js`. `data-image` on the piece swaps in any picture, such as a real MR
  slice. A Shepp–Logan phantom was tried first and was too sober. It no longer
  links to the comparison graph on the lab's site: the site is independent of
  the lab's (Mertcan). A page of its own, for the piece to lead to, is being
  planned.

- **Three on three** links to the game (below); its picture is one frame of the
  computer playing itself, a few seconds in, different on every visit, always
  drawn from above (Mertcan asked), whatever view the game was last played in.
- **Hockey drills**: one real drill, the 2-on-1 Give and Go, loops through
  `drills.js` in preview mode (`data-preview`: no controls, plays only while on
  screen, a still frame for reduced motion). Its players are the same numbered
  discs as on the drills page: drill drawings have their conventions (Mertcan
  asked for them to stay round after a version with the game's helmets).

### Hold still — /hold-still/

Where the MRI piece leads ("Now be the patient yourself →"): the visitor is
the patient (`_pages/hold-still.md`, markup in `_includes/holdstill/scan.liquid`,
`assets/js/holdstill.js`, which uses kspace.js through `window.kspace`: the
FFT, `coilMaps()`, `coilScan()`, `unfold()` and the network). The camera's
picture, grey, mirrored and faded to dark at the edges like an MR slice, with
its k-space live; the same three scans in real time (1:04, 0:16, 0:08), each
line taken from the picture of its moment, so moving makes ghosts. How far the
visitor moved is measured by phase correlation against the first picture
(`MM`, 2 mm a pixel for a square about 25 cm across); lines measured after
moving more than 3 mm (`STILL`) show in orange, and the full scan's verdict
says how far. After a quick scan the coils and the network fill in, as on the
home page; the cat-trained network makes a mess of a face at 8× (extra eyes),
which its words own up to. "save the scan" downloads a PNG with a scanner
viewer's corner notes (PATIENT: YOU, the date, T1 SE TR 500, the scan). The
picture never leaves the device. No camera, or not allowed: the home page's
cat sits in. Not in the menu. Tested with Chromium's fake camera fed a drawn
face (`--use-file-for-fake-video-capture`, a y4m), still and moving. The
claude.ai preview cannot use a camera (no such capability), so there it shows
the cat; downloads are blocked there too.

Mertcan's first ask was to bring the game's updates to the MRI piece; a
version with them was set aside ("buz hokeyi ayrı, MRI ayrı"), and this page
came out of the ideas for where the piece should lead.

### The comparison graph moved to the lab's site

It is at <https://icon-lab.github.io/mri-recon-comparison-graph/> (repository
`icon-lab/mri-recon-comparison-graph`, which has its own README on updating it).
The site no longer links to it or sends `/graph/` there (that redirect was
removed): Mertcan wants the site independent of the lab's. Its files here — `assets/js/recon-graph.js`,
`assets/json/mri_recon_graph.json`, `bin/graph-layout.js` and the "Comparison
graph" styles — are no longer used. The local branch `years` (the paper's Fig. 2
view of the graph) still **must not be pushed before the paper**.

The papers/results browser (`_pages/results.md`, `assets/js/recon.js`) is
**hidden, not deleted**: `published: false`, and its dataset and script are in
`exclude` in `_config.yml`. Mertcan wants it back later — the front matter of
`results.md` says how.

- `assets/json/mri_recon_data.json` is copied from the umram project's
  `rapor/site/mri_recon_data.json` and regenerated there with
  `scripts/site_verisi.py`. Never hand-edit it.

## The game — /play/

`assets/js/game.js`: three on three against the computer on the drills' rink
(drills.js sets `window.rinkSVG` for it).
An original game: an earlier idea was to embed King of 94, an online arena
for the original NHL '94; it forbids framing (`X-Frame-Options: DENY`) and the
game is EA's, so that was not done, and nothing of NHL '94 (name, look) is here.

The simulation (`Game`) has no DOM in it. **Run `node bin/check-game.js` after
touching it** (exits non-zero on problems): it plays the computer against
itself, against a person who does nothing, and against a scripted person, and
checks that nothing leaves the rink or turns into NaN, the puck never sits
loose, goals come at a sensible rate, and the scripted person can score.
Between periods it lets the players skate off, and it drives the Kamboni
(below) the crew's way, which must get the ice clean within 45 s (it takes
about 35), and anyhow from above and from the cab, which must stay on the ice.
Its
numbers are the way to tune the balance; bugs it has caught include the net's
mouth acting as a wall, defenders pushing a carrier along instead of reaching
the puck, carriers parking in the slot, and an asymmetric collision that made
one computer team three times as good as the other.

The players are drawn as hockey players. From above (`helmetSVG` and
`helmetLook` in drills.js, shared with the home page's drill): shoulder pads in
the team's jersey, a helmet open at the front where the face and eyes are,
gloves and a stick. Standing, in the tilted view (`standingSVG`): skates with
blades, striped socks, hockey pants, a jersey over shoulder pads, gloves on the
stick at the player's side (half shoot left, half right) and an open helmet with
ear guards, a clear half visor over the eyes down to the bottom of the nose (as
the IIHF rules have it), the mouth, and the chin strap under the chin (a
visor drawn lower, with the strap below it, made everyone look as if smiling,
Mertcan said). The stick is a hockey stick drawn to a real one's proportions (IIHF rules:
1.63 m to the heel, the blade 32 cm long and 5 to 7.6 cm high; a goalie's 39.5
by 9 cm, with the paddle 71 cm up the shaft): a thin shaft and a long, low
blade flat on the ice, its toe rounded (`stickSVG()`, `setStick()`). As a plain
line it looked like a rod, and a first blade, thick with the toe turned up and
taped, like a shoe (Mertcan both times); from above it is thin, the blade
curving. Goalies are another shape: big pads,
a wide chest protector, a blocker and a catching glove, a painted mask with a
cage and a paddle stick. Skin tones vary a little from player to player
(`RINK_SKINS`): light tones only, which Mertcan asked for.
An earlier design, helmets with a dark full visor over plain bodies, looked
like motorcycle helmets and couriers (Mertcan's words) and was replaced.

The **puck** is black, as a real one, with a gold ring round its edge
(`--rink-puck`, `--rink-puck-ring`), in the game, the replay and the drills
alike. It was gold, and Mertcan asked whether it should be black: black alone has
more contrast on white ice (about 17:1, gold 1.7:1) but is lost beside the dark
sticks and skates (1.2–1.7:1) and on the dark theme's ice (1.2:1), where the
ring is what shows it. In the TV camera's view the ring also shows through a
player in front of it (`data-puck-ghost`).

How it plays: the person controls one skater (the dashed ring) and takes over
whoever on their team gets the puck; Space shoots or pokes, X passes or
switches (also while knocked down; the switch counts from the next step, as the
same press once switched straight back), C body checks: a short burst that knocks down an opponent it hits
hard enough (`CHECK`), who drops the puck and lies there for a second with
crosses for eyes and stars; the computer checks too. A shot straight off a
pass is a one-timer: harder, and harder to save. A goal lights the lamp behind
the net; a hat trick (`goals` per player) brings hats down onto the ice, but
only for the person ("nobody throws a hat" for the computer); own goals get
their own line. Skating (`SKATE`): let go of the keys and a player coasts to a
stop in about a second (it was 2.6 s and 10 m, too long to control); skate the
other way and it is a hockey stop, braking hard with a spray of snow. The
computer's skaters brake the same way. Top speed is 8.6 m/s (`maxSpeed()`, a
real player's is 9 to 11) and passes go at 12 to 23 m/s: at 7.6 and 10 to 20
Mertcan found the game slow (it ran at 60 frames a second: the pace, not the
drawing). Faster shots too were tried and dropped: the goalies saved too few.

**Skating, drawn** (`strideOf()`, page side): a stride's phase per player,
quicker with speed; pushing, each skate pushes out to the side in turn while
the other comes back lifted (`[data-leg]` in `standingSVG`), the body leans
the way it goes, sways over the gliding skate and bobs, and the stick follows
the top hand; coasting, the skates glide together; a hockey stop leans back on
wide skates. From above the body swivels a little with each stride.

**Five on five** (Mertcan's ask, a trial): "3 on 3" / "5 on 5" on the start
and final screens, remembered (`hockey-size`), `opts.size` in the simulation.
The extra two a side get the other wing and defender at faceoffs and two more
places in `plan()` (the other point and the net front in attack, cover for the
next two attackers in defence, wide outlets), after the three of three on
three, which therefore plays exactly as before. The checker plays it too: no
problems, about 4 to 5 goals a game, and many more passes and blocks.

**Goalies** take position as an attacker comes (Mertcan asked; `keepGoal()`,
after goaltending coaches' guides): on the line from the puck to the middle of
the net, square to it, at the top of the crease for a puck far out, further out
against a carrier with nobody to pass to (a breakaway), backing in as the puck
comes close and on wide angles, and deeper with a pass across on. They see the
puck a moment late (`seen`, 0.16 s), so a quick pass across the slot finds them
off their angle, as it does real goalies. Three stances (`stance`), drawn in
both views: ready; the butterfly, pads flat across the ice, for a shot on its
way to the net or a loose puck in front (`kneel`, 0.45 s at least); and on the
post, one pad down along the goal line toward the net (reverse-VH), when the
puck is at or behind the goal line. A save's chance falls with shot speed, the
goalie's sideways motion, how far it is off its angle (not against a shot from
the side of a post it has sealed), rebounds, close range and one-timers; over
48 games a side the checker's goal rates came out the same as before. Fast
shots can also be blocked, or slip past a body.

**Rules** (Mertcan asked for offside and the others; `rules()`, `whistle()`):

- Offside: an attacker ahead of the puck into the zone (past the blue line by
  more than 0.4 m). Carried in, the whistle goes at once; sent in, it is a
  delayed offside (the referee's arm up), waved off once the whole team is
  back out of the zone (tagging up) and called if one of them plays the puck
  first; a goal shot in from outside with a teammate offside is no goal. The
  faceoff is at the neutral-zone spot. The computer waits at the blue line
  until the puck is in (`plan()`), its carrier waits for teammates still in
  the zone, it passes to nobody offside, and in a delayed offside its players
  keep off the puck until they have tagged up: with all that it goes offside
  about once a game (it was three to five).
- Icing: sent from behind the centre line, untouched, over the far goal line
  past the net (no-touch); not against a team a skater short. The faceoff in
  the offending team's end. The computer hardly ever ices: it does not dump
  the puck.
- Penalties from checks: aimed at a player without the puck (who has not just
  passed it) is interference; from behind into the boards, boarding (bumping
  into someone else on the way is no foul: before that, nearly every penalty
  was a computer's check meeting the wrong player). Delayed while the other
  team has the puck; any whistle calls it; a goal by the other team washes it
  out. A minor is `MINOR`, 10 s here (two minutes of twenty would be six), in
  the penalty box across from the benches (team a's on the left), drawn there
  behind the far boards, the team a skater short; a power-play goal ends it,
  and it carries over an intermission. The faceoff in the offending team's
  end. The computer does not check from behind near the boards.
- Faceoffs anywhere (`faceoff(at)`, `spotOf()`): lined up round the dot in
  slot order with whoever is in the box left out (`spot`), never behind a
  goal line. The whistle (a synthesized pea whistle, two blasts), a few words
  of what was called (`ruled()`), and the seconds left of a penalty beside
  each team's score on the board ("PEN"). The checker counts the whistles and
  wants eight a game at most: offside about 1 to 3, penalties up to about 1.

Against a person the computer's team is a little sharper (`sharp()`: as fast,
keener pokes, better goalie). Three periods of a minute, then sudden-death
overtime if tied. Touch screens get a stick and three buttons (pass, check,
shoot), shown by `(pointer: coarse)` or after the first touch. (The stick is found as
`.game-touch [data-stick]`: the players' sticks in the SVG are `data-stick` too,
and a bare `[data-stick]` picked one of those and broke the touch stick.)

The **scoreboard** (`scoreboard()` in game.js, the HUD's `[data-board]`): asked
for because the time and period were hard to see, "digital and retro, like the
real ones". It follows real hockey boards (Daktronics, All American spec
sheets): seven-segment LEDs with the unlit segments faintly there, the time big
and red (in tenths of a second under a minute, as those boards do, so with
minute-long periods it mostly runs in tenths), the scores in amber with a red
goal light beside each, and under them the shots on goal and the period (`ot`
in overtime), with white captions; black whatever the theme. Between periods
the time gives way to ICE CLEAN %. Its `aria-label` carries the same in words.

The players are named after **famous players** (Mertcan asked), with the
numbers they wore: `lineUp()` deals both line-ups from `SKATERS` and `GOALIES`
for every game. The numbers are on the jerseys in the TV camera's view (over
the arms, which hid them) and under the players from above; the skater you
control has their name over the arrow; goals, hits, the intro and the final
("star of the game") use the names. Only names: the players are the game's own
drawings. Commercial games license real names, so this was raised with him.

**Faceoffs** (Mertcan's rule): a referee (striped shirt, orange armbands; only
drawn, `game.ref`, who then follows play along the far boards) holds the puck
over the dot and lets it go at a moment of its own (`dropPuck()`); the quicker
stick wins the draw and draws it back to a teammate. For the person: an amber
ring closes on the dot as the moment comes, and pressing pass or shoot once it
has closed and the puck is out of the referee's hand wins if quicker than the
computer's centre (`REACTION` seconds for the level); pressing before is early
and loses (the rule). Two versions before the ring could not be won (Mertcan,
twice): counting from the landing, which a person sees too late, then from the
release, which was too small a movement to see. Computer against computer it is
a toss-up. The checker's scripted person presses 0.1 s after the ring closes
and wins about 100%, 87% and 35% of draws on easy, normal and hard.

A press in a frame with no simulation step (on a 120 Hz screen that happens)
was lost; `frame()` now keeps it for the next step.

**Levels**: easy, normal, hard, chosen on the start and final screens and
remembered (`hockey-level`). `sharp()` is how far the computer's team is ahead
(`LEVELS`: −0.5, 1, 1.6; 1 is how it played before levels): speed, keener
checks and pokes, aim, the goalie. The checker plays the scripted person at
each level and wants easy easier than normal easier than hard (with 8 games or
more: fewer are too noisy).

**Full screen**: pressing play makes the game fill the window (`fullScreen()`,
`fit()` sizing the rink to the height left and the scoreboard to 37% of the
rink); × or Esc leave and pause. On a touch screen the browser goes truly full
screen where it allows and the stick and buttons sit see-through over the
rink's corners. Before this the rink did not fit a laptop's window (its bottom
100–170 px below the edge, and the arrow keys cannot scroll during play) nor a
phone held sideways.

**Sound** (`sounds()`): WebAudio, no files: puck off a stick, the post, saves,
checks and boards, the goal horn (an arena's air horn, three trumpets in a
chord around 260–390 Hz for 1.6 s: a deep ship's horn was too much for
Mertcan, who wanted it higher) and the crowd, the buzzer, the
Kamboni's horn. "mute" in the HUD, remembered (`hockey-sound`). Browsers start
it only after a click or a key, so `wake()` runs on those.

**Replay**: the last 4.5 s are kept frame by frame (`record()`); 1.5 s after a
goal the last 2.2 s before it are shown again with a REPLAY badge, then play
carries on (the faceoff, or the end). Any key or a tap skips it. Mertcan asked
for it from the scorer's eyes, like the Kamboni's cab, and slower: half speed,
slowing to 0.28 for the shot (`showReplay()`, frames interpolated by
`between()`), about 7 s in all. kamboni.js draws it in 3D (`prepareReplay()`,
`replayFrame()`): the game's own drawings stand on the ice as cut-outs turned to
the eye (`replaySprites()` in game.js: each player from the front and the back,
then the referee, then each goalie's other stances, so the replay shows the
goalie in the butterfly or on the post as the game did: Mertcan missed them;
`poses` in kamboni.js says where they are), with shadows, the nets, the puck (larger than life, more so
the further off) with its streak, the scorer's own stick at the bottom, and the
goal light on the glass that comes on when the puck is in. The camera keeps the
puck low in the picture and the net in it. Without WebGL it is the old replay,
as the game is seen. Gloves on the scorer's stick looked like dark blobs and
were dropped.

The end of a period (`phase` "intermission") is not a sudden menu (Mertcan
found the first version abrupt): the green lights come on behind both nets (in
a real arena the green light means time is up), the clock blinks, and the
players skate off to their benches (`leave()`; `benched` once all are off);
then the choice fades in. The page calls `nextPeriod()` when the ice is done.

The **Kamboni**, an ice resurfacer: Mertcan's idea, after the cleaning and
house-painting games; he named it Kamboni (not Zamboni, which is a brand). The
person drives it over the cut-up ice, or "lets the crew do it". About life size
(`RZ`: 5.2 × 2.6 m, cleaning a 3 m band behind it; the first one was so big it
could not get behind the nets), and the crew takes the nets off the ice first,
as in a real arena. Its physics is `Resurfacer` in the simulation, driven the
same way in both views: it keeps going at a cruise, ← → steer and ↑ ↓ change
speed (easier: the first controls were found hard). From above it used to drive
toward the arrow pressed, ↑ up the screen; Mertcan wanted ↑ to go forward. Its
body is three circles against the boards. The ice is counted in 1 m cells and 65% is enough.
The crew's way (`autopilot()`) is rows along the rink, shown ten times as fast;
the pause button becomes "let the crew finish", then "skip". The time is kept
against the best in the browser (`kamboni-best`). Space honks; boards bonk.

When the ice is done the game does not start straight away (Mertcan found the
cut abrupt). The Kamboni drives itself off (`driveOff()`: twice as fast as life
to the middle of the rink in front of its gate, lined up there, then in at its
own pace) through a gate in the middle of the left-hand end boards (`RZ.gate`;
a dark opening, `cab.gate()` in the cab and `[data-gate]` from above), to
applause. The view goes dark (`.game-curtain`) and lights again on the teams
coming back out (`comeBack()`, the game's phase `return`): the crew pushes the
nets back onto their pegs, the new ice shines wet and then freezes
(`freshIce()`, `[data-sheen]`), the players come out of their bench doors a few
at a time and skate to their faceoff places, the goalies scrape their creases,
the referee brings the puck to the dot, and the organ plays the old bugle call
to charge. About 9 s in all; a key or a tap goes straight to the faceoff (the
press is not taken for the draw). The checker drives the Kamboni off from
wherever its runs end (8.5 s at most at its own pace, through the gate and not
the boards beside it) and wants the teams back within 9.5 s.

From above, the page frosts the used ice (a scratched pattern) and masks the
frost and the skate marks away along the track, which shows as wet ice; the
players, puck and nets are hidden (`is-resurfacing`); the drawing
(`KAMBONI_TOP`) follows a real resurfacer: driver up front on the left, the
snow tank, the conditioner and towel behind. The HUD's clock becomes a bar
("ice 37% clean").

**From the cab** (`assets/js/kamboni.js`, WebGL; loaded on /play/ only): Mertcan
asked to drive from inside after the Kamboni did not work on the TV camera, so
it is how the Kamboni is driven, whichever view the game was in (the view
button switches to from above; at first it started from above when the game
was, and Mertcan could not find the cab). The ice texture is the game's own rink drawing with the period's
marks and the frost, drawn into a canvas through an SVG data URL (CSS variables
substituted, since an image cannot see them); the clean, wet ice is painted onto
it along the track and only that patch is uploaded. Round it: boards with
KAMBONI adverts, glass, and stands that start right behind the glass (with a
gap you saw into the void). Over it, what the driver sits in, **open on top**
as on a real resurfacer (a cab is an extra on real ones; the first version had
a roof and pillars and looked like a truck, Mertcan said): the snow tank's side
on the right with a mirror on an arm (a second, flipped render) that shows the
clean band behind, a grab rail on the left, the white front deck with the
wheel, a gauge for the ice and a cat, and the map at the top left. An arrow
to the dirtiest ice, which Mertcan found useless, gave way to the **ICE CAM** on the
dash (`screenBox()`, a third render through a hole in the dash's SVG): the ice
from straight above, heading up, the Kamboni drawn in, and the cells the game
counts as clean tinted blue (`wetCells()`), so the strips still to do stand out
(a real one has a rear camera on a screen). A lane laser on the ice ahead
(green on the wet edge, amber over a gap; a real option on one maker's
machines) was tried and dropped as unnecessary (Mertcan). The cat is the
driver's trainer (`seam()`): it nods while an edge of the band runs along the
wet edge of an earlier pass or the boards (drivers line their passes up so),
and shakes its head at a strip about to be left.

No WebGL: from above instead. Headless Chrome logs "GPU stall due to
ReadPixels" here; that is its software compositing, not the game.

Two views, switched by a button above the rink and remembered per browser
(`hockey-view` in localStorage; the stored value for it is still `tilt`): the
**TV camera**, the default, and **from above**, as the drills are drawn. The TV
camera is Mertcan's idea, after a tilted, slightly turned view he had asked for
as "izometrik": high in the stands at centre ice, looking across through a
long lens, so drawn without perspective (`YAW` 0, `SQUASH`, `RISE`, the `TILT`
matrix). It frames `VIEW` metres of the rink (44) and pans after the puck, and a map
of the whole rink sits in the top right corner (players, the puck, the stretch
the camera shows). The ice and what lies on it (markings, marks, the ring round
your skater) are one plane drawn through the matrix; on it stand boards with a
far face and a see-through near face, nets with mesh and a red frame, and
players standing up (`TALL`, 0.95: at 1.15 with a 38 m frame Mertcan found
them too big), drawn far to near. Over everything: an arrow over
your skater and the puck's outline, so neither is lost in a crowd. Keys and the
stick mean directions on the screen, mapped back onto the ice (`TILT.back`). A
true 45° isometric view was considered and passed over: the goals would sit in
the corners and the keys would skate diagonally.

Skate marks (`skateMarks()`, page side only): every player leaves twin blade
tracks, and a fan of snow where they stop hard, turn sharply or go down. They
build up through a game, so the ice looks used by the end (goalies scratch up
their creases), with the oldest dropped past a cap of 420 elements; a new game
starts on clean ice.

## Hockey drills — /drills/

The page at `_pages/drills.md` animates each drill from `_data/drills.yml` using
`assets/js/drills.js`, which draws an IIHF rink to scale (60×30 m, centred at
0,0) as inline SVG — except the nets and creases, drawn half as big again as
regulation (`NET`), because beside players drawn several times life size a
true-scale net looked too small (Mertcan noticed). The game plays with the same
nets. Styles live under "drill diagrams" in
`assets/css/_custom.scss`. The layout follows the IIHF coaching pad (a copy is
in `docs/iihf-drills/`, gitignored): each drill is the rink with a narrow steps
column beside it, two drills a row from 90rem, one below, stacked on a phone.
Text is kept short on purpose — the animation carries the explanation. Three
drills a row was tried and rejected as too small; full-width rinks as too big.

The 52 drills are **real, redrawn from the IIHF Coach Development Program
Level I Tactical manual** — every drill in its chapter 21 except free play with
no fixed pattern (Chaos Drill, Monkey Drill, 5 x One-on-One, Team Shadowing,
Introduction to Body Contact, Three-on-One In Circle), plus the 2-on-1 give and
go from chapter 20. Each has a `source` with the manual's page. Mertcan asked
for the manual **not** to be linked or cited on the site, and later for the
"IIHF" mentions to go too: the drills page has no description, the about page
says "animated practice drills", and visible text never says "the manual".
The diagrams themselves are cropped into `docs/iihf-drills/<section>/`
(gitignored, the IIHF's material). The original plan was drills from his own
paper notes from an IIHF development camp; those may still come and would sit
alongside these.

**Run `node bin/check-drills.js` after touching any drill** (it exits non-zero
on problems). It loads the real engine and flags passes thrown before the last
one landed, opponents on a pass or shot line (a shot ending at a goalie counts
as a save), overlapping players, speeds over 9 m/s, anyone leaving the rounded
rink, and steps out of order. Every problem it catches has turned up in a real
drill at least once — the 2-on-1 first had the defender inside the carrier's
circle and the shot clipping the goalie.

Data shape (see the header of `_data/drills.yml` for the full rules):

```yaml
- id: give-and-go-pylons
  title: Give and Go Pylons
  category: Puck handling and shooting
  source: { page: "21.11", pdf: 42 }
  duration: 11 # seconds the animation runs
  cones: [[-5.6, 9.2], [-8.3, 7.2], [-10.7, 4.3]]
  actors:
    - id: P
      label: P
      team: n # a blue, b orange (opposition), n grey (passers)
      path: [[-18.5, 8.5]] # one point: stands still
    - id: P1
      label: "1"
      team: a
      puck: true
      path:
        - [-23, 13]
        - [-15, 13, 0.22] # third value pins the time
        - [-17, 1.5, 0.86]
  events:
    - { t: 0.05, type: pass, to_actor: P }
    - { t: 0.15, type: pass, to_actor: P1 }
    - { t: 0.86, type: shot, to: [-26, -0.4] }
  steps:
    - { t: 0, text: "1 passes to P and skates up the boards." }
```

Paths are Catmull-Rom curves through their points. Points without a time are
spread by distance between the pinned ones, so a player skates at an even
speed; pin a time wherever timing matters. Keep one point per line under
`path:` — as an inline list prettier explodes it into a much worse layout.

`steps` is the written description: a numbered list under the diagram, where
the step the animation is in is highlighted and selecting one seeks to its `t`.
**Quote the text** — it sits in a flow mapping, so an unquoted comma splits it.

`t` in an event is a fraction of the drill. **Passes carry no start point**:
they leave from whoever has the puck, and a pass to `to_actor` is aimed at
where that player will be when it lands (flight time grows with distance), so
the puck meets the receiver and then travels with them. Writing explicit
`from`/`to` points for passes caused the puck to teleport — one pass was aimed
9 m from where the receiver actually was.

Several pucks are supported: every actor with `puck: true` starts with one, and
`pucks: [[x, y]]` puts loose ones on the ice. With more than one puck, each
event names its carrier with `by`. A pass with a point `to` (a dump-in, a chip
into space) leaves the puck loose there, as does a shot; `pickup` hands `by`
the nearest loose puck. `nets: [[x, y, angle]]` draws extra goals. All of this
lives in `simulate()` in `assets/js/drills.js`, which also collects data
mistakes as warnings (printed to the browser console).

The page is grouped by the manual's own sections, listed in
`_data/drill_sections.yml` (skating, passing, checking, goalkeeping, evaluation,
team tactics); a section with no drills is hidden. The markup lives in
`_includes/drills/sections.liquid` because prettier flattens HTML nested in the
Markdown page. A grouping by practice phase was discussed and set aside — warm-up,
focus, "ara taktikler" (team tactics: breakouts, zone entries, defensive
systems), "last process" (cool-down), pre-season — partly because Level I has
almost nothing for team tactics or cool-down.

Paths are sampled by arc length, so a player's speed is even between pinned
times; before that, unevenly spaced points made players spike past 15 m/s.

Still undecided, to settle if his own notes arrive:

- Whether Claude transcribes the paper diagrams into coordinates, or builds a
  click-on-the-rink editor so Mertcan can add drills himself.
- Whether the home page splits into two halves (research / hockey). He asked for
  this, but it was deferred until there is enough hockey content to justify it —
  half an empty home page would look worse than the current one.

An earlier attempt — `_data/training.yml`, a filterable table of sessions with
sets and reps — was **rejected and deleted**. He wants diagrams, not tables.
The standalone `drills-preview.html` prototype has been superseded by the page
and is gone too.
