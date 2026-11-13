---
name: cv-design
description: Copies the look of the user's own CV (columns, colours, fonts, photo, order of the sections) into a design that every CV Huntboard makes for them then uses. Use when the user says "use my CV's design", "make it look like my CV", "copy my template", or presses "Copy the look of my CV".
---

# Copy the look of the user's own CV

The result is the user's **own design**: two files in `<workspace>/profile/cv_design/`, `design.json` (layout
choices) and `design.css` (the look). You write only these two files. You never write HTML and you never change
what the CV says: Huntboard builds the same HTML for every design, and `templates/cv/README.md` describes it.

1. `node tools/hunt.js docs list`: find the document of type `cv`. **Look at the file itself**
   (`<workspace>/documents/<file>`: open the PDF or picture so that you see the page, not only its text).
   If there is no CV, or your tool cannot look at files, run
   `node tools/hunt.js ask "I cannot see the design of your CV here. Please choose one of the ready-made designs on the Profile page." --choices "OK"`
   and stop.
2. Note what you see:
   - one column or two (which side is the narrow one, how wide, what is in it);
   - the order of the sections;
   - the photo: where it sits, its shape and size, or none;
   - fonts (serif or sans; the size of the name, the headings and the text);
   - colours (header, headings, lines, the narrow column);
   - how the headings look (capitals, a line under them, a box, a pill);
   - where the dates are (on the right, in a left column, above the title);
   - margins and how dense the page is.
3. Read `templates/cv/README.md`. Run `node tools/hunt.js cv templates` and start from the nearest ready-made design:
   `node tools/hunt.js cv design init --from <id>` (`sidebar` for two columns, `tabular` for dates in a left
   column, `classic`, `modern`, `creative` or `academic` for one column).
4. Edit `<workspace>/profile/cv_design/design.json` (`layout`, `sections`, `side`, `footer`) and `design.css` until
   they match your notes. Keep to the README's rules: fonts every computer has, the dates moved with grid or flex
   (never float or absolute), and plain CSS only (no `<`, no `@import`, no `url()` except `data:`).
5. `node tools/hunt.js cv design check` renders the user's own CV with the design and writes `preview.pdf` and
   `preview.png` next to the two files. Look at the picture beside the original and fix what differs: columns and
   widths first, then colours and headings, then spacing. Check again; at most 4 rounds. All text must be
   readable, nothing cut off or overlapping, and it should need the same number of pages as the original.
6. What a stylesheet cannot copy (charts, skill bars, rating dots, icon sets, decorative shapes) is left out; that
   content prints as plain text.
7. `node tools/hunt.js profile set cv.template=own`
8. Tell the user in three lines: their own design is ready and chosen; what could not be copied; they can look at
   it with Preview on the Profile page and switch to another design there at any time.
