# CV designs

A CV design is a stylesheet plus a few layout choices. Huntboard writes the same HTML for every design
(`lib/render.js`), so a design never changes what the CV says, only how it looks.

- Ready-made designs: one entry in `templates.json` and one `<id>.css` here. `base.css` is always loaded first.
- The user's own design: `workspace/profile/cv_design/design.json` + `design.css` (same format), made by the
  `cv-design` skill from the CV the user uploaded. It is template id `own`.

## Layout choices (`templates.json` entry, or `design.json`)
| Key | Values | Meaning |
|---|---|---|
| `layout` | `single` / `sidebar` | one column, or a left column plus the main column |
| `sections` | list | order of the sections in the main column |
| `side` | list | sections in the left column (`sidebar` only); `contact` is the contact block |
| `footer` | `true` / `false` | print the "Place, date · Name" line at the end |
| `sep` | short text | what stands between contact items and languages (default ` · `) |
| `ats` | `safe` / `weak` | how well online application forms read it (shown to the user) |

Section names: `profile`, `skills`, `experience`, `education`, `certificates`, `languages`, `references`, `other`.
A section that a design does not place is added at the end of the main column: content never disappears.

## The HTML a stylesheet styles
```html
<body class="cv tpl-<id> layout-single|layout-sidebar [has-photo]">
  <header class="head">
    <div class="id">
      <h1 class="name">…</h1>
      <div class="headline">…</div>
      <!-- the contact block (in the left column instead when `side` contains "contact") -->
      <div class="contact"><span class="c-item">address</span><span class="sep"> · </span><span class="c-item">phone</span>…</div>
      <div class="links"><span class="c-item"><a>example.com/me</a></span>…</div>
      <div class="personal"><span class="c-item"><b>Born:</b> …</span>…</div>
      <div class="extra"><span class="c-item">Available immediately</span>…</div>
    </div>
    <img class="photo" src="data:…">          <!-- only when the CV carries a photo -->
  </header>

  <!-- layout-sidebar only: <div class="cols"><aside class="side"> sections… </aside> <main class="body">…</main></div> -->
  <main class="body">
    <section class="sec sec-profile"><h2>Profile</h2><div class="sec-body"><p class="summary">…</p></div></section>
    <section class="sec sec-skills"><h2>Skills</h2><div class="sec-body"><div class="skills">
      <div class="skill"><span class="group">Tools<span class="colon">:</span></span> <span class="items">a, b, c</span></div>
      <div class="skill nogroup"><span class="items">…</span></div>
    </div></div></section>
    <section class="sec sec-experience"><h2>Work experience</h2><div class="sec-body">
      <div class="entry">
        <div class="line1"><span class="title">Job title</span></div>
        <div class="when">May 2024 – Sep 2024</div>
        <div class="line2"><span class="org">Employer</span><span class="where">Town</span></div>
        <ul><li>…</li></ul>
        <div class="tech"><b>Technologies:</b> …</div>
      </div>
    </div></section>
    <!-- education: the same entry, plus <div class="grade">, <div class="recognition">, <div class="note"> -->
    <!-- certificates: entry with line1 (name), when (date), line2 (issuer) -->
    <section class="sec sec-languages">…<div class="langs"><span class="lang"><b>English:</b> C1</span><span class="sep"> · </span>…</div></section>
    <section class="sec sec-references">…<div class="refs"><div class="entry"><span class="quote">“…”</span> <span class="by">…</span></div></div></section>
    <section class="sec sec-other">…<div class="other"><div class="o-line"><b>Availability:</b> …</div></div></section>
  </main>
  <footer class="foot"><div class="signed">Town, date · Name</div><div class="privacy">…</div></footer>
</body>
```

Rules for a stylesheet:
- An entry's lines are in reading order (title, dates, organisation, details). Move the dates with CSS grid or
  flex `order`, never with `float` or `position: absolute`: those change the order of the text inside the PDF, and
  that order is what an application form's software reads.
- Set the paper with `@page { size: A4; margin: … }`. For colour to the paper's edge use `margin: 0` and pad the
  blocks (see `modern.css`, `sidebar.css`).
- Fonts that every computer has (Arial, Calibri, Segoe UI, Georgia, Times New Roman...). No web fonts.
- Plain CSS only: no `<`, no `@import`, no `url(...)` except `data:` images. Huntboard refuses a custom design
  that breaks this, so that nothing is loaded from the internet when a CV is made.
- Everything must stay real text (no text as pictures), so it can be selected, searched and read by forms.

Try a design: `node tools/hunt.js cv render --template <id>`; the user's own one: `node tools/hunt.js cv design check`.
The pictures on the Profile page come from `node tools/make-thumbs.js`.
