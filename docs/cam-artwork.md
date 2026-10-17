# Camera artwork

Edit or replace [`cam/zucchini.svg`](../cam/zucchini.svg) to change the flying artwork. No build step or JavaScript changes are needed. The Pages deployment includes the SVG automatically.

Keep the `viewBox="-46 -22 92 44"` and draw within it, centered around `(0, 0)` with the front pointing right. The animation draws the SVG at 92 × 44 pixels before applying its size and rotation.

Zucchini spawn for open mouths. When a mouth closes or leaves the view, its existing zucchini keep their momentum, tumble and fall under gravity until they leave the bottom of the screen. Reopening a mouth starts new arrivals; fallen zucchini continue falling.
