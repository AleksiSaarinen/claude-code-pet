#!/usr/bin/env python3
"""Generate Clawd crab pixel art sprite sheets for claude-code-pet."""

import struct
import zlib
import os

def write_png(filename, width, height, pixels):
    def chunk(chunk_type, data):
        c = chunk_type + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)
    header = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    raw = b''
    for row in pixels:
        raw += b'\x00'
        for r, g, b, a in row:
            raw += struct.pack('BBBB', r, g, b, a)
    idat = chunk(b'IDAT', zlib.compress(raw, 9))
    iend = chunk(b'IEND', b'')
    with open(filename, 'wb') as f:
        f.write(header + ihdr + idat + iend)

def make_image(width, height, bg=(0, 0, 0, 0)):
    return [[bg for _ in range(width)] for _ in range(height)]

def draw_rect(img, x, y, w, h, color):
    for dy in range(h):
        for dx in range(w):
            py, px = y + dy, x + dx
            if 0 <= py < len(img) and 0 <= px < len(img[0]):
                img[py][px] = color

# --- Colors ---
BODY = (210, 120, 80, 255)         # Red-orange
BODY_LIGHT = (225, 140, 100, 255)  # Highlight
BODY_DARK = (185, 100, 65, 255)    # Darker for legs/claws
EYE = (30, 30, 30, 255)
CLEAR = (0, 0, 0, 0)
BLUSH = (230, 110, 100, 255)
SPARK = (255, 220, 100, 255)
RED = (220, 80, 70, 255)
GREEN = (100, 200, 120, 255)
LAPTOP = (80, 80, 90, 255)
LAPTOP_SCREEN = (100, 200, 150, 255)
THINK_BUBBLE = (200, 200, 210, 255)
MAGNIFY = (160, 180, 220, 255)
BOOK = (120, 100, 80, 255)

FW = 120
FH = 120
S = 6  # pixel scale

# Design based on the reference - a cute simple crab:
# Grid (design pixels):
#
#        ##########        <- top of body (10 wide)
#        # []  [] #        <- eyes (row 1-2 inside body)
#        #        #
#   ##===##########===##   <- claws extend from sides at mid body
#        #        #
#        ##########        <- bottom of body
#        ||  ||  ||        <- 3 pairs of legs (short stubby)
#
# Body: 10 wide x 7 tall
# Eyes: 1x2 black, at col 2 and col 7 from body left, rows 1-2
# Claws: 3 wide x 2 tall on each side
# Legs: 4 legs (2 pairs), 1 wide x 2 tall

def draw_crab(img, ox, oy, body_y=0, claw_up=0, leg_phase=0, eyes="normal"):
    # Center in frame
    # Total width: 3(claw) + 10(body) + 3(claw) = 16 design px
    # Total height: 7(body) + 2(legs) = 9 design px
    cx = ox + (FW - 16 * S) // 2
    cy = oy + (FH - 10 * S) // 2 + body_y

    # Body origin (body is 10 wide, starts after left claw space)
    bx = cx + 3 * S
    by = cy

    # === BODY (10 wide x 7 tall) ===
    draw_rect(img, bx, by, 10 * S, 7 * S, BODY)
    # Top highlight
    draw_rect(img, bx + 1 * S, by, 8 * S, 1 * S, BODY_LIGHT)

    # === EYES ===
    if eyes == "normal":
        draw_rect(img, bx + 2 * S, by + 2 * S, 1 * S, 2 * S, EYE)
        draw_rect(img, bx + 7 * S, by + 2 * S, 1 * S, 2 * S, EYE)
    elif eyes == "blink":
        draw_rect(img, bx + 2 * S, by + 3 * S, 1 * S, 1 * S, EYE)
        draw_rect(img, bx + 7 * S, by + 3 * S, 1 * S, 1 * S, EYE)
    elif eyes == "up":
        draw_rect(img, bx + 2 * S, by + 1 * S, 1 * S, 2 * S, EYE)
        draw_rect(img, bx + 7 * S, by + 1 * S, 1 * S, 2 * S, EYE)
    elif eyes == "down":
        draw_rect(img, bx + 2 * S, by + 3 * S, 1 * S, 2 * S, EYE)
        draw_rect(img, bx + 7 * S, by + 3 * S, 1 * S, 2 * S, EYE)
    elif eyes == "left":
        draw_rect(img, bx + 1 * S, by + 2 * S, 1 * S, 2 * S, EYE)
        draw_rect(img, bx + 6 * S, by + 2 * S, 1 * S, 2 * S, EYE)
    elif eyes == "right":
        draw_rect(img, bx + 3 * S, by + 2 * S, 1 * S, 2 * S, EYE)
        draw_rect(img, bx + 8 * S, by + 2 * S, 1 * S, 2 * S, EYE)
    elif eyes == "x":
        for ex in [bx + 2 * S, bx + 7 * S]:
            draw_rect(img, ex, by + 2 * S, 1 * S, 1 * S, RED)
            draw_rect(img, ex, by + 3 * S, 1 * S, 1 * S, RED)
    elif eyes == "happy":
        # Curved happy eyes (just horizontal lines)
        draw_rect(img, bx + 2 * S, by + 3 * S, 1 * S, 1 * S, EYE)
        draw_rect(img, bx + 7 * S, by + 3 * S, 1 * S, 1 * S, EYE)

    # === CLAWS (small, 2 wide x 1 tall on each side) ===
    claw_y = by + 3 * S + claw_up * S

    # Left claw
    draw_rect(img, cx + 1 * S, claw_y, 2 * S, 1 * S, BODY)
    # Right claw
    draw_rect(img, bx + 10 * S, claw_y, 2 * S, 1 * S, BODY)

    # === LEGS (4 separate small legs, evenly spaced) ===
    leg_top = by + 7 * S
    leg_h = 2 * S

    # 4 legs spaced across the body width
    legs = [bx + 1 * S, bx + 3 * S, bx + 6 * S, bx + 8 * S]

    for idx, lx in enumerate(legs):
        off = (1 if (idx + leg_phase) % 2 == 0 else 0) * S
        draw_rect(img, lx, leg_top + off, 1 * S, leg_h, BODY_DARK)

    return bx, by


OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def gen_idle():
    frames = 6
    img = make_image(FW * frames, FH)
    bobs = [0, -2, -3, -2, 0, 2]
    for i in range(frames):
        e = "blink" if i == 2 else "normal"
        draw_crab(img, i * FW, 0, body_y=bobs[i], claw_up=(-1 if i in [1,2,3] else 0), leg_phase=i % 2, eyes=e)
    write_png(os.path.join(OUT_DIR, 'idle.png'), FW * frames, FH, img)
    print(f"  idle.png ({frames} frames)")


def gen_coding():
    frames = 8
    img = make_image(FW * frames, FH)
    for i in range(frames):
        ox = i * FW
        claw = 1 if i % 2 == 0 else -1
        draw_crab(img, ox, 0, body_y=0, claw_up=claw, leg_phase=0, eyes="down")

        bx = ox + (FW - 16 * S) // 2 + 3 * S
        by = (FH - 10 * S) // 2
        lx = bx + 2 * S
        ly = by + 9 * S
        draw_rect(img, lx, ly, 6 * S, 2 * S, LAPTOP)
        draw_rect(img, lx, ly, 6 * S, 1 * S, LAPTOP_SCREEN)

        if i % 2 == 0:
            draw_rect(img, lx + 1 * S, ly - 1 * S, 1 * S, 1 * S, SPARK)
        else:
            draw_rect(img, lx + 4 * S, ly - 1 * S, 1 * S, 1 * S, SPARK)

    write_png(os.path.join(OUT_DIR, 'coding.png'), FW * frames, FH, img)
    print(f"  coding.png ({frames} frames)")


def gen_thinking():
    frames = 6
    img = make_image(FW * frames, FH)
    for i in range(frames):
        ox = i * FW
        draw_crab(img, ox, 0, body_y=0, claw_up=0, leg_phase=0, eyes="up")

        bx = ox + (FW - 16 * S) // 2 + 3 * S
        by = (FH - 10 * S) // 2
        shift = (i % 3) * S

        draw_rect(img, bx + 10 * S, by - 1 * S - shift, 1 * S, 1 * S, THINK_BUBBLE)
        draw_rect(img, bx + 11 * S, by - 3 * S - shift, 2 * S, 2 * S, THINK_BUBBLE)
        if i >= 3:
            draw_rect(img, bx + 12 * S, by - 6 * S - shift, 3 * S, 2 * S, THINK_BUBBLE)

    write_png(os.path.join(OUT_DIR, 'thinking.png'), FW * frames, FH, img)
    print(f"  thinking.png ({frames} frames)")


def gen_success():
    frames = 4
    img = make_image(FW * frames, FH)
    jumps = [0, -8, -12, -4]
    for i in range(frames):
        ox = i * FW
        draw_crab(img, ox, 0, body_y=jumps[i], claw_up=1, leg_phase=i % 2, eyes="happy")

        bx = ox + (FW - 16 * S) // 2 + 3 * S
        by = (FH - 10 * S) // 2 + jumps[i]

        if i >= 1:
            draw_rect(img, bx - 2 * S, by + 2 * S, 1 * S, 1 * S, SPARK)
            draw_rect(img, bx + 12 * S, by + 1 * S, 1 * S, 1 * S, SPARK)
            draw_rect(img, bx + 5 * S, by - 2 * S, 1 * S, 1 * S, GREEN)

    write_png(os.path.join(OUT_DIR, 'success.png'), FW * frames, FH, img)
    print(f"  success.png ({frames} frames)")


def gen_error():
    frames = 4
    img = make_image(FW * frames, FH)
    shakes = [0, -4, 4, 0]
    for i in range(frames):
        ox = i * FW
        draw_crab(img, ox + shakes[i], 0, body_y=0, claw_up=-1, leg_phase=0, eyes="x")

    write_png(os.path.join(OUT_DIR, 'error.png'), FW * frames, FH, img)
    print(f"  error.png ({frames} frames)")


def gen_searching():
    frames = 6
    img = make_image(FW * frames, FH)
    eye_dirs = ["left", "left", "right", "right", "normal", "normal"]
    for i in range(frames):
        ox = i * FW
        claw = 1 if i < 3 else -1
        draw_crab(img, ox, 0, body_y=0, claw_up=claw, leg_phase=i % 2, eyes=eye_dirs[i])

    write_png(os.path.join(OUT_DIR, 'searching.png'), FW * frames, FH, img)
    print(f"  searching.png ({frames} frames)")


def gen_reading():
    frames = 4
    img = make_image(FW * frames, FH)
    for i in range(frames):
        ox = i * FW
        bob = [0, 0, -1, 0][i]
        draw_crab(img, ox, 0, body_y=bob, claw_up=-1, leg_phase=0, eyes="down")

        bx = ox + (FW - 16 * S) // 2 + 3 * S
        by = (FH - 10 * S) // 2 + bob
        draw_rect(img, bx + 2 * S, by + 8 * S, 6 * S, 2 * S, BOOK)
        draw_rect(img, bx + 5 * S, by + 8 * S, 1 * S, 2 * S, (180, 160, 130, 255))

    write_png(os.path.join(OUT_DIR, 'reading.png'), FW * frames, FH, img)
    print(f"  reading.png ({frames} frames)")


if __name__ == '__main__':
    print("Generating Clawd crab sprite sheets...")
    gen_idle()
    gen_coding()
    gen_thinking()
    gen_success()
    gen_error()
    gen_searching()
    gen_reading()
    print("Done!")
