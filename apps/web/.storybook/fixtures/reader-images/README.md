# Reader image fixture

`480` and `960` are PNG renditions of the story's project rules → skill → evidence diagram.
Their extensionless names match the real image route's width segment. Storybook `staticDirs`
mounts only this fixture at the Reader story's fixed material and asset IDs; production has no
fixture import or route override. Both responsive sizes must decode successfully.

The Reader Desktop interaction scrolls the image into view and checks decoding before continuing.
This prevents a missing fixture from passing merely because the image error has not fired yet.
