# Issue #808 UI evidence

Captured on 30.09.2026 from the local course preview (`pnpm local:course`, Inside Content `829f6eb`)
with a host `next dev` web on the branch head. Browser: Playwright Chromium, reduced motion on, so
the course film shows its final frame.

| Evidence | Desktop 1440 × 900 | Mobile 390 × 844 |
|---|---|---|
| course page first screen: name, badge, points, film | `course-desktop.png` | `course-mobile.png` |
| programme: cover, purchase in the title row, chapter rail, lesson numbers | `programme-desktop.png` | `programme-mobile.png` |
| Home: the large course card repeats the course first screen | `home-desktop.png` | `home-mobile.png` |

The course film, scroll reveals and value bars were also checked in motion: no element stays
half-transparent after entering the viewport at 1440 and 390, and bars finish growing by mid-screen.
