#!/usr/bin/env python3
"""Generate flashcard images from Q:/A: markdown decks for Apple Watch."""

import os
import re
import json
from PIL import Image, ImageDraw, ImageFont

# Config
DECKS_DIR = "decks"
OUTPUT_DIR = "watch_cards"
WIDTH, HEIGHT = 396, 484  # Apple Watch Ultra resolution, works on all models
BG_COLOR = (26, 26, 46)       # --bg
CARD_Q_COLOR = (15, 52, 96)   # --card
CARD_A_COLOR = (26, 82, 118)  # --card-flip
TEXT_COLOR = (238, 238, 238)   # --text
ACCENT_COLOR = (233, 69, 96)  # --accent
MUTED_COLOR = (153, 153, 153) # --text-muted
PADDING = 30

def get_font(size, bold=False):
    """Try to load a system font, fall back to default."""
    font_paths = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFCompact.ttf",
        "/System/Library/Fonts/SFNSText.ttf",
        "/Library/Fonts/Arial.ttf",
    ]
    if bold:
        font_paths = [
            "/System/Library/Fonts/Helvetica.ttc",
            "/Library/Fonts/Arial Bold.ttf",
        ] + font_paths
    for path in font_paths:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size, index=1 if bold and path.endswith(".ttc") else 0)
            except Exception:
                try:
                    return ImageFont.truetype(path, size)
                except Exception:
                    continue
    return ImageFont.load_default()

def parse_cards(markdown):
    cards = []
    parts = re.split(r'^(?=Q:)', markdown, flags=re.MULTILINE)
    for part in parts:
        trimmed = part.strip()
        if not trimmed.startswith('Q:'):
            continue
        a_match = re.search(r'^A:', trimmed, re.MULTILINE)
        if not a_match:
            continue
        question = trimmed[2:a_match.start()].strip()
        answer_raw = trimmed[a_match.start() + 2:].strip()
        # Parse table rows from answer
        rows = []
        for line in answer_raw.split('\n'):
            line = line.strip()
            if line.startswith('|') and '---' not in line:
                cells = [c.strip().replace('**', '') for c in line.split('|')[1:-1]]
                if len(cells) >= 2 and cells[0] and cells[1]:
                    rows.append((cells[0], cells[1]))
        if question and rows:
            cards.append({'question': question.replace('**', ''), 'rows': rows})
    return cards

def draw_question(card, index, total, deck_name):
    img = Image.new('RGB', (WIDTH, HEIGHT), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # Card background
    margin = 15
    draw.rounded_rectangle(
        [margin, margin, WIDTH - margin, HEIGHT - margin],
        radius=20, fill=CARD_Q_COLOR
    )

    # Verb centered
    verb_font = get_font(52, bold=True)
    verb = card['question']
    bbox = draw.textbbox((0, 0), verb, font=verb_font)
    vw, vh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((WIDTH - vw) / 2, (HEIGHT - vh) / 2), verb, fill=TEXT_COLOR, font=verb_font)

    return img

def draw_answer(card, index, total, deck_name):
    img = Image.new('RGB', (WIDTH, HEIGHT), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # Card background
    margin = 15
    draw.rounded_rectangle(
        [margin, margin, WIDTH - margin, HEIGHT - margin],
        radius=20, fill=CARD_A_COLOR
    )

    # Table rows centered
    label_font = get_font(18)
    value_font = get_font(32, bold=True)
    rows = card['rows']
    row_height = 80
    total_height = len(rows) * row_height
    start_y = (HEIGHT - total_height) / 2 + 10

    for i, (label_text, value_text) in enumerate(rows):
        y = start_y + i * row_height

        # Label (muted, small)
        bbox = draw.textbbox((0, 0), label_text, font=label_font)
        lw = bbox[2] - bbox[0]
        draw.text(((WIDTH - lw) / 2, y), label_text, fill=MUTED_COLOR, font=label_font)

        # Value (accent color, large)
        bbox = draw.textbbox((0, 0), value_text, font=value_font)
        vw = bbox[2] - bbox[0]
        draw.text(((WIDTH - vw) / 2, y + 24), value_text, fill=ACCENT_COLOR, font=value_font)

        # Separator line
        if i < len(rows) - 1:
            line_y = y + row_height - 8
            draw.line([(PADDING + 20, line_y), (WIDTH - PADDING - 20, line_y)],
                     fill=(255, 255, 255, 25), width=1)

    return img

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    index_path = os.path.join(DECKS_DIR, "index.json")
    with open(index_path) as f:
        deck_files = json.load(f)

    total_images = 0
    for deck_file in deck_files:
        deck_path = os.path.join(DECKS_DIR, deck_file)
        deck_name = deck_file.replace('.md', '')

        with open(deck_path) as f:
            markdown = f.read()

        cards = parse_cards(markdown)
        if not cards:
            print(f"  No cards found in {deck_file}, skipping.")
            continue

        deck_dir = os.path.join(OUTPUT_DIR, deck_name)
        os.makedirs(deck_dir, exist_ok=True)

        print(f"{deck_name}: {len(cards)} cards")
        for i, card in enumerate(cards):
            # Question image
            q_img = draw_question(card, i, len(cards), deck_name)
            q_path = os.path.join(deck_dir, f"{i * 2:03d}_q_{card['question']}.png")
            q_img.save(q_path)

            # Answer image
            a_img = draw_answer(card, i, len(cards), deck_name)
            a_path = os.path.join(deck_dir, f"{i * 2 + 1:03d}_a_{card['question']}.png")
            a_img.save(a_path)

        total_images += len(cards) * 2

    print(f"\nDone! {total_images} images in {OUTPUT_DIR}/")
    print("AirDrop the folder contents to your iPhone, add to a 'Flashcards' album,")
    print("then sync via Watch app → Photos → Synced Album.")

if __name__ == "__main__":
    main()
