# Image delivery optimization without CDN

Source: application changes in `fb45a257`, base `bd57af6ea7bd7a5ef42fd60d193fa43b64ebee90`.
Chromium, 19 October 2026, task-owned Storybook on port 6017, fresh context per sample, DPR 1.
The screenshots show the unchanged Task diagram at 1440 and 390 CSS pixels.

## Effect discovery check (STD-1)

[Measurements](effect-metrics.json) compare only the effect scheduling change. The `passive-before`
samples use the same compiled component with `useLayoutEffect` replaced by `useEffect` in the
browser response; the `layout-after` samples use the compiled source unchanged. All other code and
fixtures are identical. This isolates scheduling; it is not a comparison of the complete baseline
application or a claim about production load-time improvement.

| Viewport | Selected image | Body bytes before / after | Image requests before / after | CLS before / after |
| --- | --- | --- | --- | --- |
| 390 | `tallLight.png?width=420` | 15,350 / 15,350 | 1 / 1 | 0.000120 / 0.000120 |
| 1440 | `wideLight.png?width=960` | 14,158 / 14,158 | 1 / 1 | 0.000220 / 0.000220 |

Transferred image body sizes come from Playwright `request.sizes()`. CLS is the document's sum of
layout-shift entries without recent user input during the observation window, not a field metric.
The diagram's measured position and height deltas are zero in all samples; no horizontal overflow.
Only the selected composition is requested. This check establishes no extra image bytes or layout
regression; it does not measure a reliable latency difference. Local theme/column selection still
requires JavaScript. The full-stack hydration proof separately holds application JS, checks the
reserved ratio, releases JS and checks the loaded image and retained geometry.

## Responsive and storage checks

- The Chromium avatar test covers header/large, 390/1440 and DPR 1/2/3/4 in five fresh contexts.
  Header at DPR 1 and 3 selects 160; mobile large at DPR 2 selects 160; desktop large at DPR 2
  selects 320, at DPR 4 selects 640. Each context issues exactly one image request. Previously the
  component always requested 320.
- The S3 adapter test performs 20 repeated public-image reads: one provider GET instead of 20.
  Protected/quarantine reads do not share that cache. Focused tests exercise expiry, eviction,
  failure, independent mutable buffers and invalidation during an active read.
- The real PostgreSQL Task scenario accepts an existing width, rejects unsupported/file widths,
  and refuses the same sized image after the learner's grant is revoked.

These are controlled local checks. Actual production network latency, bucket policies and field
Core Web Vitals have not been measured by this evidence.
