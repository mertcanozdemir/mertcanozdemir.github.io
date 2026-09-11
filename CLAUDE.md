# CLAUDE.md

Working notes for this repository. Read this before making changes.

## What this is

Mertcan Özdemir's personal site at **mertcanozdemir.com**, built on the
[al-folio](https://github.com/alshedivat/al-folio) Jekyll theme. Mertcan is a
biomedical engineer (PhD, 2025) working on medical image processing and deep
learning for MRI — diffusion models for cardiac cine MRI synthesis. He also
played ice hockey for the Turkish national team.

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

`node` is available. `js-yaml` (installed into the scratchpad) is useful for
validating YAML; `npx prettier` works because `node_modules/` is installed.

## Prettier

`.github/workflows/prettier.yml` runs `npm install --save-dev --save-exact
prettier @shopify/prettier-plugin-liquid`, which **ignores package-lock.json and
installs the latest**. Local and CI once disagreed for exactly this reason, so
`package.json` now pins prettier and the plugin exactly. Keep them pinned, and
run `npx prettier . --check` before committing.

## Two traps that have already caused bugs

1. **The CV page reads `assets/json/resume.json`, not `_data/cv.yml`.**
   `_layouts/cv.liquid` starts with `{% unless site.data.resume %}` and
   `jekyll_get_json` loads resume.json into `site.data.resume`, so cv.yml is a
   dead fallback. Edit resume.json.

2. **Distill posts resolve their bibliography against `/assets/bibliography/`**
   (see `_layouts/distill.liquid`), not `_bibliography/`. `_bibliography/papers.bib`
   is for the publications page via jekyll-scholar; per-post `.bib` files go in
   `assets/bibliography/`.

## Content that is Mertcan's, vs the theme's

The repository was a lightly edited al-folio template and most demo content has
now been removed. What is real:

- `_bibliography/papers.bib` — 10 publications including the 2025 _Diagnostics_
  paper and patent WO2023163682A1.
- `_posts/2025-04-09-spin-echo-sequences.md` — the only real post.
- `_projects/1_project.md` — Endotracheal Tube Cuff Pressure Monitor. **Its six
  images were never committed**, so the figure blocks sit inside `{% comment %}`
  with a note. Drop the images into `assets/img/` and uncomment.
- `_pages/teaching.md` — BMM411 and BMM316, topics taken from the ABYS catalogue.
- `assets/img/` — only `prof_pic.jpg` and `mybrain.gif` (an MRI scan of his own
  brain, shown on the home page).

Anything that reads like "a post with images", Albert Einstein, or lorem ipsum
is theme scaffolding and should be removed, not preserved.

## Conventions

- **Navigation is deliberately three tabs**: publications → cv → teaching.
  `projects` and `blog` keep their pages but sit at `nav: false` until each has
  more than one entry. `latest_posts` and `announcements` are off for the same
  reason. Re-enable by flipping those flags, not by rebuilding anything.
- `imagemagick.widths` is `[200]` because ImageMagick never upscales and the
  largest image is 222px wide. **Raise it when larger images are added**, or the
  srcset will reference files that are never generated — this previously broke
  the link check.
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

Do not deploy after every change. Commit locally, let work accumulate, and push
when he says so.

## Hockey drills — /drills/

Training material from an IIHF development camp, from **Mertcan's own paper
notes**, which he will supply. The page at `_pages/drills.md` animates each
drill from `_data/drills.yml` using `assets/js/drills.js`, which draws an IIHF
rink to scale (60×30 m, centred at 0,0) as inline SVG. Styles live under
"drill diagrams" in `assets/css/_custom.scss`.

**The five drills currently in `_data/drills.yml` are invented placeholders and
some are not sensible hockey** — `backcheck` ends with a shot on goal from the
neutral zone, and is flagged in the file. They exist to show the format and
should all be replaced with real drills, not corrected piecemeal.

Data shape:

```yaml
- id: two-on-one
  title: 2-on-1 Rush
  duration: 6 # seconds the animation runs
  cones: [[-2, -6], [-2, 6]]
  actors:
    - { id: F1, label: F1, team: a, puck: true, path: [[-20, -6], [-8, -7], [2, -6]] }
    - { id: F2, label: F2, team: a, path: [[-20, 6], [-6, 7], [4, 5]] }
  events:
    - { t: 0.45, type: pass, to_actor: F2 }
    - { t: 0.8, type: shot, to: [25.5, 0] }
```

Paths are interpolated with smoothstep; `t` in an event is a fraction of the
drill. **Events carry no coordinates of their own**: they start wherever the
puck already is, and a pass is aimed at where `to_actor` will be when it lands,
so the puck meets the receiver and then travels with them. Writing explicit
`from`/`to` points for passes caused the puck to teleport — one pass was aimed
9 m from where the receiver actually was. Only shots take a `to`.

Still undecided, to settle once the notes arrive:

- Whether Claude transcribes the paper diagrams into coordinates, or builds a
  click-on-the-rink editor so Mertcan can add drills himself.
- Whether the home page splits into two halves (research / hockey). He asked for
  this, but it was deferred until there is enough hockey content to justify it —
  half an empty home page would look worse than the current one.

An earlier attempt — `_data/training.yml`, a filterable table of sessions with
sets and reps — was **rejected and deleted**. He wants diagrams, not tables.
The standalone `drills-preview.html` prototype has been superseded by the page
and is gone too.
