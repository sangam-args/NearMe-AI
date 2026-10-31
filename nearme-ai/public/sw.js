self.addEventListener("install", (event) => {
  self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  // यह ऐप को ऑफलाइन काम करने योग्य बनाता है (बेसिक लेवल)
});