#!/bin/zsh

set -euo pipefail

ROOT_DIR="${0:A:h:h}"
PHOTOS_DIR="${ROOT_DIR}/photos"
SIZES=(800 2048)

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

  if [[ -f "$out" && "$out" -nt "$src" ]]; then
    printf 'skip %s\n' "${out#$ROOT_DIR/}"
    return
  fi

  sips -Z "$size" "$src" --out "$out" >/dev/null
  printf 'write %s\n' "${out#$ROOT_DIR/}"
}

delete_original_if_redundant() {
  local src="$1"
  local dir="${src:h}"
  local stem="${src:t:r}"
  local ext="${src:e}"
  local thumb="${dir}/${stem}-800.${ext}"
  local full="${dir}/${stem}-2048.${ext}"

  if [[ -f "$thumb" && -f "$full" ]]; then
    rm "$src"
    printf 'delete %s\n' "${src#$ROOT_DIR/}"
  fi
}

collect_sources() {
  if [[ "$#" -gt 0 ]]; then
    for arg in "$@"; do
      local path="${arg:A}"
      if [[ ! -f "$path" ]]; then
        printf 'missing file: %s\n' "$arg" >&2
        exit 1
      fi
      if ! is_source_image "$path"; then
        printf 'skip unsupported source: %s\n' "$arg" >&2
        continue
      fi
      printf '%s\n' "$path"
    done
    return
  fi

  find "$PHOTOS_DIR" -maxdepth 1 -type f | sort | while read -r path; do
    if is_source_image "$path"; then
      printf '%s\n' "$path"
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
