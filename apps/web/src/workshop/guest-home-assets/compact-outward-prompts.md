# Compact outward gesture refinement

8 September 2026. Built-in `image_gen`, identity-preserving edits. The owner asked for a hand
visible beside the mobile CTA, then a shorter torso and a smaller shoulder-to-hand distance.
Original gesture and calm portrait remain preserved.

## Outward gesture

Input: `kirill-gesture.png`. Output: `kirill-gesture-outward.png`.

```text
Edit this avatar illustration. Preserve exactly the young man's identity, face, hair, friendly calm expression, gray T-shirt, drawing style, colors and head proportions. Change only the presenting arm: open palm a little higher (near lower chest rather than abdomen), extend the forearm diagonally outward toward the LEFT of the image, away from the torso, in a relaxed inviting explanatory gesture. The open hand should be clearly to the left of his body silhouette, fingers naturally relaxed, anatomically correct five fingers, elbow bent naturally. Not a raised waving hand; not near shoulder height. Purpose: avatar on the right of a compact mobile banner with a button covering the lower torso; the hand must remain visible to the LEFT and just ABOVE that button. Compact upper body portrait, head fully visible near top, crop below waist, entire outstretched hand in frame with modest padding. No objects, no lettering, no graphics, no UI. Genuinely transparent background with alpha, no white backdrop and no checkerboard drawn into image. High quality clean edges.
```

## Compact gesture (selected)

Input: `kirill-gesture-outward.png`. Output: `kirill-gesture-compact.png`.

```text
Identity-preserving edit of this same illustrated man. Keep his exact face, head size, hairstyle, gray T-shirt, gentle expression and drawing style. His torso is currently too elongated. Redraw a more compact upper body with the shoulder-to-waist distance approximately 20% shorter; natural adult proportions, do not distort or shorten the face. Bend the presenting elbow a little more and bring the open palm approximately 15% of the canvas height higher, to lower-chest level, closer vertically to the shoulder. Keep the palm extended clearly out to the LEFT side of the body, NOT centered in front of the chest, and well below shoulder level, with relaxed anatomically correct five fingers. The elbow should also be higher and closer to the lower ribcage. This is a relaxed explanatory palm-up gesture, not a wave. Square composition, head top padding about 4%, compact half-body crop, full hand visible, no long lower torso. Need space from hand to shoulder reduced visibly. No objects, lettering, symbols, UI. Real transparent background with alpha; do NOT draw any checkerboard texture. Preserve facial likeness exactly.
```

The tool produced opaque images with a drawn light checkerboard. Owner-authorized ImageMagick
cleanup removed the connected background and softened edges for both edits:

```bash
magick input.png -alpha on -bordercolor white -border 1 -fuzz 18% \
  -fill none -draw 'alpha 0,0 floodfill' -shave 1x1 \
  -channel A -morphology Erode Disk:1 -blur 0x0.5 +channel output.png
```

The selected PNG has an alpha channel, a fully transparent corner and an opaque torso.
The result was inspected against the dark banner, including the visible palm at 320 px.
