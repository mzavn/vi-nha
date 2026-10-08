#!/bin/sh
# Dựng lại icon PNG từ web/public/icons/icon.svg. Cần rsvg-convert (brew install librsvg).
# Nền phủ kín khung nên cùng một ảnh dùng được cho "any" và "maskable"; iOS tự bo góc apple-touch-icon.
set -eu
cd "$(dirname "$0")/../public/icons"
rsvg-convert -w 192 -h 192 icon.svg -o icon-192.png
rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png
rsvg-convert -w 180 -h 180 icon.svg -o apple-touch-icon.png
