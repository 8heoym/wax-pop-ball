"""앱 아이콘 PNG 생성: 나무색 바탕 위 흰 점토 공 + 마블 줄무늬.

외부 라이브러리 없이 표준 라이브러리만 사용. 실행: python3 scripts/make-icons.py
"""
import math
import struct
import zlib
from pathlib import Path

WOOD = (233, 207, 166)
CLAY = (250, 248, 244)
BLUE = (60, 110, 200)
YELLOW = (245, 200, 40)
GREEN = (70, 150, 90)
SHADOW = (201, 165, 116)


def pixel(x: float, y: float) -> tuple[int, int, int]:
    """x, y는 -1~1 정규 좌표."""
    # 바닥 그림자
    if ((x - 0.04) / 0.62) ** 2 + ((y - 0.62) / 0.14) ** 2 < 1:
        return SHADOW
    r = math.hypot(x, y + 0.04)
    if r > 0.62:
        return WOOD
    # 마블 줄무늬 (파랑과 노랑이 섞이며 초록)
    band = math.sin(7 * x + 4 * math.sin(5 * y))
    base = CLAY
    if band > 0.75:
        base = BLUE
    elif band < -0.75:
        base = YELLOW
    elif abs(band) > 0.55:
        base = GREEN
    # 왼쪽 위 빛
    light = 0.78 + 0.22 * max(0.0, (-x - (y + 0.04)) / 0.62 * 0.7 + math.sqrt(max(0.0, 1 - (r / 0.62) ** 2)) * 0.6)
    return tuple(min(255, int(c * light)) for c in base)


def write_png(path: Path, size: int) -> None:
    rows = []
    for j in range(size):
        row = bytearray([0])
        for i in range(size):
            x = (i + 0.5) / size * 2 - 1
            y = (j + 0.5) / size * 2 - 1
            row.extend(pixel(x, y))
        rows.append(bytes(row))
    raw = b''.join(rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    path.write_bytes(png)


if __name__ == '__main__':
    out = Path(__file__).resolve().parent.parent / 'public' / 'icons'
    out.mkdir(parents=True, exist_ok=True)
    for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)]:
        write_png(out / name, size)
        print(out / name)
