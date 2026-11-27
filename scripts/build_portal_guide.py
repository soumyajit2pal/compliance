"""Build the served, printable guide from the repository's user guide.

The source uses headings, paragraphs, simple lists and tables. No third-party
Markdown renderer or runtime browser dependency is required.
"""
from html import escape
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/week-3/regulatory-master-guide.md'
TARGET = ROOT / 'frontend/guides/week-1-3-navigation.html'
PUBLIC_TARGET = ROOT / 'frontend/public/guides/week-1-3-navigation.html'


def inline(value):
    value = escape(value)
    value = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', value)
    return re.sub(r'`([^`]+)`', r'<code>\1</code>', value)


def build():
    lines = SOURCE.read_text().splitlines()
    chunks = []
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        if not line:
            index += 1
            continue
        if line.startswith('#'):
            level = len(line) - len(line.lstrip('#'))
            chunks.append(f'<h{level}>{inline(line[level:].strip())}</h{level}>')
        elif line.startswith('|'):
            rows = []
            while index < len(lines) and lines[index].strip().startswith('|'):
                row = [cell.strip() for cell in lines[index].strip().strip('|').split('|')]
                if not all(re.fullmatch(r':?-+:?', cell) for cell in row):
                    rows.append(row)
                index += 1
            header = ''.join(f'<th>{inline(cell)}</th>' for cell in rows[0])
            body = ''.join('<tr>' + ''.join(f'<td>{inline(cell)}</td>' for cell in row) + '</tr>' for row in rows[1:])
            chunks.append(f'<div class="guide-table"><table><thead><tr>{header}</tr></thead><tbody>{body}</tbody></table></div>')
            continue
        elif re.match(r'(?:- |\d+\. )', line):
            ordered = not line.startswith('- ')
            tag = 'ol' if ordered else 'ul'
            items = []
            pattern = r'\d+\. ' if ordered else r'- '
            while index < len(lines) and re.match(pattern, lines[index].strip()):
                items.append('<li>' + inline(re.sub(pattern, '', lines[index].strip(), count=1)) + '</li>')
                index += 1
            chunks.append(f'<{tag}>' + ''.join(items) + f'</{tag}>')
            continue
        else:
            paragraph = [line]
            while index + 1 < len(lines) and lines[index + 1].strip() and not re.match(r'(?:#|\||- |\d+\. )', lines[index + 1].strip()):
                index += 1
                paragraph.append(lines[index].strip())
            chunks.append('<p>' + inline(' '.join(paragraph)) + '</p>')
        index += 1
    html = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Week 1–3 navigation &amp; workflow guide</title><link rel="stylesheet" href="/assets/styles.css"><link rel="stylesheet" href="/assets/guides/guide.css"></head>
<body><header class="guide-header"><a class="btn" href="/#help">Return to portal</a><span>Compliance by Design · User guide</span></header>
<main class="guide-document">''' + '\n'.join(chunks) + '</main></body></html>\n'
    TARGET.write_text(html)
    PUBLIC_TARGET.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_TARGET.write_text(html)
    print('Built frontend/guides/week-1-3-navigation.html from the user guide.')


if __name__ == '__main__':
    build()
