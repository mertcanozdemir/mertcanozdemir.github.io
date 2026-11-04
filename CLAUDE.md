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

- **Why does an MRI take so long?** (`assets/js/kspace.js`): the patient is a
  cat, drawn in code as an MR scan might show it. k-space sits beside the image
  rebuilt from the measured lines alone (zero-filled inverse FFT, 128×128, in
  the browser, each line density compensated, the display windowed to the
  brightest pixel). It opens with every fourth line measured, so the cat folds
  over itself; moving over k-space measures the lines under the pointer. After
  84 lines the cat moves, and lines measured after that come from the moved
  cat, so a full scan has motion ghosts: the case for scanning fast. Filling
  only the centre brings the cat back with ghosted edges and the whiskers (the
  finest detail) go last. `data-image` on the piece swaps in any picture, such
  as a real MR slice; it moves the same way. (The old `mybrain.gif` in git
  history is a rotating 3D surface render, not a slice.) A Shepp–Logan phantom
  was tried first and was too sober. The piece links to the comparison graph on
  the lab's site; the article behind it is still to be written.
- **Three on three** links to the game (below); its picture is one frame of the
  computer playing itself, a few seconds in, different on every visit, always
  drawn from above (Mertcan asked), whatever view the game was last played in.
- **Hockey drills**: one real drill, the 2-on-1 Give and Go, loops through
  `drills.js` in preview mode (`data-preview`: no controls, plays only while on
  screen, a still frame for reduced motion). Its players are the same numbered
  discs as on the drills page: drill drawings have their conventions (Mertcan
  asked for them to stay round after a version with the game's helmets).

### The comparison graph moved to the lab's site

It is at <https://icon-lab.github.io/mri-recon-comparison-graph/> (repository
`icon-lab/mri-recon-comparison-graph`, which has its own README on updating it),
and `/graph/` redirects there. Its files here — `assets/js/recon-graph.js`,
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
ear guards, a half visor and a chin strap. Goalies are another shape: big pads,
a wide chest protector, a blocker and a catching glove, a painted mask with a
cage and a paddle stick. Skin tones vary a little from player to player
(`RINK_SKINS`): light tones only, which Mertcan asked for.
An earlier design, helmets with a dark full visor over plain bodies, looked
like motorcycle helmets and couriers (Mertcan's words) and was replaced.

How it plays: the person controls one skater (the dashed ring) and takes over
whoever on their team gets the puck; Space shoots or pokes, X passes or
switches, C body checks: a short burst that knocks down an opponent it hits
hard enough (`CHECK`), who drops the puck and lies there for a second with
crosses for eyes and stars; the computer checks too. A shot straight off a
pass is a one-timer: harder, and harder to save. A goal lights the lamp behind
the net; a hat trick (`goals` per player) brings hats down onto the ice, but
only for the person ("nobody throws a hat" for the computer); own goals get
their own line. Skating (`SKATE`): let go of the keys and a player coasts to a
stop in about a second (it was 2.6 s and 10 m, too long to control); skate the
other way and it is a hockey stop, braking hard with a spray of snow. The
computer's skaters brake the same way. Goalies sit on an arc in front of the net and save with a chance that
falls with shot speed, rebounds, close range and their own sideways motion;
fast shots can also be blocked, or slip past a body. Against a person the
computer's team is a little sharper (`sharp()`: as fast, keener pokes, better
goalie). Three periods of a minute, then sudden-death overtime if tied. Touch
screens get a stick and three buttons (pass, check, shoot), shown by
`(pointer: coarse)` or after the first touch. (The stick is found as
`.game-touch [data-stick]`: the players' sticks in the SVG are `data-stick` too,
and a bare `[data-stick]` picked one of those and broke the touch stick.)

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
as in a real arena. Its physics is `Resurfacer` in the simulation: from above it
drives toward the arrows; from the cab it keeps going at a cruise, ← → steer and
↑ ↓ change speed (easier: the first controls were found hard). Its body is three
circles against the boards. The ice is counted in 1 m cells and 65% is enough.
The crew's way (`autopilot()`) is rows along the rink, shown ten times as fast;
the pause button becomes "let the crew finish", then "skip". The time is kept
against the best in the browser (`kamboni-best`). Space honks; boards bonk.

From above, the page frosts the used ice (a scratched pattern) and masks the
frost and the skate marks away along the track, which shows as wet ice; the
players, puck and nets are hidden (`is-resurfacing`); the drawing
(`KAMBONI_TOP`) follows a real resurfacer: driver up front on the left, the
snow tank, the conditioner and towel behind. The HUD's clock becomes a bar
("ice 37% clean").

**From the cab** (`assets/js/kamboni.js`, WebGL; loaded on /play/ only): Mertcan
asked to drive from inside after the Kamboni did not work on the TV camera, so
it is the TV camera's replacement between periods (the view button switches to
from above). The ice texture is the game's own rink drawing with the period's
marks and the frost, drawn into a canvas through an SVG data URL (CSS variables
substituted, since an image cannot see them); the clean, wet ice is painted onto
it along the track and only that patch is uploaded. Round it: boards with
KAMBONI adverts, glass, and stands that start right behind the glass (with a
gap you saw into the void). Over it, the cab: its frame, a mirror (a second,
flipped render) that shows the clean band behind, a dashboard with the wheel,
a gauge, an arrow to the dirtiest ice (4 m blocks) and a nodding cat, and a
map. No WebGL: from above instead. Headless Chrome logs "GPU stall due to
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
