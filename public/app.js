const defaultPrompt = "Keep the product identical to the original, including its colour, cut, fabric, pattern, buttons, and other distinguishing details. Change the person wearing it and the surrounding environment to create a realistic ecommerce photograph. Do not add text, logos, or watermarks.";
const form = document.querySelector("#discovery-form");
const urlInput = document.querySelector("#store-url");
const processButton = document.querySelector("#process-button");
const discoveryMessage = document.querySelector("#discovery-message");
const dashboard = document.querySelector("#dashboard");
const productsElement = document.querySelector("#products");
const template = document.querySelector("#product-template");
const storeList = document.querySelector("#store-list");
let currentStore = null;

async function request(url, options) {
  const response = await fetch(url, { headers: { "content-type": "application/json" }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The request failed.");
  return data;
}
function setMessage(element, text, okay = false) { element.textContent = text; element.classList.toggle("ok", okay); }
function variantStatus(variants) {
  if (!variants.length) return "No variants generated yet";
  const approved = variants.filter(variant => variant.status === "approved").length;
  return `${variants.length} variant${variants.length === 1 ? "" : "s"} generated${approved ? `, ${approved} approved. One approved variant is selected at random on each page load.` : ""}`;
}

async function refreshDashboard() { render(await request(`/api/stores/${encodeURIComponent(currentStore.id)}`)); }
function renderStores(stores) {
  storeList.replaceChildren();
  if (!stores.length) { storeList.innerHTML = "<li class=\"quiet\">No stores inspected yet.</li>"; return; }
  stores.forEach(store => {
    const item = document.createElement("li");
    if (store.submittedUrl) {
      const link = document.createElement("a"); link.href = store.submittedUrl; link.target = "_blank"; link.rel = "noreferrer"; link.textContent = store.submittedUrl;
      item.append(link);
    } else item.textContent = store.domain;
    storeList.append(item);
  });
}
async function refreshStores() { try { renderStores((await request("/api/stores")).stores); } catch { /* Store history is non-essential. */ } }

function render(data) {
  currentStore = data.store;
  localStorage.setItem("avm-store-id", data.store.id);
  dashboard.hidden = false;
  document.querySelector("#store-domain").textContent = data.store.domain;
  document.querySelector("#product-count").textContent = `${data.products.length} product${data.products.length === 1 ? "" : "s"} discovered`;
  document.querySelector("#snippet").textContent = data.snippet;
  document.querySelector("#console-snippet").textContent = data.consoleSnippet;
  productsElement.replaceChildren();
  data.products.forEach(product => productsElement.append(productCard(product)));
}
function productCard(product) {
  const fragment = template.content.cloneNode(true); const card = fragment.querySelector("article");
  const title = card.querySelector("h3"); const link = card.querySelector(".product-link"); const original = card.querySelector(".original-image");
  const gallery = card.querySelector(".variant-gallery"); const status = card.querySelector(".status");
  const prompt = card.querySelector("textarea"); const generate = card.querySelector(".generate"); const message = card.querySelector(".card-message");
  title.textContent = product.title; link.href = product.canonicalUrl; original.src = product.localImagePath || product.originalImageUrl; original.referrerPolicy = "no-referrer";
  prompt.value = product.variants[0]?.prompt || defaultPrompt; status.innerHTML = `<strong>${variantStatus(product.variants)}</strong>`;
  product.variants.forEach((variant, index) => gallery.append(variantCard(variant, index)));
  generate.addEventListener("click", async () => {
    const value = prompt.value.trim(); if (!value) return setMessage(message, "Enter an image prompt.");
    generate.disabled = true; prompt.disabled = true; setMessage(message, "Generating image. This can take up to two minutes.", true);
    try {
      await request(`/api/products/${encodeURIComponent(product.id)}/variants`, { method: "POST", body: JSON.stringify({ prompt: value }) });
      await refreshDashboard();
    } catch (error) { setMessage(message, error.message); } finally { generate.disabled = false; prompt.disabled = false; }
  });
  return fragment;
}
function variantCard(variant, index) {
  const figure = document.createElement("figure"); const image = document.createElement("img"); const caption = document.createElement("figcaption");
  image.src = variant.generatedImagePath; image.alt = `Generated product variant ${index + 1}`; caption.textContent = `Variant ${index + 1}: ${variant.status}`;
  figure.append(image, caption);
  if (variant.status === "pending") {
    const actions = document.createElement("div"); actions.className = "variant-actions";
    const approve = document.createElement("button"); approve.className = "secondary"; approve.textContent = "Approve";
    const reject = document.createElement("button"); reject.className = "danger"; reject.textContent = "Reject";
    const decide = async decision => {
      approve.disabled = true; reject.disabled = true;
      try { await request(`/api/variants/${encodeURIComponent(variant.id)}/status`, { method: "POST", body: JSON.stringify({ status: decision }) }); await refreshDashboard(); }
      catch (error) { approve.disabled = false; reject.disabled = false; }
    };
    approve.addEventListener("click", () => decide("approved")); reject.addEventListener("click", () => decide("rejected")); actions.append(approve, reject); figure.append(actions);
  }
  return figure;
}
form.addEventListener("submit", async event => {
  event.preventDefault(); processButton.disabled = true; urlInput.disabled = true; setMessage(discoveryMessage, "Processing storefront and looking for up to five products…", true);
  try { render(await request("/api/discover", { method: "POST", body: JSON.stringify({ storeUrl: urlInput.value }) })); await refreshStores(); setMessage(discoveryMessage, "Products discovered.", true); }
  catch (error) { setMessage(discoveryMessage, error.message); } finally { processButton.disabled = false; urlInput.disabled = false; }
});
async function copySnippet(selector, label) {
  try { await navigator.clipboard.writeText(document.querySelector(selector).textContent); setMessage(document.querySelector("#copy-message"), `${label} copied.`, true); }
  catch { setMessage(document.querySelector("#copy-message"), "Copy failed. Select the snippet and copy it manually."); }
}
document.querySelector("#copy-snippet").addEventListener("click", () => copySnippet("#snippet", "Snippet"));
document.querySelector("#copy-console-snippet").addEventListener("click", () => copySnippet("#console-snippet", "Console one-liner"));
(async () => { await refreshStores(); const storeId = localStorage.getItem("avm-store-id"); if (!storeId) return; try { render(await request(`/api/stores/${encodeURIComponent(storeId)}`)); } catch { localStorage.removeItem("avm-store-id"); } })();
