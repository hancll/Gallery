(function () {
  const photos = Array.isArray(window.GALLERY_PHOTOS) ? [...window.GALLERY_PHOTOS] : [];
  const site = window.GALLERY_SITE || {};
  const page = document.body.dataset.page || "home";
  const headerRoot = document.querySelector("#site-header");
  const mainRoot = document.querySelector("#page-main");
  const footerRoot = document.querySelector("#site-footer");
  const routes = new Set(["location", "grid-lanes"]);
  const exifCachePrefix = "gallery-exif:";
  const sizeCachePrefix = "gallery-size:";
  const typeSizes = {
    1: 1,
    2: 1,
    3: 2,
    4: 4,
    5: 8,
    7: 1,
    9: 4,
    10: 8,
  };

  function getBasePath() {
    const segments = window.location.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];

    if (last === "index.html" || last === "404.html") {
      segments.pop();
    }

    if (routes.has(segments[segments.length - 1])) {
      segments.pop();
    }

    return segments.length ? `/${segments.join("/")}` : "";
  }

  const basePath = getBasePath();

  function withBase(path) {
    if (!path) {
      return basePath || "/";
    }

    if (/^(https?:)?\/\//.test(path) || path.startsWith("data:")) {
      return path;
    }

    const clean = path.replace(/^\/+/, "");
    return `${basePath}/${clean}`.replace(/\/{2,}/g, "/");
  }

  function deriveVariantPath(path, sizeLabel) {
    if (!path || !/\.[^.\/]+$/.test(path)) {
      return path;
    }

    return path.replace(/(\.[^.\/]+)$/, `-${sizeLabel}$1`);
  }

  function getThumbnailPath(photo) {
    return photo.thumbnail || deriveVariantPath(photo.src, "800") || photo.src;
  }

  function getFullImagePath(photo) {
    return photo.full || deriveVariantPath(photo.src, "2048") || photo.src;
  }

  function uniquePaths(paths) {
    return [...new Set(paths.filter(Boolean))];
  }

  function getThumbnailCandidates(photo) {
    return uniquePaths([getThumbnailPath(photo), getFullImagePath(photo), photo.src]);
  }

  function getFullImageCandidates(photo) {
    return uniquePaths([getFullImagePath(photo), photo.src, getThumbnailPath(photo)]);
  }

  function homeHref() {
    return `${basePath || ""}/`;
  }

  function pageHref(route) {
    return route ? withBase(route) : homeHref();
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toDate(value) {
    if (!value) {
      return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDate(dateString) {
    const date = toDate(dateString);

    if (!date) {
      return "Unknown date";
    }

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  }

  function getCaptureDate(item) {
    return item.timestamp || item.takenAt;
  }

  function formatTimestamp(dateString) {
    const date = toDate(dateString);

    if (!date) {
      return "Unknown time";
    }

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  }

  function sortByDateDescending(list) {
    return [...list].sort((left, right) => {
      const leftDate = toDate(getCaptureDate(left));
      const rightDate = toDate(getCaptureDate(right));
      return (rightDate ? rightDate.getTime() : 0) - (leftDate ? leftDate.getTime() : 0);
    });
  }

  function shuffleList(list) {
    const shuffled = [...list];

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      const current = shuffled[index];
      shuffled[index] = shuffled[swapIndex];
      shuffled[swapIndex] = current;
    }

    return shuffled.map((photo, index) => ({ ...photo, index }));
  }

  function getStats(list) {
    const sorted = sortByDateDescending(list);
    const locations = new Set(list.map((item) => item.location));
    const collections = new Set(list.map((item) => item.collection));

    return {
      count: list.length,
      locationCount: locations.size,
      collectionCount: collections.size,
      latest: sorted[0],
    };
  }

  function isJpegPath(path) {
    return /\.jpe?g(?:$|[?#])/i.test(path);
  }

  function titleFromFilename(path) {
    const name = (path || "")
      .split("/")
      .pop()
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .trim();

    if (!name) {
      return "Untitled";
    }

    return name.replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function applyResponsiveImageSource(image, candidates) {
    const queue = [...candidates];

    const tryNext = () => {
      const next = queue.shift();
      if (!next) {
        image.onerror = null;
        return;
      }

      image.onerror = tryNext;
      image.src = next;
    };

    tryNext();
  }

  function normalizeExifTimestamp(value) {
    const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(value || "").trim());

    if (!match) {
      return "";
    }

    return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
  }

  function readAscii(view, offset, length) {
    let text = "";
    const limit = Math.min(offset + length, view.byteLength);

    for (let index = offset; index < limit; index += 1) {
      const charCode = view.getUint8(index);
      if (charCode === 0) {
        break;
      }
      text += String.fromCharCode(charCode);
    }

    return text.trim();
  }

  function readTagValue(view, tiffStart, entryOffset, littleEndian) {
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    const unitSize = typeSizes[type];

    if (!unitSize || count === 0) {
      return null;
    }

    const totalSize = unitSize * count;
    const valueOffset =
      totalSize <= 4 ? entryOffset + 8 : tiffStart + view.getUint32(entryOffset + 8, littleEndian);

    if (valueOffset < 0 || valueOffset + totalSize > view.byteLength) {
      return null;
    }

    if (type === 2) {
      return readAscii(view, valueOffset, count);
    }

    if (type === 3 && count === 1) {
      return view.getUint16(valueOffset, littleEndian);
    }

    if (type === 4 && count === 1) {
      return view.getUint32(valueOffset, littleEndian);
    }

    return null;
  }

  function readIfd(view, tiffStart, ifdOffset, littleEndian) {
    if (ifdOffset < 0 || ifdOffset + 2 > view.byteLength) {
      return new Map();
    }

    const entries = view.getUint16(ifdOffset, littleEndian);
    const tags = new Map();

    for (let index = 0; index < entries; index += 1) {
      const entryOffset = ifdOffset + 2 + index * 12;
      if (entryOffset + 12 > view.byteLength) {
        break;
      }

      const tag = view.getUint16(entryOffset, littleEndian);
      const value = readTagValue(view, tiffStart, entryOffset, littleEndian);

      if (value !== null && value !== "") {
        tags.set(tag, value);
      }
    }

    return tags;
  }

  function parseExifFromJpeg(arrayBuffer) {
    const view = new DataView(arrayBuffer);

    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) {
      return {};
    }

    let offset = 2;

    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xff) {
        break;
      }

      const marker = view.getUint8(offset + 1);

      if (marker === 0xda || marker === 0xd9) {
        break;
      }

      const segmentLength = view.getUint16(offset + 2, false);

      if (segmentLength < 2 || offset + 2 + segmentLength > view.byteLength) {
        break;
      }

      if (marker === 0xe1 && readAscii(view, offset + 4, 4) === "Exif") {
        const tiffStart = offset + 10;
        const littleEndian = readAscii(view, tiffStart, 2) === "II";

        if (readAscii(view, tiffStart, 2) !== "II" && readAscii(view, tiffStart, 2) !== "MM") {
          return {};
        }

        const ifd0Offset = tiffStart + view.getUint32(tiffStart + 4, littleEndian);
        const ifd0 = readIfd(view, tiffStart, ifd0Offset, littleEndian);
        const exifPointer = ifd0.get(0x8769);
        const exifIfd = exifPointer ? readIfd(view, tiffStart, tiffStart + exifPointer, littleEndian) : new Map();
        const timestamp = normalizeExifTimestamp(exifIfd.get(0x9003) || exifIfd.get(0x9004) || ifd0.get(0x0132));

        return {
          camera: ifd0.get(0x0110) || "",
          lens: exifIfd.get(0xa434) || "",
          timestamp,
          takenAt: timestamp ? timestamp.slice(0, 10) : "",
        };
      }

      offset += 2 + segmentLength;
    }

    return {};
  }

  function getExifCacheKey(photo) {
    return `${exifCachePrefix}${photo.src}`;
  }

  function getSizeCacheKey(photo) {
    return `${sizeCachePrefix}${photo.src}`;
  }

  function readExifCache(photo) {
    try {
      const raw = window.localStorage.getItem(getExifCacheKey(photo));
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeExifCache(photo, metadata) {
    try {
      window.localStorage.setItem(getExifCacheKey(photo), JSON.stringify(metadata));
    } catch (error) {
      return;
    }
  }

  function readSizeCache(photo) {
    try {
      const raw = window.localStorage.getItem(getSizeCacheKey(photo));
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeSizeCache(photo, metadata) {
    try {
      window.localStorage.setItem(getSizeCacheKey(photo), JSON.stringify(metadata));
    } catch (error) {
      return;
    }
  }

  async function loadExifMetadata(photo) {
    if (!isJpegPath(photo.src)) {
      return {};
    }

    const cached = readExifCache(photo);
    if (cached) {
      return cached;
    }

    try {
      const candidates = getFullImageCandidates(photo).map((path) => withBase(path));

      for (const candidate of candidates) {
        const response = await fetch(candidate, { cache: "force-cache" });
        if (!response.ok) {
          continue;
        }

        const metadata = parseExifFromJpeg(await response.arrayBuffer());
        writeExifCache(photo, metadata);
        return metadata;
      }

      return {};
    } catch (error) {
      return {};
    }
  }

  async function loadImageDimensions(photo) {
    if (photo.width && photo.height) {
      return {
        width: photo.width,
        height: photo.height,
      };
    }

    const cached = readSizeCache(photo);
    if (cached && cached.width && cached.height) {
      return cached;
    }

    try {
      const candidates = getFullImageCandidates(photo).map((path) => withBase(path));
      const dimensions = await new Promise((resolve) => {
        const image = new Image();
        let index = 0;

        image.onload = () => {
          resolve({
            width: image.naturalWidth || 0,
            height: image.naturalHeight || 0,
          });
        };

        image.onerror = () => {
          const next = candidates[index];
          index += 1;

          if (!next) {
            resolve({
              width: 0,
              height: 0,
            });
            return;
          }

          image.src = next;
        };

        image.decoding = "async";
        image.onerror();
      });

      if (dimensions.width && dimensions.height) {
        writeSizeCache(photo, dimensions);
      }

      return dimensions;
    } catch (error) {
      return {
        width: 0,
        height: 0,
      };
    }
  }

  function normalizePhoto(photo, index) {
    const displayTitle = photo.title || titleFromFilename(photo.src);
    const timestamp = photo.timestamp || "";
    const takenAt = photo.takenAt || (timestamp ? timestamp.slice(0, 10) : "");

    return {
      ...photo,
      index,
      title: photo.title || "",
      displayTitle,
      alt: photo.alt || displayTitle,
      story: photo.story || "",
      location: photo.location || "Unknown location",
      width: photo.width || 1200,
      height: photo.height || 1500,
      takenAt,
      timestamp,
      collection: photo.collection || "Archive",
      camera: photo.camera || "",
      lens: photo.lens || "",
    };
  }

  async function enrichPhoto(photo, index) {
    const [exif, dimensions] = await Promise.all([loadExifMetadata(photo), loadImageDimensions(photo)]);
    const merged = {
      ...photo,
      width: photo.width || dimensions.width || 1200,
      height: photo.height || dimensions.height || 1500,
      timestamp: photo.timestamp || exif.timestamp || "",
      takenAt: photo.takenAt || exif.takenAt || "",
      camera: photo.camera || exif.camera || "",
      lens: photo.lens || exif.lens || "",
    };

    return normalizePhoto(merged, index);
  }

  async function enrichPhotos(list) {
    return Promise.all(list.map((photo, index) => enrichPhoto(photo, index)));
  }

  function createPhotoCard(photo, index, cardClass, options = {}) {
    const ratio = `${photo.width} / ${photo.height}`;
    const isCompact = cardClass === "lane-card";
    const hideTags = Boolean(options.hideTags);
    const thumbnailCandidates = getThumbnailCandidates(photo).map((path) => withBase(path));
    const metadata = [photo.timestamp ? formatTimestamp(photo.timestamp) : photo.takenAt ? formatDate(photo.takenAt) : "", photo.camera, photo.lens]
      .filter(Boolean)
      .map((item) => `<span>${escapeHtml(item)}</span>`)
      .join("");
    const metaMarkup =
      !isCompact && !hideTags && (photo.collection || photo.location)
        ? `
            <div class="photo-meta">
              <span>${escapeHtml(photo.collection)}</span>
              <span>${escapeHtml(photo.location)}</span>
            </div>
          `
        : "";
    const titleMarkup = !isCompact && photo.displayTitle ? `<h3 class="photo-title">${escapeHtml(photo.displayTitle)}</h3>` : "";
    const storyMarkup = !isCompact && photo.story ? `<p>${escapeHtml(photo.story)}</p>` : "";
    const detailsMarkup = !isCompact && !hideTags && metadata ? `<div class="photo-details" aria-label="Photo metadata">${metadata}</div>` : "";
    const bodyMarkup = [metaMarkup, storyMarkup, detailsMarkup].filter(Boolean).join("");
    const copyMarkup =
      !isCompact && bodyMarkup
        ? `
            <div class="photo-copy">
              ${bodyMarkup}
            </div>
          `
        : "";

    return `
      <article class="${cardClass}" style="--ratio: ${ratio}" data-index="${index}" data-width="${photo.width}" data-height="${photo.height}">
        <button type="button" class="photo-trigger" data-index="${index}" aria-label="Open ${escapeHtml(photo.displayTitle)}">
          <div class="photo-frame">
            ${titleMarkup}
            <img
              src="${escapeHtml(thumbnailCandidates[0])}"
              alt="${escapeHtml(photo.alt)}"
              loading="lazy"
              decoding="async"
              fetchpriority="low"
              width="${photo.width}"
              height="${photo.height}"
              data-source-candidates="${escapeHtml(thumbnailCandidates.join("|"))}"
            />
          </div>
          ${copyMarkup}
        </button>
      </article>
    `;
  }

  function renderHeader() {
    const titleMarkup = site.title
      ? `<span class="brand-name">${escapeHtml(site.title)}</span>`
      : "";
    const quoteMarkup = site.quote
      ? `<span class="hero-quote">${escapeHtml(site.quote)}</span>`
      : "";

    headerRoot.innerHTML = `
      <div class="topbar">
        <a class="brand" href="${homeHref()}">
          <span class="hero-name">${escapeHtml(site.owner || "Personal Archive")}</span>
          ${titleMarkup}
          ${quoteMarkup}
        </a>
        <nav class="topnav" aria-label="Views">
          <a href="${homeHref()}" ${page === "home" ? 'aria-current="page"' : ""}>Wall</a>
          <a href="${pageHref("location")}" ${page === "location" ? 'aria-current="page"' : ""}>Location</a>
          <a href="${pageHref("grid-lanes")}" ${page === "grid-lanes" ? 'aria-current="page"' : ""}>Grid</a>
        </nav>
      </div>
    `;
  }

  function renderFooter() {
    if (!footerRoot) {
      return;
    }

    footerRoot.innerHTML = `
      <p class="site-footer-subtitle">${escapeHtml(site.subtitle || "")}</p>
      <p class="site-signature">© ${escapeHtml(site.owner || "Personal Archive")}</p>
    `;
  }

  function renderHero(title, description, stats, extra) {
    return `
      <section class="page-hero">
        <div>
          <p class="eyebrow">${escapeHtml(site.subtitle || "A small personal gallery")}</p>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(description)}</p>
        </div>
        <div class="hero-stats">
          <div class="stat-card">
            <strong>${stats.count}</strong>
            <span>frames in the archive</span>
          </div>
          <div class="stat-card">
            <strong>${stats.locationCount}</strong>
            <span>locations across trips and daily life</span>
          </div>
          <div class="stat-card">
            <strong>${escapeHtml(extra)}</strong>
            <span>${stats.latest ? `latest: ${escapeHtml(stats.latest.title)}` : "ready for new uploads"}</span>
          </div>
        </div>
      </section>
    `;
  }

  function renderSimpleHero(title, description) {
    return `
      <section class="page-hero">
        <div>
          <p class="eyebrow">${escapeHtml(site.subtitle || "A small personal gallery")}</p>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(description)}</p>
        </div>
      </section>
    `;
  }

  function renderHome(list) {
    const yearGroups = groupByYear(list);

    mainRoot.innerHTML = `
      <section class="year-groups">
        ${yearGroups
          .map(
            (group) => `
              <section class="year-group">
                <div class="year-group-header">
                  <h2>- ${escapeHtml(group.year)} -</h2>
                </div>
                <div class="masonry-grid">
                  ${group.items.map((photo) => createPhotoCard(photo, photo.index, "photo-card", { hideTags: true })).join("")}
                </div>
              </section>
            `
          )
          .join("")}
      </section>
    `;
  }

  function renderLocation(list) {
    const groups = groupByLocation(list);

    mainRoot.innerHTML = `
      <nav class="filter-rail" aria-label="Location shortcuts">
        <a href="#all">All locations</a>
        ${groups
          .map(
            (group) =>
              `<a href="#${group.slug}">${escapeHtml(group.name)} <span aria-hidden="true">(${group.items.length})</span></a>`
          )
          .join("")}
      </nav>
      <section class="location-groups" id="all">
        ${groups
          .map(
            (group) => `
              <article class="location-group" id="${group.slug}">
                <div class="location-group-header">
                  <div>
                    <h3>${escapeHtml(group.name)}</h3>
                    <p>${group.items.length} frame${group.items.length === 1 ? "" : "s"} across ${escapeHtml(
                      listCollections(group.items)
                    )}</p>
                  </div>
                  <p>${escapeHtml(dateRangeLabel(group.items))}</p>
                </div>
                <div class="location-grid">
                  ${group.items.map((photo) => createPhotoCard(photo, photo.index, "photo-card")).join("")}
                </div>
              </article>
            `
          )
          .join("")}
      </section>
    `;
  }

  function renderGridLanes(list) {
    mainRoot.innerHTML = `
      <section class="lane-shell">
        <section class="lanes-grid" id="lanes-grid">
          ${list.map((photo, index) => createPhotoCard(photo, index, "lane-card")).join("")}
        </section>
      </section>
    `;

    syncLaneHeights();
    window.addEventListener("resize", syncLaneHeights, { passive: true });
  }

  function listCollections(items) {
    return [...new Set(items.map((item) => item.collection))].join(", ");
  }

  function getYearLabel(item) {
    const date = toDate(getCaptureDate(item));
    return date ? String(date.getFullYear()) : "Unknown";
  }

  function groupByYear(list) {
    const grouped = new Map();

    sortByDateDescending(list).forEach((item) => {
      const year = getYearLabel(item);
      if (!grouped.has(year)) {
        grouped.set(year, []);
      }

      grouped.get(year).push(item);
    });

    return [...grouped.entries()].map(([year, items]) => ({ year, items }));
  }

  function slugify(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  function groupByLocation(list) {
    const grouped = new Map();

    sortByDateDescending(list).forEach((item, index) => {
      if (!grouped.has(item.location)) {
        grouped.set(item.location, []);
      }

      grouped.get(item.location).push({ ...item, index });
    });

    return [...grouped.entries()]
      .map(([name, items]) => ({ name, slug: slugify(name), items }))
      .sort((left, right) => right.items.length - left.items.length || left.name.localeCompare(right.name));
  }

  function dateRangeLabel(items) {
    const sorted = sortByDateDescending(items);
    const latest = sorted[0];
    const earliest = sorted[sorted.length - 1];

    if (!latest || !earliest) {
      return "No date";
    }

    if (latest.takenAt === earliest.takenAt) {
      return formatDate(getCaptureDate(latest));
    }

    return `${formatDate(getCaptureDate(earliest))} to ${formatDate(getCaptureDate(latest))}`;
  }

  function syncLaneHeights() {
    const grid = document.querySelector("#lanes-grid");

    if (!grid) {
      return;
    }

    const styles = window.getComputedStyle(grid);
    const rowSize = parseFloat(styles.getPropertyValue("grid-auto-rows"));
    const gap = parseFloat(styles.getPropertyValue("gap"));

    grid.querySelectorAll(".lane-card").forEach((card) => {
      const width = card.clientWidth;
      const imageRatio = Number(card.dataset.height) / Number(card.dataset.width);
      const mediaHeight = width * imageRatio;
      const copy = card.querySelector(".photo-copy");
      const copyHeight = copy ? copy.offsetHeight : 0;
      const totalHeight = mediaHeight + copyHeight;
      const span = Math.ceil((totalHeight + gap) / (rowSize + gap));
      card.style.gridRowEnd = `span ${Math.max(span, 1)}`;
    });
  }

  function createEmptyState() {
    mainRoot.innerHTML = `
      <section class="empty-state">
        <h1>No photos yet</h1>
        <p>Add image files to <code>/photos</code>, update <code>photos.js</code>, and refresh the page.</p>
      </section>
    `;
  }

  function setupLightbox(list) {
    const lightbox = document.createElement("aside");
    lightbox.className = "lightbox";
    lightbox.setAttribute("aria-hidden", "true");
    lightbox.innerHTML = `
      <div class="lightbox-backdrop" data-close-lightbox></div>
      <div class="lightbox-panel">
        <div class="lightbox-toolbar">
          <button type="button" data-close-lightbox>Close</button>
        </div>
        <div class="lightbox-stage">
          <div class="lightbox-nav">
            <button type="button" aria-label="Previous photo" data-lightbox-direction="-1">Prev</button>
          </div>
          <figure class="lightbox-figure">
            <img src="" alt="" />
            <figcaption></figcaption>
          </figure>
          <div class="lightbox-nav">
            <button type="button" aria-label="Next photo" data-lightbox-direction="1">Next</button>
          </div>
        </div>
      </div>
    `;

    document.body.append(lightbox);

    const image = lightbox.querySelector("img");
    const caption = lightbox.querySelector("figcaption");
    const panel = lightbox.querySelector(".lightbox-panel");
    let currentIndex = 0;

    function updateLightbox(index) {
      const safeIndex = (index + list.length) % list.length;
      const item = list[safeIndex];
      currentIndex = safeIndex;
      applyResponsiveImageSource(image, getFullImageCandidates(item).map((path) => withBase(path)));
      image.alt = item.alt;
      caption.innerHTML = `
        <strong>${escapeHtml(item.displayTitle)}</strong>
        <span>${escapeHtml(
          [
            item.location,
            item.timestamp ? formatTimestamp(item.timestamp) : item.takenAt ? formatDate(item.takenAt) : "",
            item.camera,
            item.lens,
            item.story,
          ]
            .filter(Boolean)
            .join(" · ")
        )}</span>
      `;
    }

    function openLightbox(index) {
      updateLightbox(index);
      lightbox.dataset.open = "true";
      lightbox.setAttribute("aria-hidden", "false");
      document.body.classList.add("body-locked");
    }

    function closeLightbox() {
      lightbox.dataset.open = "false";
      lightbox.setAttribute("aria-hidden", "true");
      document.body.classList.remove("body-locked");
    }

    document.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-index]");

      if (trigger && trigger.matches(".photo-trigger, .photo-card, .lane-card")) {
        openLightbox(Number(trigger.dataset.index));
        return;
      }
    });

    lightbox.addEventListener("click", (event) => {
      const closeButton = event.target.closest("[data-close-lightbox]");
      if (closeButton) {
        closeLightbox();
        return;
      }

      const navButton = event.target.closest("[data-lightbox-direction]");
      if (navButton) {
        updateLightbox(currentIndex + Number(navButton.dataset.lightboxDirection));
        return;
      }
    });

    panel.addEventListener("click", (event) => {
      const protectedContent = event.target.closest(
        ".lightbox-figure img, .lightbox-figure figcaption, .lightbox-toolbar, [data-lightbox-direction]"
      );

      if (!protectedContent) {
        closeLightbox();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (lightbox.dataset.open !== "true") {
        return;
      }

      if (event.key === "Escape") {
        closeLightbox();
      } else if (event.key === "ArrowRight") {
        updateLightbox(currentIndex + 1);
      } else if (event.key === "ArrowLeft") {
        updateLightbox(currentIndex - 1);
      }
    });
  }

  function createLoadingState() {
    mainRoot.innerHTML = `
      <section class="empty-state">
        <h1>Loading gallery</h1>
        <p>Reading photo metadata and preparing the archive.</p>
      </section>
    `;
  }

  async function init() {
    renderHeader();
    renderFooter();

    if (!photos.length) {
      createEmptyState();
      return;
    }

    createLoadingState();
    const enrichedPhotos = await enrichPhotos(photos);
    const orderedPhotos = sortByDateDescending(enrichedPhotos);
    let activePhotos = orderedPhotos;

    if (page === "location") {
      renderLocation(orderedPhotos);
    } else if (page === "grid-lanes") {
      activePhotos = shuffleList(orderedPhotos);
      renderGridLanes(activePhotos);
    } else {
      renderHome(orderedPhotos);
    }

    mainRoot.querySelectorAll("img[data-source-candidates]").forEach((image) => {
      applyResponsiveImageSource(image, (image.dataset.sourceCandidates || "").split("|").filter(Boolean));
    });
    setupLightbox(activePhotos);
  }

  init();
})();
