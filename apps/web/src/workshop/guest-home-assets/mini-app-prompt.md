# Miniature application avatar

Built-in image_gen identity-preserving edit, 8 September 2026. Input: `kirill-object.png`.
Output: `kirill-mini-app.png`. The calm portrait remains the default; the named B2 story previews this candidate.

## App edit prompt

```text
Identity-preserving edit of the referenced avatar. Keep the exact young man's face, hairstyle, calm friendly expression, gray T-shirt, illustration style, head size and compact adult proportions. Replace the three floating cubes with ONE beautiful miniature 3D web application window floating just above his open palm. The other index finger naturally points to the window, as in the reference. The application is a tangible off-white rounded browser window with subtle thickness and restrained perspective, a slim charcoal top bar with three small controls, one large warm burnt-orange feature card and two clean neutral content tiles below. No readable words, no gibberish microtext, no logos. Large simple interface shapes, polished matte material, very subtle warm reflected light on the palm; no neon or sci-fi beam. Make the window clearly recognizable even when the entire avatar is displayed at 200 pixels high. The window is to the viewer's RIGHT of his chest, well below his face, width about 32 percent of the canvas, center around x=75 percent,y=62 percent, bottom at around 72 percent of the canvas. Bring the supporting open hand just under it, slightly higher than the old pose. Keep all fingers natural, relaxed and anatomically correct. Preserve the complete head near the top with about 5 percent padding. Crop below waist, avoid an elongated torso. The object must not cover the face or extend beyond the image edges. Only the person and the floating app, no scene, no extra objects, no captions, no UI outside the miniature window. Genuinely transparent background with alpha, no drawn checkerboard, no white background. High quality clean cutout.
```

## Background preparation prompt

The first output had a drawn checkerboard. A second edit prepared a uniform chroma background to preserve the light application frame during cleanup.

```text
Change ONLY the background of this exact image to a perfectly uniform solid vivid chroma green #00FF00. Remove every checkerboard square and all background texture. Preserve every foreground pixel appearance: the same man's exact face, hair, body, hands, shirt, and the COMPLETE floating miniature application window including its off-white frame, orange panel and light cards. Do not add green reflections or change foreground colors. Keep the same square composition and scale. Hard clean boundary between subject and flat green background. No other edits.
```

## Alpha cleanup

Owner-authorized local ImageMagick processing:

```bash
magick input.png -alpha on -bordercolor '#00ff00' -border 1 -fuzz 25% \
  -fill none -draw 'alpha 0,0 floodfill' -shave 1x1 \
  -channel A -morphology Erode Disk:1 -blur 0x0.5 +channel kirill-mini-app.png
```

Final alpha checked: background corner transparent; the light app panel opaque. The original cube asset is preserved.
The app is baked into this image candidate, not yet a separately animated layer.
