---
version: "gitkeen-site-1"
name: "Gitkeen landing and docs"
description: "The public website for Gitkeen, a visual Git client that works next to any editor. One landing page that explains and downloads the app, plus the documentation from docs/, built from this repository and published on GitHub Pages."
colors:
  # Taken from the logo in brand/ (light versions). See "Colors" below for dark.
  primary: "#F03C2E"        # logo red: the branch stroke and the red commit dot
  secondary: "#2F6FD0"      # logo blue: the two blue commit dots
  accent: "#2F6FD0"
  background: "#FFFAF9"     # near white, so the logo tile still reads as a square
  surface: "#FDECEB"        # logo tile: the soft red rounded square
  text-primary: "#1C1C1F"   # logo ink: the dark branch stroke and the word "git"
  text-secondary: "#5E5150"
  border: "#F2CFCB"
colors-dark:
  # Taken from the -dark versions of the logo.
  primary: "#F4553F"
  secondary: "#4A8FE0"
  accent: "#4A8FE0"
  background: "#1C1C1F"
  surface: "#25211F"
  tile: "#552A26"
  text-primary: "#E3E3E6"
  text-secondary: "#ABA2A0"
  border: "#3B3230"
typography:
  display-lg:
    fontFamily: "Inter"
    fontSize: "64px"
    fontWeight: 500
    lineHeight: "1.04"
    letterSpacing: "-0.02em"
  body-md:
    fontFamily: "Inter"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "1.6"
  label-md:
    fontFamily: "JetBrains Mono"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "1.2"
spacing:
  base: "8px"
  gap: "16px"
  card-padding: "24px"
  section-padding: "80px"
rounded:
  card: "16px"
  control: "8px"
  pill: "9999px"
components:
  card:
    background: "Use the surface token with a 1px border in the border token"
    radius: "Match the declared card radius token"
  button:
    background: "Use primary for the main action (Download), and ink outline for secondary actions"
    radius: "Use the pill radius"
---
# Gitkeen landing and docs

## What this is
The website for **Gitkeen**, a visual Git client that works next to any editor.
Your editor writes code; Gitkeen manages commits, history and more: the whole
commit graph, staging single lines, rewriting history with a few clicks, and an
Undo panel that puts things back.

The site has two parts:

- **Landing page**: what Gitkeen is, what it does, a short tour with the real
  screenshots and recordings from `docs/media/`, and the download for each system.
- **Docs**: every page in `docs/`, rendered with a sidebar. The Markdown files in
  `docs/` stay the single source; the site reads them at build time.

The site lives in `site/` (Astro, with a Svelte island for the download picker).
It is built in public by GitHub Actions on every push to `main` and published on
GitHub Pages at `https://tgomilar.github.io/gitkeen/`.

## Logo
Use the files in `brand/`. `logo.svg` (mark and word) in the header, `icon.svg`
as the favicon, and the `-dark` versions when the page is dark. Never recolor
the logo; the palette below is taken from it, not the other way round.

## Colors
The palette is the logo's own four colors:

| Role | Light | Dark | From the logo |
|---|---|---|---|
| Primary | `#F03C2E` | `#F4553F` | The red branch stroke and the red commit |
| Secondary | `#2F6FD0` | `#4A8FE0` | The blue commits |
| Surface / tile | `#FDECEB` | `#552A26` (tile), `#25211F` (surface) | The rounded square |
| Page background | `#FFFAF9` | `#1C1C1F` | Near white, so the logo's square stays visible |
| Text | `#1C1C1F` | `#E3E3E6` | The ink stroke and the word "git" |

Red is for the one main action on screen (Download) and for the active lane in
graphics. Blue is for links and secondary lanes. Keep background, surface, text
and border roles distinct. Follow the visitor's system light or dark setting,
the same way the logo files and the app do.

## Typography
Inter for headings and body. JetBrains Mono only for things that really are
code: Git commands, file names, keys.

## Layout
Content is left aligned on a 1120px max width. The hero puts the headline and
download on the left and a drawn commit graph, made from the logo's lanes and
dots, on the right. That graph is the one bold element on the page; everything
around it stays quiet. Features read as a list of commits on a lane rather than
a grid of identical cards. Docs pages use a sidebar and a 72-character text column.

## Motion
One moment only: the hero graph draws its lanes once on load. Respect
`prefers-reduced-motion`. No entrance animations on sections.

## Writing
Plain, short sentences, sentence case, like the README. Say what a button does
("Download for macOS"). No marketing superlatives.

## Guardrails
- Do not flatten the page into a generic card grid.
- Do not recolor or redraw the logo.
- Keep buttons, cards and badges on the same radius and border language.
- Docs content comes only from `docs/`; do not copy it into `site/`.
