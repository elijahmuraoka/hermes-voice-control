#!/usr/bin/env python3
"""Generate the HVC app icon set from the orb's CSS identity.

Palette mirrors apps/web/src/styles.css .orb-core:
radial highlight #fff8dc -> gold #d6b36a -> umber #715b32 -> near-black #17120b
on the app background #050505, with the cyan ring accent rgba(157,232,255).

Outputs (apps/web/public/icons/):
  icon-512.png, icon-192.png            manifest any-purpose
  icon-maskable-512.png                 manifest maskable (orb in 66% safe zone)
  apple-touch-icon.png (180x180)        iOS home screen
Run: python3 scripts/generate-app-icons.py
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "apps" / "web" / "public" / "icons"
BG = (5, 5, 5, 255)
SIZE = 1024


def lerp(a: tuple, b: tuple, t: float) -> tuple:
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


# CSS gradient stops: #fff8dc 0%, #d6b36a 28%, #715b32 62%, #17120b 100%
STOPS = [
    (0.0, (255, 248, 220)),
    (0.28, (214, 179, 106)),
    (0.62, (113, 91, 50)),
    (1.0, (23, 18, 11)),
]


def gradient_color(t: float) -> tuple:
    t = max(0.0, min(1.0, t))
    for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
        if t <= t1:
            return lerp(c0, c1, (t - t0) / (t1 - t0))
    return STOPS[-1][1]


def draw_orb(canvas: Image.Image, cx: float, cy: float, radius: float) -> None:
    px = canvas.load()
    # Highlight offset matches CSS `circle at 38% 28%` of the core box.
    hx = cx - radius + 2 * radius * 0.38
    hy = cy - radius + 2 * radius * 0.28
    max_d = radius * 1.62  # gradient reaches the darkest stop at the far rim
    x0, x1 = int(cx - radius) - 1, int(cx + radius) + 1
    y0, y1 = int(cy - radius) - 1, int(cy + radius) + 1
    for y in range(max(y0, 0), min(y1, canvas.height)):
        for x in range(max(x0, 0), min(x1, canvas.width)):
            dx, dy = x - cx, y - cy
            d = math.hypot(dx, dy)
            if d > radius:
                continue
            t = math.hypot(x - hx, y - hy) / max_d
            r, g, b = gradient_color(t)
            # Edge anti-aliasing.
            edge = min(1.0, radius - d)
            px[x, y] = (r, g, b, round(255 * edge))


def make_icon(size: int, orb_scale: float, out_name: str) -> None:
    img = Image.new("RGBA", (SIZE, SIZE), BG)

    # Soft gold aura behind the orb (CSS .orb-aura).
    aura = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ad = ImageDraw.Draw(aura)
    aura_r = SIZE * orb_scale * 0.62
    ad.ellipse(
        [SIZE / 2 - aura_r, SIZE / 2 - aura_r, SIZE / 2 + aura_r, SIZE / 2 + aura_r],
        fill=(214, 179, 106, 70),
    )
    aura = aura.filter(ImageFilter.GaussianBlur(SIZE * 0.055))
    img = Image.alpha_composite(img, aura)

    orb = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw_orb(orb, SIZE / 2, SIZE / 2, SIZE * orb_scale / 2)
    img = Image.alpha_composite(img, orb)

    # Thin cyan ring accent (CSS .orb-ring) just outside the orb.
    ring = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    ring_r = SIZE * orb_scale / 2 * 1.13
    rd.ellipse(
        [SIZE / 2 - ring_r, SIZE / 2 - ring_r, SIZE / 2 + ring_r, SIZE / 2 + ring_r],
        outline=(157, 232, 255, 60),
        width=max(2, SIZE // 256),
    )
    ring = ring.filter(ImageFilter.GaussianBlur(SIZE * 0.002))
    img = Image.alpha_composite(img, ring)

    img.convert("RGB").resize((size, size), Image.LANCZOS).save(OUT / out_name, "PNG")
    print(f"wrote {out_name} ({size}x{size})")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    make_icon(512, 0.72, "icon-512.png")
    make_icon(192, 0.72, "icon-192.png")
    # Maskable: keep everything inside the central 66% safe zone.
    make_icon(512, 0.52, "icon-maskable-512.png")
    make_icon(180, 0.72, "apple-touch-icon.png")


if __name__ == "__main__":
    main()
