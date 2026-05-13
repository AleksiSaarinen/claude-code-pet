#!/usr/bin/env python3
"""Generate Clawd crab pixel art sprite sheets for claude-code-pet."""

import struct
import zlib
import os
import math

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
BODY = (210, 120, 80, 255)
BODY_LIGHT = (225, 140, 100, 255)
BODY_DARK = (185, 100, 65, 255)
EYE = (30, 30, 30, 255)
CLEAR = (0, 0, 0, 0)
BLUSH = (235, 120, 110, 255)
SPARK = (255, 220, 100, 255)
SPARK2 = (255, 180, 80, 255)
RED = (220, 80, 70, 255)
RED_BODY = (220, 100, 75, 255)  # Flushed red for error
GREEN = (100, 200, 120, 255)
STAR = (255, 240, 150, 255)
LAPTOP = (60, 65, 75, 255)
LAPTOP_SCREEN = (90, 200, 140, 255)
LAPTOP_SCREEN2 = (110, 220, 160, 255)  # Screen flicker
THINK_BUBBLE = (210, 210, 220, 255)
THINK_SMALL = (180, 180, 195, 255)
MAGNIFY_RIM = (140, 160, 200, 255)
MAGNIFY_GLASS = (200, 215, 240, 255)
MAGNIFY_SHINE = (230, 240, 255, 255)
BOOK = (140, 110, 75, 255)
BOOK_PAGE = (220, 210, 195, 255)
BOOK_SPINE = (100, 80, 55, 255)
SWEAT = (150, 200, 240, 255)

FW = 120
FH = 120
S = 5  # pixel scale


def draw_crab(img, ox, oy, body_y=0, body_x=0,
              claw_l=0, claw_r=0,  # individual claw offsets (y)
              claw_l_open=False, claw_r_open=False,  # unused, kept for compat
              leg_phase=0, eyes="normal", body_color=None, tilt=0):
    """Draw the Clawd crab. More expressive version."""
    bc = body_color or BODY
    bl = BODY_LIGHT if not body_color else tuple(min(255, c+15) for c in body_color[:3]) + (255,)
    bd = BODY_DARK if not body_color else tuple(max(0, c-25) for c in body_color[:3]) + (255,)

    cx = ox + (FW - 16 * S) // 2 + body_x
    cy = oy + (FH - 10 * S) // 2 + body_y

    bx = cx + 3 * S
    by = cy

    # === BODY ===
    draw_rect(img, bx, by, 10 * S, 7 * S, bc)
    draw_rect(img, bx + 1 * S, by, 8 * S, 1 * S, bl)

    # Tilt effect (shift top row)
    if tilt != 0:
        draw_rect(img, bx, by, 10 * S, 1 * S, CLEAR)
        draw_rect(img, bx + tilt, by, 10 * S, 1 * S, bl)

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
        draw_rect(img, bx + 2 * S, by + 3 * S, 1 * S, 1 * S, EYE)
        draw_rect(img, bx + 7 * S, by + 3 * S, 1 * S, 1 * S, EYE)
    elif eyes == "wide":
        # Big surprised eyes
        draw_rect(img, bx + 2 * S, by + 2 * S, 1 * S, 3 * S, EYE)
        draw_rect(img, bx + 7 * S, by + 2 * S, 1 * S, 3 * S, EYE)
    elif eyes == "dizzy":
        # Spiral-ish dizzy eyes
        draw_rect(img, bx + 2 * S, by + 2 * S, 1 * S, 1 * S, RED)
        draw_rect(img, bx + 7 * S, by + 3 * S, 1 * S, 1 * S, RED)

    # === LEFT CLAW (short, 1 pixel arm) ===
    claw_ly = by + 3 * S + claw_l
    draw_rect(img, cx + 2 * S, claw_ly, 1 * S, 1 * S, bc)

    # === RIGHT CLAW (short, 1 pixel arm) ===
    claw_ry = by + 3 * S + claw_r
    draw_rect(img, bx + 10 * S, claw_ry, 1 * S, 1 * S, bc)

    # === LEGS ===
    leg_top = by + 7 * S
    leg_h = 2 * S
    legs = [bx + 1 * S, bx + 3 * S, bx + 6 * S, bx + 8 * S]

    for idx, lx in enumerate(legs):
        off = (1 if (idx + leg_phase) % 2 == 0 else 0) * S
        draw_rect(img, lx, leg_top + off, 1 * S, leg_h, bd)

    return bx, by


OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def gen_idle():
    """10 frames: scuttle sideways, bob, blink, claw snap."""
    frames = 10
    img = make_image(FW * frames, FH)
    # Scuttle right, bob, blink, scuttle left, snap claw
    params = [
        dict(body_x=0, body_y=0, claw_l=0, claw_r=0, leg_phase=0, eyes="normal"),
        dict(body_x=3, body_y=-2, claw_l=0, claw_r=-S, leg_phase=1, eyes="normal"),
        dict(body_x=5, body_y=0, claw_l=0, claw_r=0, leg_phase=0, eyes="normal"),
        dict(body_x=3, body_y=-2, claw_l=-S, claw_r=0, leg_phase=1, eyes="blink"),
        dict(body_x=0, body_y=0, claw_l=0, claw_r=0, leg_phase=0, eyes="normal"),
        dict(body_x=-3, body_y=-2, claw_l=-S, claw_r=0, leg_phase=1, eyes="normal"),
        dict(body_x=-5, body_y=0, claw_l=0, claw_r=0, leg_phase=0, eyes="normal", claw_r_open=True),
        dict(body_x=-3, body_y=-2, claw_l=0, claw_r=-S, leg_phase=1, eyes="normal"),
        dict(body_x=0, body_y=-3, claw_l=-S, claw_r=-S, leg_phase=0, eyes="blink"),
        dict(body_x=0, body_y=0, claw_l=0, claw_r=0, leg_phase=1, eyes="normal"),
    ]
    for i, p in enumerate(params):
        draw_crab(img, i * FW, 0, **p)
    write_png(os.path.join(OUT_DIR, 'idle.png'), FW * frames, FH, img)
    print(f"  idle.png ({frames} frames)")


def gen_coding():
    """10 frames: rapid claw tapping on laptop, screen flicker."""
    frames = 10
    img = make_image(FW * frames, FH)
    for i in range(frames):
        ox = i * FW
        # Alternating claws tapping rapidly
        cl = -S if i % 3 == 0 else (S if i % 3 == 1 else 0)
        cr = S if i % 3 == 0 else (-S if i % 3 == 1 else 0)
        draw_crab(img, ox, 0, body_y=-1 if i % 2 else 0,
                  claw_l=cl, claw_r=cr,
                  claw_l_open=(i % 4 == 0), claw_r_open=(i % 4 == 2),
                  leg_phase=0, eyes="down")

        bx = ox + (FW - 16 * S) // 2 + 3 * S
        by = (FH - 10 * S) // 2
        lx = bx + 2 * S
        ly = by + 9 * S

        # Laptop
        draw_rect(img, lx, ly, 6 * S, 2 * S, LAPTOP)
        screen_color = LAPTOP_SCREEN2 if i % 3 == 0 else LAPTOP_SCREEN
        draw_rect(img, lx + 1 * S, ly, 4 * S, 1 * S, screen_color)

        # Typing sparks - different positions
        spark_positions = [
            (lx + 1 * S, ly - 1 * S),
            (lx + 3 * S, ly - 2 * S),
            (lx + 5 * S, ly - 1 * S),
            (lx + 2 * S, ly - 1 * S),
            (lx + 4 * S, ly - 2 * S),
        ]
        sp = spark_positions[i % len(spark_positions)]
        draw_rect(img, sp[0], sp[1], 1 * S, 1 * S, SPARK if i % 2 else SPARK2)

    write_png(os.path.join(OUT_DIR, 'coding.png'), FW * frames, FH, img)
    print(f"  coding.png ({frames} frames)")


def gen_thinking():
    """8 frames: sway side to side, growing thought bubbles, claw to chin."""
    frames = 8
    img = make_image(FW * frames, FH)
    for i in range(frames):
        ox = i * FW
        sway = int(math.sin(i * 0.8) * 3)
        draw_crab(img, ox, 0, body_x=sway, body_y=0,
                  claw_l=0, claw_r=-S,  # right claw up to "chin"
                  leg_phase=0, eyes="up", tilt=sway)

        bx = ox + (FW - 16 * S) // 2 + 3 * S + sway
        by = (FH - 10 * S) // 2

        # Growing thought bubbles
        phase = i % 8
        # Small dot
        draw_rect(img, bx + 10 * S, by - 1 * S, 1 * S, 1 * S, THINK_SMALL)
        # Medium bubble
        if phase >= 2:
            draw_rect(img, bx + 11 * S, by - 3 * S, 2 * S, 2 * S, THINK_BUBBLE)
        # Large bubble with "..."
        if phase >= 4:
            draw_rect(img, bx + 12 * S, by - 6 * S, 4 * S, 3 * S, THINK_BUBBLE)
            # Dots inside
            dot_i = (phase - 4)
            if dot_i >= 0:
                draw_rect(img, bx + 13 * S, by - 5 * S, 1 * S, 1 * S, EYE)
            if dot_i >= 1:
                draw_rect(img, bx + 14 * S, by - 5 * S, 1 * S, 1 * S, EYE)
            if dot_i >= 2:
                draw_rect(img, bx + 15 * S, by - 5 * S, 1 * S, 1 * S, EYE)

    write_png(os.path.join(OUT_DIR, 'thinking.png'), FW * frames, FH, img)
    print(f"  thinking.png ({frames} frames)")


def gen_success():
    """8 frames: jump, spin claws, sparkle celebration."""
    frames = 8
    img = make_image(FW * frames, FH)
    jumps = [0, -4, -10, -14, -10, -4, 0, -2]
    for i in range(frames):
        ox = i * FW
        # Claws wave up and down alternating
        cl = -2*S if i % 2 == 0 else S
        cr = S if i % 2 == 0 else -2*S
        draw_crab(img, ox, 0, body_y=jumps[i],
                  claw_l=cl, claw_r=cr,
                  claw_l_open=(i % 2 == 0), claw_r_open=(i % 2 == 1),
                  leg_phase=i % 2, eyes="happy")

        bx = ox + (FW - 16 * S) // 2 + 3 * S
        by = (FH - 10 * S) // 2 + jumps[i]

        # Blush
        draw_rect(img, bx + 0 * S, by + 4 * S, 2 * S, 1 * S, BLUSH)
        draw_rect(img, bx + 8 * S, by + 4 * S, 2 * S, 1 * S, BLUSH)

        # Sparkles rotating around
        angle = i * 0.8
        for j in range(3):
            a = angle + j * 2.1
            sx = int(bx + 5 * S + math.cos(a) * 9 * S)
            sy = int(by + 3 * S + math.sin(a) * 7 * S)
            c = [SPARK, GREEN, STAR][j]
            draw_rect(img, sx, sy, 1 * S, 1 * S, c)

    write_png(os.path.join(OUT_DIR, 'success.png'), FW * frames, FH, img)
    print(f"  success.png ({frames} frames)")


def gen_error():
    """8 frames: frantic shake, turn redder, sweat drops."""
    frames = 8
    img = make_image(FW * frames, FH)
    shakes = [0, -5, 5, -6, 6, -3, 3, 0]
    redness = [0, 10, 20, 30, 30, 20, 10, 0]
    for i in range(frames):
        ox = i * FW
        r = redness[i]
        bc = (min(255, 210 + r), max(0, 120 - r//2), max(0, 80 - r), 255)
        draw_crab(img, ox + shakes[i], 0, body_y=0,
                  claw_l=-S, claw_r=-S,
                  claw_l_open=(i % 2 == 0), claw_r_open=(i % 2 == 1),
                  leg_phase=i % 2, eyes="x" if i < 6 else "dizzy",
                  body_color=bc)

        bx = ox + shakes[i] + (FW - 16 * S) // 2 + 3 * S
        by = (FH - 10 * S) // 2

        # Sweat drops
        if i >= 2:
            drop_y = by - 1 * S + (i % 3) * S
            draw_rect(img, bx + 9 * S, drop_y, 1 * S, 1 * S, SWEAT)
        if i >= 4:
            draw_rect(img, bx, by + (i % 2) * S, 1 * S, 1 * S, SWEAT)

        # Error cross
        if 2 <= i <= 5:
            draw_rect(img, bx + 11 * S, by - 2 * S, 1 * S, 1 * S, RED)
            draw_rect(img, bx + 12 * S, by - 1 * S, 1 * S, 1 * S, RED)
            draw_rect(img, bx + 12 * S, by - 3 * S, 1 * S, 1 * S, RED)
            draw_rect(img, bx + 13 * S, by - 2 * S, 1 * S, 1 * S, RED)

    write_png(os.path.join(OUT_DIR, 'error.png'), FW * frames, FH, img)
    print(f"  error.png ({frames} frames)")


def gen_searching():
    """8 frames: scuttle with magnifying glass, look around."""
    frames = 8
    img = make_image(FW * frames, FH)
    eye_dirs = ["left", "left", "down", "right", "right", "up", "normal", "left"]
    scuttle = [0, 4, 7, 4, 0, -4, -7, -4]
    for i in range(frames):
        ox = i * FW
        draw_crab(img, ox, 0, body_x=scuttle[i], body_y=-1 if i % 2 else 0,
                  claw_l=0, claw_r=-S,
                  claw_r_open=True,
                  leg_phase=i % 2, eyes=eye_dirs[i])

        bx = ox + (FW - 16 * S) // 2 + 3 * S + scuttle[i]
        by = (FH - 10 * S) // 2

        # Magnifying glass held by right claw
        mag_x = bx + 12 * S
        mag_y = by + 1 * S + (1 if i % 2 else 0) * S
        # Glass circle (3x3 with hollow center)
        draw_rect(img, mag_x, mag_y, 3 * S, 3 * S, MAGNIFY_RIM)
        draw_rect(img, mag_x + 1 * S, mag_y + 1 * S, 1 * S, 1 * S, MAGNIFY_GLASS)
        # Shine
        draw_rect(img, mag_x, mag_y, 1 * S, 1 * S, MAGNIFY_SHINE)
        # Handle
        draw_rect(img, mag_x + 1 * S, mag_y + 3 * S, 1 * S, 2 * S, BODY_DARK)

    write_png(os.path.join(OUT_DIR, 'searching.png'), FW * frames, FH, img)
    print(f"  searching.png ({frames} frames)")


def gen_reading():
    """8 frames: hold book, eyes scanning, occasional page turn."""
    frames = 8
    img = make_image(FW * frames, FH)
    for i in range(frames):
        ox = i * FW
        bob = int(math.sin(i * 0.5) * 2)
        # Eyes scan left to right across the book
        eye_seq = ["down", "down", "down", "down", "blink", "down", "down", "down"]
        draw_crab(img, ox, 0, body_y=bob, claw_l=-S, claw_r=-S,
                  leg_phase=0, eyes=eye_seq[i])

        bx = ox + (FW - 16 * S) // 2 + 3 * S
        by = (FH - 10 * S) // 2 + bob

        # Open book
        draw_rect(img, bx + 1 * S, by + 8 * S, 8 * S, 3 * S, BOOK)
        draw_rect(img, bx + 2 * S, by + 8 * S, 6 * S, 2 * S, BOOK_PAGE)
        draw_rect(img, bx + 5 * S, by + 8 * S, 1 * S, 3 * S, BOOK_SPINE)

        # Text lines on page (animated scanning)
        scan = i % 4
        for line in range(min(scan + 1, 2)):
            lx = bx + (2 if i < 4 else 6) * S
            ly = by + (9 + line) * S
            draw_rect(img, lx, ly, 2 * S, 1 * S, (160, 140, 120, 255))

        # Page turn effect on frame 4
        if i == 4:
            draw_rect(img, bx + 5 * S, by + 7 * S, 2 * S, 1 * S, BOOK_PAGE)

    write_png(os.path.join(OUT_DIR, 'reading.png'), FW * frames, FH, img)
    print(f"  reading.png ({frames} frames)")


GLOBE_BLUE = (80, 150, 220, 255)
GLOBE_GREEN = (100, 180, 120, 255)
GLOBE_SHINE = (180, 210, 250, 255)
SIGNAL1 = (120, 190, 240, 255)
SIGNAL2 = (160, 210, 250, 255)
GEAR = (150, 155, 165, 255)
GEAR_DARK = (110, 115, 125, 255)
ROCKET = (200, 80, 60, 255)
FLAME1 = (255, 180, 50, 255)
FLAME2 = (255, 120, 30, 255)
ARROW_UP = (100, 200, 140, 255)


def gen_web():
    """8 frames: crab holding a globe with signal waves, eyes scanning."""
    frames = 8
    img = make_image(FW * frames, FH)
    eye_dirs = ["right", "right", "up", "left", "left", "down", "normal", "right"]
    bob = [0, -1, -2, -1, 0, -1, -2, -1]
    for i in range(frames):
        ox = i * FW
        draw_crab(img, ox, 0, body_y=bob[i], claw_l=0, claw_r=-S,
                  leg_phase=i % 2, eyes=eye_dirs[i])

        bx = ox + (FW - 16 * S) // 2 + 3 * S
        by = (FH - 10 * S) // 2 + bob[i]

        # Globe held by right claw
        gx = bx + 11 * S
        gy = by + 1 * S
        draw_rect(img, gx, gy, 3 * S, 3 * S, GLOBE_BLUE)
        draw_rect(img, gx + 1 * S, gy, 1 * S, 3 * S, GLOBE_GREEN)
        draw_rect(img, gx, gy + 1 * S, 3 * S, 1 * S, GLOBE_GREEN)
        draw_rect(img, gx, gy, 1 * S, 1 * S, GLOBE_SHINE)

        # Signal waves (animated arcs)
        wave_phase = i % 4
        for w in range(min(wave_phase + 1, 3)):
            wx = gx + 3 * S + (w + 1) * S
            wy = gy - w * S
            draw_rect(img, wx, wy, 1 * S, 1 * S, SIGNAL1 if w % 2 == 0 else SIGNAL2)
            if w > 0:
                draw_rect(img, wx, wy + 2 * S, 1 * S, 1 * S, SIGNAL2 if w % 2 == 0 else SIGNAL1)

    write_png(os.path.join(OUT_DIR, 'web.png'), FW * frames, FH, img)
    print(f"  web.png ({frames} frames)")


def gen_running():
    """8 frames: crab running fast with a spinning gear, legs blur."""
    frames = 8
    img = make_image(FW * frames, FH)
    for i in range(frames):
        ox = i * FW
        # Fast scuttle — larger movement
        scuttle_x = int(math.sin(i * 1.5) * 6)
        draw_crab(img, ox, 0, body_x=scuttle_x, body_y=-2 if i % 2 else 0,
                  claw_l=-S if i % 2 else 0, claw_r=0 if i % 2 else -S,
                  leg_phase=i % 2, eyes="normal")

        bx = ox + (FW - 16 * S) // 2 + 3 * S + scuttle_x
        by = (FH - 10 * S) // 2

        # Spinning gear above head
        gx = bx + 4 * S
        gy = by - 4 * S
        # Gear body
        draw_rect(img, gx, gy, 3 * S, 3 * S, GEAR)
        draw_rect(img, gx + 1 * S, gy + 1 * S, 1 * S, 1 * S, GEAR_DARK)
        # Gear teeth rotate
        tooth_positions = [
            [(gx - 1 * S, gy + 1 * S), (gx + 3 * S, gy + 1 * S), (gx + 1 * S, gy - 1 * S), (gx + 1 * S, gy + 3 * S)],
            [(gx - 1 * S, gy), (gx + 3 * S, gy + 2 * S), (gx, gy - 1 * S), (gx + 2 * S, gy + 3 * S)],
        ]
        for tx, ty in tooth_positions[i % 2]:
            draw_rect(img, tx, ty, 1 * S, 1 * S, GEAR)

        # Speed lines behind
        if i % 2 == 0:
            draw_rect(img, bx - 3 * S, by + 2 * S, 2 * S, 1 * S, (180, 180, 190, 120))
            draw_rect(img, bx - 2 * S, by + 5 * S, 1 * S, 1 * S, (180, 180, 190, 80))

    write_png(os.path.join(OUT_DIR, 'running.png'), FW * frames, FH, img)
    print(f"  running.png ({frames} frames)")


def gen_deploying():
    """8 frames: crab launching a rocket/arrow upward, excited."""
    frames = 8
    img = make_image(FW * frames, FH)
    rocket_y = [0, -2, -5, -9, -14, -20, -26, -30]
    for i in range(frames):
        ox = i * FW
        draw_crab(img, ox, 0, body_y=0,
                  claw_l=-2*S if i > 2 else 0, claw_r=-2*S if i > 2 else 0,
                  leg_phase=i % 2,
                  eyes="up" if i < 5 else "happy")

        bx = ox + (FW - 16 * S) // 2 + 3 * S
        by = (FH - 10 * S) // 2

        # Rocket/arrow
        ry = by - 2 * S + rocket_y[i]
        rx = bx + 4 * S
        # Arrow tip
        draw_rect(img, rx + 1 * S, ry, 1 * S, 1 * S, ARROW_UP)
        # Arrow body
        draw_rect(img, rx + 1 * S, ry + 1 * S, 1 * S, 2 * S, ARROW_UP)
        # Arrow wings
        draw_rect(img, rx, ry + 2 * S, 1 * S, 1 * S, ARROW_UP)
        draw_rect(img, rx + 2 * S, ry + 2 * S, 1 * S, 1 * S, ARROW_UP)

        # Flame trail
        if i >= 2:
            for f in range(min(i - 1, 3)):
                fy = ry + 3 * S + f * S
                flame_c = FLAME1 if f % 2 == 0 else FLAME2
                draw_rect(img, rx + 1 * S, fy, 1 * S, 1 * S, flame_c)
                if f > 0:
                    draw_rect(img, rx, fy, 1 * S, 1 * S, FLAME2 if f % 2 == 0 else FLAME1)

        # Sparkle on success frames
        if i >= 5:
            draw_rect(img, bx + 9 * S, by - 1 * S, 1 * S, 1 * S, SPARK)
            draw_rect(img, bx + 1 * S, by - 2 * S, 1 * S, 1 * S, STAR)

    write_png(os.path.join(OUT_DIR, 'deploying.png'), FW * frames, FH, img)
    print(f"  deploying.png ({frames} frames)")


def gen_testing():
    """10 frames: crab with clipboard/checklist, marking items."""
    frames = 10
    img = make_image(FW * frames, FH)
    for i in range(frames):
        ox = i * FW
        bob = int(math.sin(i * 0.6) * 1)
        draw_crab(img, ox, 0, body_y=bob, claw_l=-S, claw_r=0,
                  leg_phase=0, eyes="down" if i % 3 != 2 else "normal")

        bx = ox + (FW - 16 * S) // 2 + 3 * S
        by = (FH - 10 * S) // 2 + bob

        # Clipboard
        cx = bx + 1 * S
        cy = by + 7 * S
        draw_rect(img, cx, cy, 4 * S, 5 * S, BOOK)
        draw_rect(img, cx + 1 * S, cy + 1 * S, 2 * S, 3 * S, BOOK_PAGE)
        # Clip top
        draw_rect(img, cx + 1 * S, cy, 2 * S, 1 * S, GEAR)

        # Checkmarks appear progressively
        checks = i // 3
        for c in range(min(checks, 3)):
            draw_rect(img, cx + 1 * S, cy + (1 + c) * S, 1 * S, 1 * S, GREEN)

        # Pencil in right claw (animated marking)
        if i % 3 == 0 and checks < 3:
            px = cx + 1 * S
            py = cy + (1 + checks) * S
            draw_rect(img, px + 2 * S, py - 1 * S, 1 * S, 1 * S, SPARK)

    write_png(os.path.join(OUT_DIR, 'testing.png'), FW * frames, FH, img)
    print(f"  testing.png ({frames} frames)")


def gen_sleepy():
    """10 frames: crab dozing, eyes droopy, Z bubbles rising."""
    frames = 10
    img = make_image(FW * frames, FH)
    DARK_BODY = (170, 95, 65, 255)
    Z_COLOR = (160, 170, 200, 255)
    for i in range(frames):
        ox = i * FW
        bob = int(math.sin(i * 0.4) * 2)
        draw_crab(img, ox, 0, body_y=bob, claw_l=0, claw_r=0,
                  leg_phase=0, eyes="blink" if i % 5 < 4 else "normal",
                  body_color=DARK_BODY)

        bx = ox + (FW - 16 * S) // 2 + 3 * S
        by = (FH - 10 * S) // 2 + bob

        # Z bubbles float up
        phase = i % 5
        if phase >= 1:
            draw_rect(img, bx + 10 * S, by - (phase) * S, 1 * S, 1 * S, Z_COLOR)
        if phase >= 3:
            draw_rect(img, bx + 11 * S, by - (phase + 1) * S, 1 * S, 1 * S, Z_COLOR)

    write_png(os.path.join(OUT_DIR, 'sleepy.png'), FW * frames, FH, img)
    print(f"  sleepy.png ({frames} frames)")


if __name__ == '__main__':
    print("Generating Clawd crab sprite sheets...")
    gen_idle()
    gen_coding()
    gen_thinking()
    gen_success()
    gen_error()
    gen_searching()
    gen_reading()
    gen_web()
    gen_running()
    gen_deploying()
    gen_testing()
    gen_sleepy()
    print("Done!")
