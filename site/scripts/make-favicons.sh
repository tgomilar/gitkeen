#!/bin/sh
# Render the website's favicons from brand/icon.svg into public/.
#
#   npm run favicons
#
# The SVG is the icon modern browsers use. These are for everything that wants
# a bitmap: favicon.ico for older browsers and for Google's search results,
# which ask for at least 48 px; the Apple touch icon for a home screen; and
# the two sizes the web manifest offers. The files are committed, so the
# website build needs no ImageMagick. Run this again only when the logo
# changes.
#
# Runs on macOS: the SVG is drawn by sips, which renders it as a browser does.
# ImageMagick's own SVG reader drops the logo's lanes and keeps only the dots,
# so it is used only to shrink that drawing to each size (brew install
# imagemagick).
set -e
cd "$(dirname "$0")/.."
svg=../brand/icon.svg
out=public
master=$(mktemp -d)/icon.png
trap 'rm -rf "$(dirname "$master")"' EXIT

sips -s format png "$svg" --out "$master" -z 1024 1024 > /dev/null

shrink() { magick "$master" -filter Lanczos -resize "$1x$1" "$2"; }
shrink 192 "$out/icon-192.png"
shrink 512 "$out/icon-512.png"
# A home screen icon is shown on a square background the system rounds
# itself, so the tile's own transparent corners are filled with its colour.
magick "$master" -filter Lanczos -resize 180x180 -background '#fdeceb' -flatten "$out/apple-touch-icon.png"
magick "$master" -filter Lanczos -define icon:auto-resize=48,32,16 "$out/favicon.ico"
echo "Wrote favicon.ico, apple-touch-icon.png, icon-192.png and icon-512.png in site/public."
