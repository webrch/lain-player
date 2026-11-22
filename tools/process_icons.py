"""Prepare Lain player assets: rounded launcher icons, adaptive layers, mipmaps."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC_ICONS = ROOT / "icons"
SRC_WALL = ROOT / "wallpaper"

WEB_ICONS = ROOT / "player-web" / "assets" / "icons"
WEB_WALL = ROOT / "player-web" / "assets" / "wallpaper"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

for p in (WEB_ICONS, WEB_WALL):
    p.mkdir(parents=True, exist_ok=True)

BROWN = (78, 52, 46, 255)      # #4E342E
BROWN_DARK = (62, 39, 35, 255)  # #3E2723
CREAM = (255, 248, 241, 255)


def squircle(img: Image.Image, size: int, radius_ratio: float = 0.225) -> Image.Image:
    """Resize to size x size and clip to Android-style rounded square with alpha."""
    img = img.convert("RGBA").resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * radius_ratio), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def circle(img: Image.Image, size: int) -> Image.Image:
    img = img.convert("RGBA").resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def make_brown_x(size: int = 1024) -> Image.Image:
    """Third preset: brown background with the signature white X."""
    img = Image.new("RGBA", (size, size), BROWN)
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / size
        c = tuple(int(BROWN[i] * (1 - t) + BROWN_DARK[i] * t) for i in range(3)) + (255,)
        d.line((0, y, size, y), fill=c)
    cx = cy = size // 2
    arm = int(size * 0.245)
    w = int(size * 0.055)
    for sign in (-1, 1):
        d.line((cx - arm, cy - arm, cx + arm, cy + arm), fill=CREAM, width=w)
        d.line((cx + arm, cy - arm, cx - arm, cy + arm), fill=CREAM, width=w)
    r = int(size * 0.055)
    for (x, y) in ((cx - arm, cy - arm), (cx + arm, cy + arm),
                   (cx + arm, cy - arm), (cx - arm, cy + arm)):
        d.ellipse((x - r, y - r, x + r, y + r), fill=CREAM)
    return img


def adaptive_foreground(src: Image.Image, size: int = 432) -> Image.Image:
    """Artwork centered inside the 108dp adaptive-icon safe zone."""
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    art_size = int(size * 0.62)
    art = src.convert("RGBA").resize((art_size, art_size), Image.LANCZOS)
    out.paste(art, ((size - art_size) // 2, (size - art_size) // 2))
    return out


presets = {
    "cross": Image.open(SRC_ICONS / "app_icon.png").convert("RGBA"),
    "lain": Image.open(SRC_ICONS / "true_app_icon.png").convert("RGBA"),
    "brown": make_brown_x(),
}

# --- Web / PWA icons -------------------------------------------------------
for name, img in presets.items():
    squircle(img, 512).save(WEB_ICONS / f"{name}-512.png")
    squircle(img, 192).save(WEB_ICONS / f"{name}-192.png")

# --- Wallpapers ------------------------------------------------------------
for src in sorted(SRC_WALL.glob("*")):
    Image.open(src).convert("RGB").save(WEB_WALL / src.name, quality=92)

# --- Android launcher mipmaps (one set per switchable preset) --------------
densities = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
default = presets["cross"]
for density, size in densities.items():
    folder = RES / f"mipmap-{density}"
    folder.mkdir(parents=True, exist_ok=True)
    squircle(default, size).save(folder / "ic_launcher.png")
    circle(default, size).save(folder / "ic_launcher_round.png")
    for name, preset in presets.items():
        squircle(preset, size).save(folder / f"ic_launcher_{name}.png")
        circle(preset, size).save(folder / f"ic_launcher_{name}_round.png")

# --- Adaptive icon layers (Oreo+) -----------------------------------------
v26 = RES / "mipmap-anydpi-v26"
v26.mkdir(parents=True, exist_ok=True)
adaptive_foreground(default).save(RES / "mipmap-xxxhdpi" / "ic_launcher_foreground.png")
(RES / "values" / "ic_launcher_background.xml").parent.mkdir(parents=True, exist_ok=True)
(RES / "values" / "ic_launcher_background.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<resources><color name="ic_launcher_background">#4E342E</color></resources>\n',
    encoding="utf-8",
)

print("OK: icons, wallpapers, mipmaps and adaptive layers generated")
