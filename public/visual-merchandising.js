(() => {
  const script = document.currentScript;
  const token = script && script.dataset.avmStore;
  if (!token) return;
  const baseUrl = new URL(script.src, document.baseURI).origin;
  const normalise = value => {
    try {
      const url = new URL(value, document.baseURI);
      url.hash = "";
      if (url.pathname.includes("/cdn/shop/files/")) url.searchParams.delete("width");
      return `${url.host.toLowerCase()}${url.pathname}${url.search}`;
    } catch { return null; }
  };
  fetch(`${baseUrl}/api/public/stores/${encodeURIComponent(token)}/variants`)
    .then(response => response.ok ? response.json() : Promise.reject())
    .then(data => {
      const replacements = new Map(data.variants.map(item => [normalise(item.originalImageUrl), item.variantImageUrls]));
      const replace = image => {
        if (!(image instanceof HTMLImageElement) || image.dataset.avmReplaced === "1") return;
        const original = normalise(image.currentSrc || image.src);
        const variants = original && replacements.get(original);
        if (!variants?.length) return;
        const replacement = variants[Math.floor(Math.random() * variants.length)];
        image.dataset.avmReplaced = "1"; image.dataset.avmOriginal = original; image.removeAttribute("srcset"); image.src = replacement;
      };
      const scan = root => { if (root instanceof HTMLImageElement) replace(root); root.querySelectorAll?.("img").forEach(replace); };
      scan(document); new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(scan))).observe(document.documentElement, { childList: true, subtree: true });
    })
    .catch(() => { /* A failed lookup intentionally leaves every storefront image alone. */ });
})();
