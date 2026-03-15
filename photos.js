window.GALLERY_SITE = {
  title: "Collect moments, not things",
  quote: "Having it for one day is better than never finding it at all.",
  subtitle: "Personal photo archive",
  owner: "HANC.L 瀚",
};

// For JPEG files, timestamp/camera/lens can be read from EXIF automatically.
// Width and height can also be detected automatically at runtime.
// By default the gallery will try `-800` thumbnails and `-2048` full images.
// Keep explicit metadata here only when you want to override the defaults.
window.GALLERY_PHOTOS = [
  {
    src: "photos/mt_rainier.jpeg",
    title: "Skyline Loop",
    location: "Mount Rainier, Washington",
    collection: "Hiking",
  },
  {
    src: "photos/P1000114.jpeg",
    title: "轮渡",
    location: "Edmonds, Washington",
  },
];
