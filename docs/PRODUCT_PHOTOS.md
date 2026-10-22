# Product photos and presentation

Six illustrative sample photos are bundled in public/assets/demo-products for offline demo use. These are licensed photographs, not images of the exact fictional products: colours, quantities, capacities and packaging may differ. The photo for the pen set shows two writing pens; the demo offer remains a pack of three. Index cards shown are white rather than the fictional pastel pack. Images do not change product descriptions, pricing, quantities or snapshots. No photographer or depicted brand endorses CampusERP.

## Sources and permissions

Retrieved 22 October 2026. Pexels permits downloading, adapting and using photos in websites/apps; these files accompany an application demo, not a stock-photo redistribution service. Retain the sources and licensing record when sharing the repository. The index-card page links its legacy Creative Commons/CC0 license; the other five source pages identify the Pexels License.

| Local file | Demo product | Photographer / source | License |
| --- | --- | --- | --- |
| notebook.jpg | Offer 1 | [Eva Bronzini](https://www.pexels.com/photo/blank-page-of-a-notebook-7965469/) | [Pexels License](https://www.pexels.com/license/) |
| tote.jpg | Offer 2 | [Artem Podrez](https://www.pexels.com/photo/a-person-holding-a-tote-bag-6787035/) | [Pexels License](https://www.pexels.com/license/) |
| tumbler.jpg | Offer 3 | [janam thapa](https://www.pexels.com/photo/a-hand-holding-a-matte-black-tumbler-9245381/) | [Pexels License](https://www.pexels.com/license/) |
| pens.jpg | Offer 4 | [Pragyan Bezbaruah](https://www.pexels.com/photo/pen-on-black-surface-1758886/) | [Pexels License](https://www.pexels.com/license/) |
| planner.jpg | Offer 5 | [Tara Winstead](https://www.pexels.com/photo/close-up-shot-of-weekly-planner-6690930/) | [Pexels License](https://www.pexels.com/license/) |
| cards.jpg | Offer 6 | [Pixabay (Pexels contributor)](https://www.pexels.com/photo/white-ruled-paper-lot-on-brown-wooden-surface-268351/) | [CC0 (linked license on source photo page)](https://www.pexels.com/creative-commons-images/) |

Machine-readable source URLs, original download URLs, retrieved date, changes and SHA-256 hashes are recorded in [SOURCES.json](../public/assets/demo-products/SOURCES.json). Downloads use 640px width and compression without cropping. The full image is displayed with object-fit: contain.

## Catalogue boundary

public/product-images.mjs owns URL validation, reference resolution, markup, alt text, and the image-error fallback for selection, selected items, review and order details. A Catalogue-provided image_url takes precedence, followed by image_reference. Root-relative image URLs and HTTPS URLs are accepted; script/data URLs, protocol-relative URLs, credentials and backslashes are rejected. An opaque reference can be translated by supplying resolveReference to the adapter. An integration can provide image_alt for an accurate description. Images use no-referrer requests.

Only an explicit demo flag enables the offer-to-sample map in public/demo-products.mjs. Live mode never assigns sample photos by matching IDs or names. Missing or failed images show a neutral square No photo fallback with an accessible product-specific label. Detail pages optionally load current offer metadata; a failed Catalogue read does not prevent viewing the order. Submitted text/price/recipient snapshots remain unchanged; photos are current presentation metadata, not guaranteed immutable image snapshots.

The current Catalogue SQL schema has no agreed image field. No shared table, migration, upload screen, order payload or integration message was changed. When the Catalogue team provides URLs/references, their adapter must expose image_url/image_reference (and optional image_alt) in offer metadata or order-item presentation data. The HTTP content-security policy permits HTTPS images for this future use. Opaque reference translation, remote host restrictions if required by deployment, and the actual partner contract remain integration work. All bundled demo thumbnails work with external image services unavailable.

## Styling and verification

Pale sage page background, white cards, compact dark-green page banners with white headings, light sage section headings, stronger table headers/dividers, and subtle shadows preserve the existing workflow. Thumbnails remain square and visible at desktop, 390px and 320px widths.

Verification uses npm.cmd test, node tests/browser-qa.mjs, node tests/browser-accounts.mjs, and node tests/browser-photos.mjs. Photo-specific browser checks cover both sellers/all six local files, all four required views, image loading, contain sizing, missing/broken-image fallbacks and desktop/mobile overflow. Screenshots are stored in ignored data/screenshots/ui-photos-*.png.
