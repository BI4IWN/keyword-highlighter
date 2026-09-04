# 生成扩展图标：黄色圆角底 + 三条“文本行”，中间一行橙色（被高亮）
# 纯标准库实现，无第三方依赖。用法: python3 gen_icons.py
import struct
import zlib
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "icons"

BG = (255, 212, 59, 255)      # #FFD43B
LINE = (255, 255, 255, 255)   # 白色文本行
HILITE = (232, 89, 12, 255)   # #E8590C 高亮行

# 以 128 为基准的设计坐标
RADIUS = 26
BARS = [  # (x0, y0, x1, y1, color)
    (24, 34, 104, 48, LINE),
    (24, 57, 104, 71, HILITE),
    (24, 80, 88, 94, LINE),
]


def write_png(size, pixels):
    raw = b"".join(b"\x00" + b"".join(bytes(px) for px in row) for row in pixels)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def render(size):
    s = size / 128.0
    r = max(2, round(RADIUS * s))
    px = [[(0, 0, 0, 0)] * size for _ in range(size)]
    for y in range(size):
        for x in range(size):
            cx = min(max(x, r), size - 1 - r)
            cy = min(max(y, r), size - 1 - r)
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                px[y][x] = BG
    for (x0, y0, x1, y1, color) in BARS:
        ax0, ay0 = round(x0 * s), round(y0 * s)
        ax1, ay1 = min(size - 1, round(x1 * s)), min(size - 1, round(y1 * s))
        for y in range(ay0, ay1 + 1):
            for x in range(ax0, ax1 + 1):
                px[y][x] = color
    return px


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in (16, 48, 128):
        data = write_png(size, render(size))
        path = OUT_DIR / f"icon{size}.png"
        path.write_bytes(data)
        print(f"{path}  {len(data)} bytes")


if __name__ == "__main__":
    main()
