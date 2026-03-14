# Gallery

A minimal personal photo gallery designed for GitHub Pages with no backend and no build step.

## Structure

- `/index.html`: masonry-style homepage
- `/location/index.html`: location-grouped archive view
- `/grid-lanes/index.html`: balanced grid layout view
- `/photos.js`: the photo list and basic site metadata
- `/photos/`: image files stored directly in the repository

## Update the gallery

1. Add image files to `/photos`.
2. Optionally run `./scripts/prepare-images.sh` to generate default `-800` and `-2048` variants.
3. Add a matching entry in `photos.js`.
4. Push to GitHub.

If GitHub Pages is enabled for the repository, the site redeploys automatically.

## Photo entries

Each item in `photos.js` should look like this:

```js
{
  src: "photos/example.jpg",
  alt: "What is visible in the image",
  title: "Short title",
  story: "Optional caption or memory",
  location: "City, Region",
  collection: "Trips"
}
```

Default image behavior:

- gallery cards try `photos/example-800.jpg`
- the lightbox tries `photos/example-2048.jpg`
- if one variant is missing, the app falls back to another available variant and then to `photos/example.jpg` if it still exists

You can override that with optional `thumbnail` and `full` fields in `photos.js`.

To generate those variants locally, run:

```sh
./scripts/prepare-images.sh
```

Or for a specific file:

```sh
./scripts/prepare-images.sh photos/mt_rainier.jpeg
```

After generating both resized files, the helper deletes the original source file so the repo keeps only the served variants.

For JPEG files, the app will try to read these fields directly from EXIF:

- `width`
- `height`
- `timestamp`
- `camera`
- `lens`

That means the normal manual workflow is to maintain only the gallery-specific fields in `photos.js`: `src`, `alt`, `title`, `story`, `location`, and `collection`.

These fields are optional:

- `title`: falls back to the filename, for example `mt_rainier.jpeg` -> `Mt Rainier`
- `alt`: falls back to the resolved title
- `story`: hidden when missing
- `width` / `height`: detected from the actual image when missing

The layouts still use the actual image dimensions to reserve space and calculate the grid-lanes view, but you no longer need to type them manually. If a file has no EXIF data, or the metadata was stripped during export, you can still provide `timestamp`, `takenAt`, `camera`, and `lens` manually as fallback fields.

## Notes

- The site is framework-free: only HTML, CSS, and vanilla JavaScript.
- Direct folder routes work on GitHub Pages, so `/location/` and `/grid-lanes/` stay static.
- The sample images in `/photos` are SVG placeholders. Replace them with your own photos as needed.
- JPEG EXIF metadata is cached in the browser after first load, so repeat visits do not need to re-parse every image from scratch.
