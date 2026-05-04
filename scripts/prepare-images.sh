#!/bin/zsh

set -euo pipefail

ROOT_DIR="${0:A:h:h}"
PHOTOS_DIR="${ROOT_DIR}/photos"
SIZES=(800 2048)
SWIFT_MODULE_CACHE_DIR="${TMPDIR:-/tmp}/gallery-swift-module-cache"
SWIFT_VALIDATOR_SCRIPT="${TMPDIR:-/tmp}/gallery-validate-image.swift"
SWIFT_JPEG_FROM_RENDERED_SCRIPT="${TMPDIR:-/tmp}/gallery-jpeg-from-rendered.swift"

is_source_image() {
  local path="$1"
  local name="${path:t:r}"
  local ext="${path:e:l}"

  case "$ext" in
    jpg|jpeg|png|heic|heif|webp) ;;
    *) return 1 ;;
  esac

  case "$name" in
    *-800|*-2048) return 1 ;;
  esac

  return 0
}

build_variant() {
  local src="$1"
  local size="$2"
  local dir="${src:h}"
  local stem="${src:t:r}"
  local ext="${src:e}"
  local out="${dir}/${stem}-${size}.${ext}"

  if [[ -f "$out" && "$out" -nt "$src" ]] && validate_generated_image "$out"; then
    printf 'skip %s\n' "${out#$ROOT_DIR/}"
    return
  fi

  sips -Z "$size" "$src" --out "$out" >/dev/null
  if validate_generated_image "$out"; then
    printf 'write %s\n' "${out#$ROOT_DIR/}"
    return
  fi

  if build_variant_from_quicklook "$src" "$size" "$out"; then
    printf 'write %s (quicklook fallback)\n' "${out#$ROOT_DIR/}"
    return
  fi

  printf 'write %s (invalid output)\n' "${out#$ROOT_DIR/}" >&2
}

ensure_swift_validator() {
  if [[ -s "$SWIFT_VALIDATOR_SCRIPT" ]]; then
    return
  fi

  /bin/cat >"$SWIFT_VALIDATOR_SCRIPT" <<'SWIFT'
import AppKit
import Foundation

let path = CommandLine.arguments[1]

guard let image = NSImage(contentsOfFile: path) else {
  exit(1)
}

var rect = NSRect(origin: .zero, size: image.size)
guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
  exit(1)
}

let width = cgImage.width
let height = cgImage.height
guard width > 0 && height > 0 else {
  exit(1)
}

let bytesPerPixel = 4
let bytesPerRow = bytesPerPixel * width
var data = [UInt8](repeating: 0, count: height * bytesPerRow)

guard let context = CGContext(
  data: &data,
  width: width,
  height: height,
  bitsPerComponent: 8,
  bytesPerRow: bytesPerRow,
  space: CGColorSpaceCreateDeviceRGB(),
  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
  exit(1)
}

context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

for index in stride(from: 0, to: data.count, by: bytesPerPixel) {
  if data[index] != 0 || data[index + 1] != 0 || data[index + 2] != 0 {
    exit(0)
  }
}

exit(1)
SWIFT
}

ensure_swift_jpeg_from_rendered() {
  if [[ -s "$SWIFT_JPEG_FROM_RENDERED_SCRIPT" ]]; then
    return
  fi

  /bin/cat >"$SWIFT_JPEG_FROM_RENDERED_SCRIPT" <<'SWIFT'
import AppKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

let renderedPath = CommandLine.arguments[1]
let originalPath = CommandLine.arguments[2]
let outputPath = CommandLine.arguments[3]

let renderedURL = URL(fileURLWithPath: renderedPath) as CFURL
let originalURL = URL(fileURLWithPath: originalPath) as CFURL
let outputURL = URL(fileURLWithPath: outputPath) as CFURL

guard
  let renderedSource = CGImageSourceCreateWithURL(renderedURL, nil),
  let renderedImage = CGImageSourceCreateImageAtIndex(renderedSource, 0, nil),
  let originalSource = CGImageSourceCreateWithURL(originalURL, nil)
else {
  exit(1)
}

var properties = (CGImageSourceCopyPropertiesAtIndex(originalSource, 0, nil) as? [CFString: Any]) ?? [:]
properties[kCGImageDestinationLossyCompressionQuality] = 0.92

guard
  let destination = CGImageDestinationCreateWithURL(
    outputURL,
    UTType.jpeg.identifier as CFString,
    1,
    nil
  )
else {
  exit(1)
}

CGImageDestinationAddImage(destination, renderedImage, properties as CFDictionary)

guard CGImageDestinationFinalize(destination) else {
  exit(1)
}
SWIFT
}

validate_generated_image() {
  local image_path="$1"

  [[ -s "$image_path" ]] || return 1
  ensure_swift_validator

  /usr/bin/swift -module-cache-path "$SWIFT_MODULE_CACHE_DIR" "$SWIFT_VALIDATOR_SCRIPT" "$image_path" >/dev/null 2>&1
}

build_variant_from_quicklook() {
  local src="$1"
  local size="$2"
  local out="$3"
  local ext="${src:e:l}"
  local tmpdir
  local rendered

  case "$ext" in
    jpg|jpeg) ;;
    *) return 1 ;;
  esac

  tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/gallery-quicklook.XXXXXX")"
  rendered="${tmpdir}/${src:t}.png"

  if ! qlmanage -t -s "$size" -o "$tmpdir" "$src" >/dev/null 2>&1; then
    rm -rf "$tmpdir"
    return 1
  fi

  if [[ ! -s "$rendered" ]]; then
    rm -rf "$tmpdir"
    return 1
  fi

  ensure_swift_jpeg_from_rendered
  if ! /usr/bin/swift -module-cache-path "$SWIFT_MODULE_CACHE_DIR" "$SWIFT_JPEG_FROM_RENDERED_SCRIPT" "$rendered" "$src" "$out" >/dev/null 2>&1; then
    rm -rf "$tmpdir"
    return 1
  fi

  rm -rf "$tmpdir"
  validate_generated_image "$out"
}

delete_original_if_redundant() {
  local src="$1"
  local dir="${src:h}"
  local stem="${src:t:r}"
  local ext="${src:e}"
  local thumb="${dir}/${stem}-800.${ext}"
  local full="${dir}/${stem}-2048.${ext}"

  if [[ -f "$thumb" && -f "$full" ]]; then
    if validate_generated_image "$thumb"; then
      if validate_generated_image "$full"; then
        rm "$src"
        printf 'delete %s\n' "${src#$ROOT_DIR/}"
        return
      fi
    fi

    printf 'keep %s (generated output failed validation)\n' "${src#$ROOT_DIR/}" >&2
  fi
}

collect_sources() {
  if [[ "$#" -gt 0 ]]; then
    for arg in "$@"; do
      local source_path="${arg:A}"
      if [[ ! -f "$source_path" ]]; then
        printf 'missing file: %s\n' "$arg" >&2
        exit 1
      fi
      if ! is_source_image "$source_path"; then
        printf 'skip unsupported source: %s\n' "$arg" >&2
        continue
      fi
      printf '%s\n' "$source_path"
    done
    return
  fi

  find "$PHOTOS_DIR" -maxdepth 1 -type f | sort | while read -r source_path; do
    if is_source_image "$source_path"; then
      printf '%s\n' "$source_path"
    fi
  done
}

main() {
  local sources
  sources=("${(@f)$(collect_sources "$@")}")

  if [[ "${#sources[@]}" -eq 0 ]]; then
    printf 'no source images found\n' >&2
    exit 1
  fi

  for src in "${sources[@]}"; do
    for size in "${SIZES[@]}"; do
      build_variant "$src" "$size"
    done
    delete_original_if_redundant "$src"
  done
}

main "$@"
