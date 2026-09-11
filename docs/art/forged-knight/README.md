# Forged Pinball Knight armor and rolling rig

`armor-six-view-reference.png` is the generated modeling reference: front,
front three-quarter, side, rear three-quarter, back and high three-quarter,
with construction details along the lower edge. Generated using the built-in
image-generation tool; the exact prompt is below. This is a concept reference,
not a claim of historical reconstruction or a texture projected onto the model.

The live model now uses custom curved shell profiles and dished plates, rolled
rims, a wrapped visor, a ridged breastplate/backplate, overlapping shoulder and
waist lames, leather straps, rivets, articulated fingers, and fitted leg armor.
The portrait is rendered from this model. The existing character pixel filter
is retained; the workshop shows the underlying geometry beside its filtered view.

Gameplay `roll` and `ball` now use the entire articulated knight. The pelvis,
spine, neck, knees and arms fold into the tuck; a separate parent rotates that
assembled pose about the ball center. Spin follows achieved travel. Recovery
settles to the nearest upright revolution and blends onto the feet. `steelball`
blends to a live chrome shell. The six magical marble materials and the bolt/
laser transformations retain their distinct material-specific artwork and effects.
Cinematic helmet removal remains separate from the gameplay full-body tuck.

Review locally at `/scripts/knight-motion-preview.html`, with `tumble`,
`armored-ball`, and `steel-ball` alongside the existing walking/combat controls.

## Image-generation prompt

Use case: stylized-concept. Asset type: high-detail multi-angle character modeling reference sheet for Pinball Knight. Generate one large landscape turnaround sheet showing THE SAME realistic medieval steel armored knight in six clearly separated full-body views: front, front three-quarter, exact side, rear three-quarter, back, and high three-quarter. Neutral relaxed A pose in each view, feet fully visible, consistent body and armor construction across every view. Neutral warm-gray studio background, clear soft studio lighting with broad metal highlights. Closed pointed bascinet helmet with narrow dark visor slit, rows of small breathing holes, layered neck protection; anatomically shaped breastplate with raised central ridge and rolled edges, overlapping articulated waist lames and tassets; layered rounded pauldrons, elbow cops, articulated gauntlets, fitted greaves, knee cops with side wings, overlapping sabaton toe plates. Dark chainmail visible only at flexible joints, dark brown leather straps and small steel rivets visibly explain how the plates are assembled. Brushed slightly worn silver steel, fine restrained scratches, darker recesses, convincing thickness and curved forged surfaces. Human proportions, practical functional armor, no giant shoulder pads, no spikes, no glowing parts, no cape, no shield, no weapon obscuring armor. Photorealistic 3D collectible/modeling reference quality rather than primitive geometric shapes. Small simple angle labels only. This reference will guide a realtime 3D game model, so make silhouette, plate overlaps and joint construction exceptionally readable.

## Automatic pinball polish update

Full gameplay ball mode now closes into the polished steel sphere automatically;
only the lower-speed tumble remains visibly folded armor. The Ball Form potion
uses the same chrome presentation. A studio reflection environment supplies
metal highlights, and speed-trail ghosts now sample the live render layer.
