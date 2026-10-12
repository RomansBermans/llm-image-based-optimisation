# llm-image-based-optimisation

Local MVP for discovering ecommerce products, creating AI image variants, approving them, and serving approved images through a small storefront script. It does not include personalisation, analytics, billing, or automatic optimisation.

## Run locally

Requires Node.js 22+ and an OpenAI API key with image-editing access.

```sh
npm install
cp .env.example .env
# Set OPENAI_API_KEY in .env
npm run dev
```

Open `http://localhost:3000`. SQLite data defaults to `data/visual-merchandising.db`; original and generated images default to `data/images`. Change these with `DATABASE_PATH` and `IMAGE_STORAGE_PATH`.

`OPENAI_API_KEY` stays on the server. Discovery works without it, but generation does not. The OpenAI image provider lives in `src/image-generator.ts`.

## Workflow

1. Enter a public store homepage and select **Process**. The app discovers up to five products, or shows why it could not process the site.
2. Generate as many variants as needed for each product, then compare each with the original.
3. Approve or reject individual variants. Pending and rejected images are never public. If a product has several approved variants, the storefront chooses one at random on every page load.
4. The **Inspected stores** list retains the submitted URLs. Products, prompts, images, and approval states persist across restarts.
5. Copy the script tag for an installed storefront, or use the dashboard's console one-liner for a temporary browser test.

Generative output can alter product details. Human approval is required before publication.

## Storefront snippet

Add the dashboard-provided tag before `</body>`:

```html
<script async src="http://localhost:3000/visual-merchandising.js" data-avm-store="PUBLIC_TOKEN"></script>
```

It calls `GET /api/public/stores/:token/variants`, which returns only approved variants. It replaces a matching image, handles newly inserted images, and leaves all originals alone if the mapping is missing or the request fails.

For a public HTTPS storefront, use a temporary [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/):

```sh
cloudflared tunnel --url http://localhost:3000
```

Set `APP_BASE_URL` to the printed `https://…trycloudflare.com` URL, restart the app, and copy the newly generated snippet. Quick Tunnels are free and do not need an account, but are temporary. Anyone with that URL can open this unauthenticated local MVP, so use it only for a short test.

Matching uses the original image URL. Shopify image URLs also ignore protocol and the `width` resize parameter. Other transformed CDN URLs, `data-src`, and CSS background images are deliberately not matched.

## Boundaries

Discovery supports public HTML only. JavaScript-only catalogues, login walls, CAPTCHAs, bot protection, and unsupported markup return an error rather than made-up products. Fetches allow HTTP(S) only, reject localhost and private network addresses, recheck redirects, time out after 12 seconds, and limit HTML to 2 MB and images to 15 MB.

## Checks

```sh
npm run build
npm test
```

The test confirms that every approved variant is public and pending or rejected variants are not.
