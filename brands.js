// brands.js
// 75 brand configurations for Savingseer scraper
// renderMode: 'static' = CheerioCrawler (fast), 'browser' = PlaywrightCrawler (JS-heavy)
// saleSelectors: CSS selectors that confirm an active sale exists on the page

export const brands = [
  // ── HIGH STREET VALUE ──────────────────────────────────────────
  {
    id: 'B001', name: 'Next', renderMode: 'static',
    url: 'https://www.next.co.uk/sale',
    saleSelectors: ['.sale', '[data-testid="sale"]', 'h1'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B002', name: 'M&S', renderMode: 'static',
    url: 'https://www.marksandspencer.com/l/sale',
    saleSelectors: ['h1', '.page-title', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B003', name: 'River Island', renderMode: 'static',
    url: 'https://www.riverisland.com/sale',
    saleSelectors: ['h1', '[class*="sale"]', '[class*="promotion"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B004', name: 'New Look', renderMode: 'static',
    url: 'https://www.newlook.com/uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B005', name: 'Dorothy Perkins', renderMode: 'static',
    url: 'https://www.dorothyperkins.com/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B006', name: 'Wallis', renderMode: 'static',
    url: 'https://www.wallis.co.uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B007', name: 'Evans', renderMode: 'static',
    url: 'https://www.evans.co.uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B008', name: 'Bonmarche', renderMode: 'static',
    url: 'https://www.bonmarche.co.uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B009', name: 'Peacocks', renderMode: 'static',
    url: 'https://www.peacocks.co.uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },


  // ── CONTEMPORARY ───────────────────────────────────────────────
  {
    id: 'B011', name: 'Zara', renderMode: 'browser',
    url: 'https://www.zara.com/uk/en/sale-l1141.html',
    saleSelectors: ['h1', '[class*="sale"]', '[data-qa-label]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B012', name: 'H&M', renderMode: 'browser',
    url: 'https://www2.hm.com/en_gb/sale.html',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B013', name: 'Mango', renderMode: 'browser',
    url: 'https://shop.mango.com/gb/women/outlet',
    saleSelectors: ['h1', '[class*="outlet"]', '[class*="sale"]'],
    confirmText: ['outlet', 'sale', 'up to', '% off'],
  },
  {
    id: 'B014', name: 'COS', renderMode: 'browser',
    url: 'https://www.cos.com/en_gbp/sale.html',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B015', name: 'Arket', renderMode: 'browser',
    url: 'https://www.arket.com/en_gbp/sale.html',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B016', name: '& Other Stories', renderMode: 'browser',
    url: 'https://www.stories.com/en_gbp/sale.html',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B017', name: 'Weekday', renderMode: 'browser',
    url: 'https://www.weekday.com/en_gbp/sale.html',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B018', name: 'Monki', renderMode: 'browser',
    url: 'https://www.monki.com/en_gbp/sale.html',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B019', name: 'Hollister', renderMode: 'browser',
    url: 'https://www.hollisterco.com/shop/uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B020', name: 'Abercrombie', renderMode: 'browser',
    url: 'https://www.abercrombie.com/shop/uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },

  // ── CLASSIC BRITISH ────────────────────────────────────────────
  {
    id: 'B021', name: 'Fat Face', renderMode: 'static',
    url: 'https://www.fatface.com/sale',
    saleSelectors: ['h1', '[class*="sale"]', '[class*="promo"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B022', name: 'Joules', renderMode: 'static',
    url: 'https://www.joules.com/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B023', name: 'White Stuff', renderMode: 'static',
    url: 'https://www.whitestuff.com/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B024', name: 'Seasalt Cornwall', renderMode: 'static',
    url: 'https://www.seasaltcornwall.co.uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B025', name: 'Crew Clothing', renderMode: 'static',
    url: 'https://www.crewclothing.co.uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B026', name: 'Boden', renderMode: 'static',
    url: 'https://www.boden.co.uk/en-gb/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B027', name: 'Hobbs', renderMode: 'static',
    url: 'https://www.hobbs.co.uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B028', name: 'The White Company', renderMode: 'static',
    url: 'https://www.thewhitecompany.com/uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B029', name: 'Barbour', renderMode: 'static',
    url: 'https://www.barbour.com/uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B030', name: 'Cath Kidston', renderMode: 'static',
    url: 'https://www.cathkidston.com/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },

  // ── SMART/OCCASION ─────────────────────────────────────────────
  {
    id: 'B031', name: 'Phase Eight', renderMode: 'static',
    url: 'https://www.phase-eight.com/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B032', name: 'Whistles', renderMode: 'static',
    url: 'https://www.whistles.com/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B033', name: 'Reiss', renderMode: 'static',
    url: 'https://www.reiss.com/gb/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B034', name: 'Ted Baker', renderMode: 'static',
    url: 'https://www.tedbaker.com/uk/Sale',
    saleSelectors: ['h1', '[class*="sale"]', '[class*="Sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B035', name: 'Karen Millen', renderMode: 'static',
    url: 'https://www.karenmillen.com/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B036', name: 'Coast', renderMode: 'static',
    url: 'https://www.coast-stores.com/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B037', name: 'Monsoon', renderMode: 'static',
    url: 'https://www.monsoon.co.uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B038', name: 'Accessorize', renderMode: 'static',
    url: 'https://www.accessorize.com/uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B039', name: 'Oasis', renderMode: 'static',
    url: 'https://www.oasis-stores.com/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B040', name: 'Warehouse', renderMode: 'static',
    url: 'https://www.warehouse.co.uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },

  // ── PREMIUM CASUAL ─────────────────────────────────────────────
  {
    id: 'B041', name: 'Sweaty Betty', renderMode: 'static',
    url: 'https://www.sweatybetty.com/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B042', name: 'Lululemon', renderMode: 'browser',
    url: 'https://www.lululemon.co.uk/en-gb/c/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B043', name: 'Superdry', renderMode: 'static',
    url: 'https://www.superdry.com/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B044', name: 'Jack Wills', renderMode: 'static',
    url: 'https://www.jackwills.com/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B045', name: 'Hackett', renderMode: 'static',
    url: 'https://www.hackett.com/gb/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B046', name: 'Ralph Lauren', renderMode: 'browser',
    url: 'https://www.ralphlauren.co.uk/en/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B047', name: 'Tommy Hilfiger', renderMode: 'static',
    url: 'https://uk.tommy.com/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B048', name: 'Lacoste', renderMode: 'browser',
    url: 'https://www.lacoste.com/gb/sale/',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B049', name: 'Hugo Boss', renderMode: 'browser',
    url: 'https://www.hugoboss.com/uk/sale/',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B050', name: 'Levis', renderMode: 'static',
    url: 'https://www.levi.com/GB/en_GB/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },

  // ── OUTDOORSY/ACTIVE ───────────────────────────────────────────
  {
    id: 'B051', name: 'Nike', renderMode: 'browser',
    url: 'https://www.nike.com/gb/w/sale-3yaep',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B052', name: 'Adidas', renderMode: 'browser',
    url: 'https://www.adidas.co.uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B053', name: 'The North Face', renderMode: 'browser',
    url: 'https://www.thenorthface.com/en-gb/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B054', name: 'Berghaus', renderMode: 'static',
    url: 'https://www.berghaus.com/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B055', name: 'Columbia', renderMode: 'static',
    url: 'https://www.columbiasportswear.co.uk/c/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B056', name: 'Patagonia', renderMode: 'static',
    url: 'https://www.patagonia.com/shop/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B057', name: 'Timberland', renderMode: 'static',
    url: 'https://www.timberland.co.uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B058', name: 'Craghoppers', renderMode: 'static',
    url: 'https://www.craghoppers.com/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B059', name: 'Regatta', renderMode: 'static',
    url: 'https://www.regatta.com/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B060', name: 'Mountain Warehouse', renderMode: 'static',
    url: 'https://www.mountainwarehouse.com/sale/',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },

  // ── FOOTWEAR ───────────────────────────────────────────────────
  {
    id: 'B061', name: 'Schuh', renderMode: 'static',
    url: 'https://www.schuh.co.uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B062', name: 'Dune London', renderMode: 'static',
    url: 'https://www.dunelondon.com/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B063', name: 'Office', renderMode: 'static',
    url: 'https://www.office.co.uk/view/category/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B064', name: 'Clarks', renderMode: 'static',
    url: 'https://www.clarks.co.uk/c/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B065', name: 'Kurt Geiger', renderMode: 'static',
    url: 'https://www.kurtgeiger.com/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B066', name: 'Skechers', renderMode: 'static',
    url: 'https://www.skechers.co.uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B067', name: 'UGG', renderMode: 'browser',
    url: 'https://www.ugg.com/uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B069', name: 'New Balance', renderMode: 'browser',
    url: 'https://www.newbalance.co.uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B070', name: 'FLANNELS', renderMode: 'browser',
    url: 'https://www.flannels.com/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },

  // ── ACCESSORIES ────────────────────────────────────────────────
  {
    id: 'B071', name: 'Pandora', renderMode: 'browser',
    url: 'https://uk.pandora.net/en/sale/',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B072', name: 'Fossil', renderMode: 'static',
    url: 'https://www.fossil.com/en-gb/sale/',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B073', name: 'Swarovski', renderMode: 'static',
    url: 'https://www.swarovski.com/en-GB/s-sale/',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B074', name: 'Radley', renderMode: 'static',
    url: 'https://www.radley.co.uk/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B075', name: 'Flying Tiger', renderMode: 'static',
    url: 'https://flyingtiger.com/en-gb/collections/sale',
    saleSelectors: ['h1', '[class*="sale"]', '[class*="collection"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
  {
    id: 'B076', name: 'Lush', renderMode: 'static',
    url: 'https://www.lush.com/uk/en/c/sale',
    saleSelectors: ['h1', '[class*="sale"]'],
    confirmText: ['sale', 'up to', '% off'],
  },
];

// Brands that require manual weekly check (bot-protected)
export const manualCheckBrands = brands.filter(b => b.manualCheck);

// Brands eligible for automated scraping
export const autoBrands = brands.filter(b => !b.manualCheck);
