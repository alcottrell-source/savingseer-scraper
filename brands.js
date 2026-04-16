/**
 * Savingseer — 71 brands
 * Built from brand master data + centre presence matrix.
 *
 * renderMode: 'browser' = known JS-rendered SPA, skip Cheerio entirely
 * selectors: CSS hints that confirm an active sale (supplement the generic heuristic)
 *
 * Sale URL strategy:
 *   - Use the dedicated /sale page where one exists (faster, denser signals)
 *   - Fall back to homepage where no sale page exists (detection via banner heuristic)
 *   - Brands with no known /sale page and no sale history are homepage-only;
 *     the scraper will detect opportunistic sale banners if they appear
 */

export const BRANDS = [

  // ── High Street Value ────────────────────────────────────────────────────

  {
    id: 'B001',
    name: 'Marks & Spencer',
    url: 'https://www.marksandspencer.com/l/sale',
    selectors: ['.sale-badge', '[class*="offer-badge"]'],
  },
  {
    id: 'B002',
    name: 'Next',
    // No static /sale page — Next renders sale via JS filters
    url: 'https://www.next.co.uk/shop/gender-women-productaffiliation-sale',
    selectors: ['[data-testid*="sale"]', '.sale-header'],
    renderMode: 'browser',
  },
  {
    id: 'B003',
    name: 'H&M',
    url: 'https://www2.hm.com/en_gb/sale.html',
    selectors: ['.sale-badge', '[class*="sale-header"]'],
    renderMode: 'browser',
  },
  {
    id: 'B004',
    name: 'Primark',
    // Primark has no e-commerce; homepage is the only signal source
    url: 'https://www.primark.com/en-gb',
    selectors: ['[class*="sale"]', '[class*="promo"]', '[class*="offer"]'],
    renderMode: 'browser',
  },
  {
    id: 'B005',
    name: 'River Island',
    url: 'https://www.riverisland.com/sale',
    selectors: ['[class*="sale-badge"]', '[class*="promo-banner"]'],
    renderMode: 'browser',
  },
  {
    id: 'B006',
    name: 'New Look',
    url: 'https://www.newlook.com/uk/womens/sale',
    selectors: ['.sale-badge', '[class*="promo"]'],
  },
  {
    id: 'B007',
    name: 'Dorothy Perkins',
    url: 'https://www.dorothyperkins.com/sale',
    selectors: ['[class*="sale"]', '[class*="promo"]'],
    renderMode: 'browser',
  },
  {
    id: 'B008',
    name: 'Burton',
    url: 'https://www.burton.co.uk/sale',
    selectors: ['[class*="sale"]', '[class*="promo"]'],
    renderMode: 'browser',
  },
  {
    id: 'B009',
    name: 'Wallis',
    url: 'https://www.wallis.co.uk/sale',
    selectors: ['[class*="sale"]'],
  },
  {
    id: 'B010',
    name: 'Oasis',
    url: 'https://www.oasis-stores.com/sale',
    selectors: ['[class*="sale"]', '[class*="promo"]'],
    renderMode: 'browser',
  },
  {
    id: 'B011',
    name: 'Warehouse',
    url: 'https://www.warehouse.co.uk/sale',
    selectors: ['[class*="sale"]', '[class*="promo"]'],
    renderMode: 'browser',
  },
  {
    id: 'B012',
    name: 'Miss Selfridge',
    url: 'https://www.missselfridge.com/sale',
    selectors: ['[class*="sale"]'],
    renderMode: 'browser',
  },

  // ── Contemporary ─────────────────────────────────────────────────────────

  {
    id: 'B013',
    name: 'Zara',
    url: 'https://www.zara.com/gb/en/sale.html',
    selectors: ['[class*="sale"]', '[data-testid*="sale"]'],
    renderMode: 'browser',
  },
  {
    id: 'B014',
    name: 'Mango',
    url: 'https://shop.mango.com/gb/women/outlet_c14584823',
    selectors: ['[class*="sale"]', '[class*="outlet"]'],
    renderMode: 'browser',
  },
  {
    id: 'B015',
    name: '& Other Stories',
    url: 'https://www.stories.com/en_gbp/sale.html',
    selectors: ['[class*="sale"]'],
    renderMode: 'browser',
  },
  {
    id: 'B016',
    name: 'COS',
    url: 'https://www.cos.com/en_gbp/sale.html',
    selectors: ['[class*="sale"]'],
    renderMode: 'browser',
  },
  {
    id: 'B017',
    name: 'Arket',
    url: 'https://www.arket.com/en_gbp/sale.html',
    selectors: ['[class*="sale"]'],
    renderMode: 'browser',
  },
  {
    id: 'B018',
    name: 'Hollister',
    // Runs permanent "sale" section — signal is active event banners, not a /sale page
    url: 'https://www.hollisterco.com/shop/uk',
    selectors: ['[class*="sale-event"]', '[class*="promo-banner"]', '[class*="global-promo"]'],
    renderMode: 'browser',
  },
  {
    id: 'B019',
    name: 'Abercrombie & Fitch',
    url: 'https://www.abercrombie.com/shop/uk/sale',
    selectors: ['[class*="sale"]', '[class*="promo"]'],
    renderMode: 'browser',
  },
  {
    id: 'B020',
    name: 'White Stuff',
    url: 'https://www.whitestuff.com/sale',
    selectors: ['.sale-banner', '[class*="sale-header"]'],
  },
  {
    id: 'B021',
    name: 'Superdry',
    url: 'https://www.superdry.com/sale',
    selectors: ['[class*="sale-badge"]', '[class*="sale-banner"]'],
  },
  {
    id: 'B022',
    name: 'Jack & Jones',
    url: 'https://www.jackjones.com/gb/en/sale',
    selectors: ['[class*="sale"]'],
    renderMode: 'browser',
  },
  {
    id: 'B023',
    name: 'Uniqlo',
    url: 'https://www.uniqlo.com/uk/en/sale',
    selectors: ['[class*="sale"]', '[class*="special-offer"]'],
    renderMode: 'browser',
  },
  {
    id: 'B024',
    name: 'Boden',
    url: 'https://www.boden.co.uk/en-gb/sale',
    selectors: ['.sale-badge', '[class*="sale-header"]'],
  },

  // ── Classic British ───────────────────────────────────────────────────────

  {
    id: 'B025',
    name: 'Fat Face',
    url: 'https://www.fatface.com/women/sale/',
    selectors: ['[class*="sale"]', '[class*="promo"]'],
  },
  {
    id: 'B026',
    name: 'The White Company',
    url: 'https://www.thewhitecompany.com/uk/sale',
    selectors: ['[class*="sale"]'],
  },
  {
    id: 'B027',
    name: 'Joules',
    url: 'https://www.joules.com/collections/sale',
    selectors: ['[class*="sale"]'],
    renderMode: 'browser',
  },
  {
    id: 'B028',
    name: 'Barbour',
    url: 'https://www.barbour.com/uk/sale',
    selectors: ['[class*="sale"]', '[class*="promo"]'],
  },
  {
    id: 'B029',
    name: 'Seasalt Cornwall',
    url: 'https://www.seasaltcornwall.co.uk/sale',
    selectors: ['[class*="sale"]', '.promo-banner'],
  },
  {
    id: 'B030',
    name: 'Crew Clothing',
    url: 'https://www.crewclothing.co.uk/sale',
    selectors: ['[class*="sale"]'],
  },
  {
    id: 'B031',
    name: 'Jack Wills',
    url: 'https://www.jackwills.com/collections/sale',
    selectors: ['[class*="sale"]'],
    renderMode: 'browser',
  },
  {
    id: 'B032',
    name: 'Bravissimo',
    url: 'https://www.bravissimo.com/sale',
    selectors: ['[class*="sale"]'],
  },

  // ── Smart / Occasion ──────────────────────────────────────────────────────

  {
    id: 'B033',
    name: 'Reiss',
    url: 'https://www.reiss.com/gb/sale',
    selectors: ['[class*="sale"]', '[class*="markdown"]'],
    renderMode: 'browser',
  },
  {
    id: 'B034',
    name: 'Ted Baker',
    url: 'https://www.tedbaker.com/uk/sale',
    selectors: ['[class*="sale"]'],
    renderMode: 'browser',
  },
  {
    id: 'B035',
    name: 'Phase Eight',
    url: 'https://www.phase-eight.com/sale',
    selectors: ['[class*="sale"]', '[class*="promo"]'],
  },
  {
    id: 'B036',
    name: 'Hobbs',
    url: 'https://www.hobbs.co.uk/sale',
    selectors: ['[class*="sale"]'],
  },
  {
    id: 'B037',
    name: 'LK Bennett',
    url: 'https://www.lkbennett.com/sale',
    selectors: ['[class*="sale"]', '[class*="promo"]'],
  },
  {
    id: 'B038',
    name: 'Karen Millen',
    url: 'https://www.karenmillen.com/gb/womens/sale/',
    selectors: ['[class*="sale"]'],
    renderMode: 'browser',
  },
  {
    id: 'B039',
    name: 'French Connection',
    url: 'https://www.frenchconnection.com/sale',
    selectors: ['[class*="sale"]', '[class*="promo"]'],
  },
  {
    id: 'B040',
    name: 'Jigsaw',
    url: 'https://www.jigsaw-online.com/sale',
    selectors: ['[class*="sale"]'],
    renderMode: 'browser',
  },
  {
    id: 'B041',
    name: 'Jaeger',
    url: 'https://www.jaeger.co.uk/sale',
    selectors: ['[class*="sale"]'],
  },
  {
    id: 'B042',
    name: 'Mint Velvet',
    url: 'https://www.mintvelvet.co.uk/sale',
    selectors: ['[class*="sale"]', '[class*="promo"]'],
  },
  {
    id: 'B043',
    name: 'Whistles',
    url: 'https://www.whistles.com/sale',
    selectors: ['[class*="sale"]'],
  },

  // ── Premium Casual ────────────────────────────────────────────────────────

  {
    id: 'B044',
    name: 'Polo Ralph Lauren',
    url: 'https://www.ralphlauren.co.uk/sale',
    selectors: ['[class*="sale"]', '[class*="promo"]'],
    renderMode: 'browser',
  },
  {
    id: 'B045',
    name: 'Tommy Hilfiger',
    // No persistent UK /sale page — sale events appear as homepage banners
    url: 'https://uk.tommy.com',
    selectors: ['[class*="sale"]', '[class*="promo-bar"]', '[class*="banner"]'],
    renderMode: 'browser',
  },
  {
    id: 'B046',
    name: 'Hugo Boss',
    url: 'https://www.hugoboss.com/uk/sale',
    selectors: ['[class*="sale"]', '[class*="promo"]'],
    renderMode: 'browser',
  },
  {
    id: 'B047',
    name: 'Gant',
    url: 'https://www.gant.co.uk/sale',
    selectors: ['[class*="sale"]'],
  },
  {
    id: 'B048',
    name: 'Hackett London',
    url: 'https://www.hackett.com/gb/sale',
    selectors: ['[class*="sale"]'],
  },
  {
    id: 'B049',
    name: 'Calvin Klein',
    // CK runs flash sales via homepage banner — no persistent /sale page
    url: 'https://www.calvinklein.co.uk',
    selectors: ['[class*="sale"]', '[class*="promo-banner"]', '[class*="offer"]'],
    renderMode: 'browser',
  },
  {
    id: 'B050',
    name: 'Lacoste',
    url: 'https://www.lacoste.com/gb/sale',
    selectors: ['[class*="sale"]', '[class*="outlet"]'],
    renderMode: 'browser',
  },
  {
    id: 'B051',
    name: 'FLANNELS',
    url: 'https://www.flannels.com/sale',
    selectors: ['[class*="sale"]'],
    renderMode: 'browser',
  },
  {
    id: 'B052',
    name: 'AllSaints',
    url: 'https://www.allsaints.com/sale',
    selectors: ['[class*="sale"]', '[class*="markdown"]'],
    renderMode: 'browser',
  },

  // ── Outdoorsy / Active ────────────────────────────────────────────────────

  {
    id: 'B053',
    name: 'Nike',
    url: 'https://www.nike.com/gb/w/sale-3yaep',
    selectors: ['[class*="sale"]', '[data-testid*="sale"]'],
    renderMode: 'browser',
  },
  {
    id: 'B054',
    name: 'Adidas',
    // No persistent /sale — sale events surface as homepage banners
    url: 'https://www.adidas.co.uk',
    selectors: ['[class*="sale"]', '[class*="promo"]', '[class*="campaign-header"]'],
    renderMode: 'browser',
  },
  {
    id: 'B055',
    name: 'The North Face',
    url: 'https://www.thenorthface.co.uk/en-gb/sale',
    selectors: ['[class*="sale"]'],
    renderMode: 'browser',
  },
  {
    id: 'B056',
    name: 'Sweaty Betty',
    url: 'https://www.sweatybetty.com/sale',
    selectors: ['[class*="sale"]', '[class*="promo"]'],
    renderMode: 'browser',
  },
  {
    id: 'B057',
    name: 'Lululemon',
    url: 'https://www.lululemon.co.uk/sale',
    selectors: ['[class*="sale"]', '[class*="we-made-too-much"]'],
    renderMode: 'browser',
  },
  {
    id: 'B058',
    name: 'Regatta',
    url: 'https://www.regatta.com/sale',
    selectors: ['[class*="sale"]', '[class*="promo"]'],
  },
  {
    id: 'B059',
    name: 'Berghaus',
    url: 'https://www.berghaus.com/sale',
    selectors: ['[class*="sale"]'],
  },
  {
    id: 'B060',
    name: 'Columbia',
    url: 'https://www.columbia.com/gb/en/sale',
    selectors: ['[class*="sale"]'],
    renderMode: 'browser',
  },

  // ── Footwear ──────────────────────────────────────────────────────────────

  {
    id: 'B061',
    name: 'Schuh',
    url: 'https://www.schuh.co.uk/sale/',
    selectors: ['[class*="sale"]', '.sale-banner'],
  },
  {
    id: 'B062',
    name: 'Clarks',
    url: 'https://www.clarks.co.uk/sale',
    selectors: ['[class*="sale"]'],
  },
  {
    id: 'B063',
    name: 'Dune London',
    url: 'https://www.dunelondon.com/sale',
    selectors: ['[class*="sale"]'],
  },
  {
    id: 'B064',
    name: 'Office',
    url: 'https://www.office.co.uk/sale',
    selectors: ['[class*="sale"]', '[class*="promo"]'],
  },
  {
    id: 'B065',
    name: 'Kurt Geiger',
    url: 'https://www.kurtgeiger.com/sale',
    selectors: ['[class*="sale"]'],
    renderMode: 'browser',
  },
  {
    id: 'B066',
    name: 'Foot Locker',
    url: 'https://www.footlocker.co.uk/en/category/sale/',
    selectors: ['[class*="sale"]', '[class*="promo"]'],
    renderMode: 'browser',
  },

  // ── Accessories ───────────────────────────────────────────────────────────

  {
    id: 'B067',
    name: 'Accessorize',
    url: 'https://uk.accessorize.com/view/category/sale',
    selectors: ['[class*="sale"]'],
  },
  {
    id: 'B068',
    name: 'Boux Avenue',
    url: 'https://www.bouxavenue.com/collections/sale',
    selectors: ['[class*="sale"]'],
    renderMode: 'browser',
  },
  {
    id: 'B069',
    name: 'Ann Summers',
    url: 'https://www.annsummers.com/sale',
    selectors: ['[class*="sale"]', '[class*="promo"]'],
  },
  {
    id: 'B070',
    name: 'Pandora',
    url: 'https://uk.pandora.net/en/sale',
    selectors: ['[class*="sale"]', '[class*="promotion"]'],
    renderMode: 'browser',
  },
  {
    id: 'B071',
    name: 'Swarovski',
    url: 'https://www.swarovski.com/en-gb/sale',
    selectors: ['[class*="sale"]'],
    renderMode: 'browser',
  },

  // ── Additional brands (commonly found across the 30 centres) ─────────────

  {
    id: 'B072',
    name: 'Monsoon',
    url: 'https://www.monsoon.co.uk/sale',
    selectors: ['[class*="sale"]', '[class*="promo"]'],
  },
  {
    id: 'B073',
    name: "Levi's",
    url: 'https://www.levi.com/GB/en_GB/sale',
    selectors: ['[class*="sale"]', '[class*="promo"]'],
    renderMode: 'browser',
  },
  {
    id: 'B074',
    name: 'Skechers',
    url: 'https://www.skechers.com/en-gb/sale/',
    selectors: ['[class*="sale"]', '[class*="clearance"]'],
  },
  {
    id: 'B075',
    name: 'Timberland',
    url: 'https://www.timberland.co.uk/en-gb/sale',
    selectors: ['[class*="sale"]'],
    renderMode: 'browser',
  },
  {
    id: 'B076',
    name: 'Flying Tiger Copenhagen',
    // No e-commerce sale page — homepage banner is the only signal
    url: 'https://flyingtiger.com/en-gb',
    selectors: ['[class*="sale"]', '[class*="promo"]', '[class*="offer"]'],
  },
];
