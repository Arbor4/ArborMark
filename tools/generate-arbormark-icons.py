#!/usr/bin/env python3
import os
import shutil
import subprocess
from PIL import Image

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_ICON = os.path.join(REPO_ROOT, "src", "renderer", "static", "assets", "icon", "design", "icon_A.png")
STATIC_ICONS_DIR = os.path.join(REPO_ROOT, "src", "renderer", "static", "assets", "icon")
RESOURCES_ICONS_DIR = os.path.join(REPO_ROOT, "resources", "icons")
STATIC_ASSETS_DIR = os.path.join(REPO_ROOT, "src", "renderer", "static", "assets")
ICON_SUBDIR = os.path.join(RESOURCES_ICONS_DIR, "icon")

def main():
    print(f"Loading source icon: {SRC_ICON}")
    base_img = Image.open(SRC_ICON).convert("RGBA")
    w, h = base_img.size

    # 1. Generate 1024x1024 high-res image
    img_1024 = base_img.resize((1024, 1024), Image.Resampling.LANCZOS)
    img_512 = base_img if (w == 512 and h == 512) else base_img.resize((512, 512), Image.Resampling.LANCZOS)

    # Required PNG sizes for both renderer static assets and resources/icons/icon
    sizes = {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_70.png": 70,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_150.png": 150,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }

    os.makedirs(STATIC_ICONS_DIR, exist_ok=True)
    os.makedirs(ICON_SUBDIR, exist_ok=True)

    for filename, dim in sizes.items():
        if dim == 1024:
            resized = img_1024
        elif dim == 512:
            resized = img_512
        else:
            resized = base_img.resize((dim, dim), Image.Resampling.LANCZOS)

        path_static = os.path.join(STATIC_ICONS_DIR, filename)
        path_res = os.path.join(ICON_SUBDIR, filename)

        resized.save(path_static, "PNG")
        resized.save(path_res, "PNG")
        print(f"Generated {filename} ({dim}x{dim})")

    # Also update welcome/license page static media icon
    welcome_media_icon = os.path.join(REPO_ROOT, "src", "renderer", "pages", "welcome", "static", "media", "icon.png")
    if os.path.exists(os.path.dirname(welcome_media_icon)):
        img_512.save(welcome_media_icon, "PNG")
        print("Updated welcome page static icon.png")
    
    license_media_icon = os.path.join(REPO_ROOT, "src", "renderer", "pages", "license", "static", "media", "icon.png")
    if os.path.exists(os.path.dirname(license_media_icon)):
        img_512.save(license_media_icon, "PNG")
        print("Updated license page static icon.png")

    page_dist_media_icon = os.path.join(REPO_ROOT, "src", "renderer", "static", "page-dist", "static", "media", "icon.png")
    if os.path.exists(os.path.dirname(page_dist_media_icon)):
        img_512.save(page_dist_media_icon, "PNG")
        print("Updated page-dist static icon.png")

    # 2. Generate Windows .ico files
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    app_ico_path = os.path.join(RESOURCES_ICONS_DIR, "app.ico")
    installer_ico_path = os.path.join(RESOURCES_ICONS_DIR, "installer.ico")
    file_ico_path = os.path.join(RESOURCES_ICONS_DIR, "file.ico")

    base_img.save(app_ico_path, format="ICO", sizes=ico_sizes)
    base_img.save(installer_ico_path, format="ICO", sizes=ico_sizes)
    base_img.save(file_ico_path, format="ICO", sizes=ico_sizes)
    print(f"Generated Windows .ico: {app_ico_path}, {installer_ico_path}, {file_ico_path}")

    # Mirror legacy static asset copies so src/** packaging never ships the old logo
    os.makedirs(STATIC_ASSETS_DIR, exist_ok=True)
    for name in ("app.ico", "installer.ico", "file.ico"):
        shutil.copyfile(os.path.join(RESOURCES_ICONS_DIR, name), os.path.join(STATIC_ASSETS_DIR, name))
    base_img.save(os.path.join(STATIC_ASSETS_DIR, "file.png"), "PNG")
    print("Mirrored .ico/.png into src/renderer/static/assets")

    # 3. Generate macOS .icns using iconutil
    iconset_dir = os.path.join(REPO_ROOT, "release", "ArborMark.iconset")
    if os.path.exists(iconset_dir):
        shutil.rmtree(iconset_dir)
    os.makedirs(iconset_dir, exist_ok=True)

    iconset_mapping = {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }
    for fname, dim in iconset_mapping.items():
        if dim == 1024:
            r = img_1024
        elif dim == 512:
            r = img_512
        else:
            r = base_img.resize((dim, dim), Image.Resampling.LANCZOS)
        r.save(os.path.join(iconset_dir, fname), "PNG")

    mac_icns_path = os.path.join(RESOURCES_ICONS_DIR, "icon.icns")
    try:
        subprocess.run(["iconutil", "-c", "icns", iconset_dir, "-o", mac_icns_path], check=True)
        print(f"Generated macOS .icns: {mac_icns_path}")
    except Exception as e:
        print(f"iconutil error (optional): {e}")
    finally:
        shutil.rmtree(iconset_dir, ignore_errors=True)

    # 4. Regenerate Windows Start menu tile logos (A mark, transparent canvas)
    tile_dir = os.path.join(RESOURCES_ICONS_DIR, "tile")
    tiles = {
        "OD-LargeTile.scale.png": (310, 310, 115),
        "OD-MediumTile.scale-100.png": (150, 150, 53),
        "OD-MediumTile.scale-200.png": (300, 300, 106),
        "OD-MediumTile.scale-400.png": (600, 600, 212),
        "OD-SmallTile.scale-100.png": (77, 77, 53),
        "OD-SmallTile.scale-200.png": (154, 154, 106),
        "OD-SmallTile.scale-400.png": (308, 308, 212),
        "OD-WideTile.scale-100.png": (310, 150, 53),
        "OD-WideTile.scale-200.png": (620, 300, 106),
        "OD-WideTile.scale-400.png": (1240, 600, 212),
    }
    os.makedirs(tile_dir, exist_ok=True)
    for filename, (width, height, icon_size) in tiles.items():
        canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        tile_icon = base_img.resize((icon_size, icon_size), Image.Resampling.LANCZOS)
        canvas.paste(tile_icon, ((width - icon_size) // 2, (height - icon_size) // 2), tile_icon)
        canvas.save(os.path.join(tile_dir, filename), "PNG")
        static_tile_dir = os.path.join(STATIC_ASSETS_DIR, "tile")
        os.makedirs(static_tile_dir, exist_ok=True)
        canvas.save(os.path.join(static_tile_dir, filename), "PNG")
        print(f"Generated tile {filename} ({width}x{height})")

    print("All ArborMark icons successfully generated!")

if __name__ == "__main__":
    main()
