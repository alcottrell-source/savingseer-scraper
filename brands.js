// brands.js
// 74 brand configurations for Tide scraper
// renderMode: 'static' = CheerioCrawler (fast), 'browser' = PlaywrightCrawler (JS-heavy)
// homepage: retailer homepage URL — the scraper looks here for a sale signal,
//   on the principle that retailers always have a /sale section but only
//   surface a real promotion on the homepage.

export const brands = [
  // ── HIGH STREET VALUE ──────────────────────────────────────────
  {
    id: 'B001', name: 'Next', cluster: 'High Street',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'browser',
    homepage: 'https://www.next.co.uk/',
  },
  {
    id: 'B002', name: 'M&S', cluster: 'High Street',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'static',
    homepage: 'https://www.marksandspencer.com/',
  },
  {
    id: 'B003', name: 'River Island', cluster: 'High Street',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.riverisland.com/',
  },
  {
    id: 'B004', name: 'New Look', cluster: 'High Street',
    womenswear: true, menswear: false, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.newlook.com/uk',
  },
  {
    id: 'B005', name: 'Dorothy Perkins', cluster: 'High Street',
    womenswear: true, menswear: false, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.dorothyperkins.com/',
  },
  {
    id: 'B006', name: 'Wallis', cluster: 'High Street',
    womenswear: true, menswear: false, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.wallis.co.uk/',
  },
  {
    id: 'B007', name: 'Evans', cluster: 'High Street',
    womenswear: true, menswear: false, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.evans.co.uk/',
  },
  {
    id: 'B008', name: 'Bonmarche', cluster: 'High Street',
    womenswear: true, menswear: false, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.bonmarche.co.uk/',
  },
  {
    id: 'B009', name: 'Peacocks', cluster: 'High Street',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'static',
    homepage: 'https://www.peacocks.co.uk/',
  },


  // ── CONTEMPORARY ───────────────────────────────────────────────
  {
    id: 'B011', name: 'Zara', cluster: 'Contemporary',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'browser',
    homepage: 'https://www.zara.com/uk/',
  },
  {
    id: 'B012', name: 'H&M', cluster: 'Contemporary',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'browser',
    homepage: 'https://www2.hm.com/en_gb/index.html',
  },
  {
    id: 'B013', name: 'Mango', cluster: 'Contemporary',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'browser',
    homepage: 'https://shop.mango.com/gb',
  },
  {
    id: 'B014', name: 'COS', cluster: 'Contemporary',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'browser',
    homepage: 'https://www.cos.com/en_gbp/',
  },
  {
    id: 'B015', name: 'Arket', cluster: 'Contemporary',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'browser',
    homepage: 'https://www.arket.com/en_gbp/',
  },
  {
    id: 'B016', name: '& Other Stories', cluster: 'Contemporary',
    womenswear: true, menswear: false, childrenswear: false,
    renderMode: 'browser',
    homepage: 'https://www.stories.com/en_gbp/',
  },
  {
    id: 'B017', name: 'Weekday', cluster: 'Contemporary',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'browser',
    homepage: 'https://www.weekday.com/en_gbp/',
  },
  {
    id: 'B018', name: 'Monki', cluster: 'Contemporary',
    womenswear: true, menswear: false, childrenswear: false,
    renderMode: 'browser',
    homepage: 'https://www.monki.com/en_gbp/',
  },
  {
    id: 'B019', name: 'Hollister', cluster: 'Contemporary',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'browser',
    homepage: 'https://www.hollisterco.com/shop/uk',
  },
  {
    id: 'B020', name: 'Abercrombie', cluster: 'Contemporary',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'browser',
    homepage: 'https://www.abercrombie.com/shop/uk',
  },

  // ── CLASSIC BRITISH ────────────────────────────────────────────
  {
    id: 'B021', name: 'Fat Face', cluster: 'Classic British',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'static',
    homepage: 'https://www.fatface.com/',
  },
  {
    id: 'B022', name: 'Joules', cluster: 'Classic British',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'static',
    homepage: 'https://www.joules.com/',
  },
  {
    id: 'B023', name: 'White Stuff', cluster: 'Classic British',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.whitestuff.com/',
  },
  {
    id: 'B024', name: 'Seasalt Cornwall', cluster: 'Classic British',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.seasaltcornwall.co.uk/',
  },
  {
    id: 'B025', name: 'Crew Clothing', cluster: 'Classic British',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.crewclothing.co.uk/',
  },
  {
    id: 'B026', name: 'Boden', cluster: 'Classic British',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'static',
    homepage: 'https://www.boden.co.uk/en-gb',
  },
  {
    id: 'B027', name: 'Hobbs', cluster: 'Classic British',
    womenswear: true, menswear: false, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.hobbs.co.uk/',
  },
  {
    id: 'B028', name: 'The White Company', cluster: 'Classic British',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'static',
    homepage: 'https://www.thewhitecompany.com/uk/',
  },
  {
    id: 'B029', name: 'Barbour', cluster: 'Classic British',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'static',
    homepage: 'https://www.barbour.com/uk/',
  },
  {
    id: 'B030', name: 'Cath Kidston', cluster: 'Classic British',
    womenswear: true, menswear: false, childrenswear: true,
    renderMode: 'static',
    homepage: 'https://www.cathkidston.com/',
  },

  // ── SMART/OCCASION ─────────────────────────────────────────────
  {
    id: 'B031', name: 'Phase Eight', cluster: 'Smart/Occasion',
    womenswear: true, menswear: false, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.phase-eight.com/',
  },
  {
    id: 'B032', name: 'Whistles', cluster: 'Smart/Occasion',
    womenswear: true, menswear: false, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.whistles.com/',
  },
  {
    id: 'B033', name: 'Reiss', cluster: 'Smart/Occasion',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.reiss.com/gb/',
  },
  {
    id: 'B034', name: 'Ted Baker', cluster: 'Smart/Occasion',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.tedbaker.com/uk/',
  },
  {
    id: 'B035', name: 'Karen Millen', cluster: 'Smart/Occasion',
    womenswear: true, menswear: false, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.karenmillen.com/',
  },
  {
    id: 'B036', name: 'Coast', cluster: 'Smart/Occasion',
    womenswear: true, menswear: false, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.coast-stores.com/',
  },
  {
    id: 'B037', name: 'Monsoon', cluster: 'Smart/Occasion',
    womenswear: true, menswear: false, childrenswear: true,
    renderMode: 'static',
    homepage: 'https://www.monsoon.co.uk/',
  },
  {
    id: 'B038', name: 'Accessorize', cluster: 'Smart/Occasion',
    womenswear: true, menswear: false, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.accessorize.com/uk/',
  },
  {
    id: 'B039', name: 'Oasis', cluster: 'Smart/Occasion',
    womenswear: true, menswear: false, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.oasis-stores.com/',
  },
  {
    id: 'B040', name: 'Warehouse', cluster: 'Smart/Occasion',
    womenswear: true, menswear: false, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.warehouse.co.uk/',
  },

  // ── PREMIUM CASUAL ─────────────────────────────────────────────
  {
    id: 'B041', name: 'Sweaty Betty', cluster: 'Premium Casual',
    womenswear: true, menswear: false, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.sweatybetty.com/',
  },
  {
    id: 'B042', name: 'Lululemon', cluster: 'Premium Casual',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'browser',
    homepage: 'https://www.lululemon.co.uk/en-gb',
  },
  {
    id: 'B043', name: 'Superdry', cluster: 'Premium Casual',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.superdry.com/',
  },
  {
    id: 'B044', name: 'Jack Wills', cluster: 'Premium Casual',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.jackwills.com/',
  },
  {
    id: 'B045', name: 'Hackett', cluster: 'Premium Casual',
    womenswear: false, menswear: true, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.hackett.com/gb',
  },
  {
    id: 'B046', name: 'Ralph Lauren', cluster: 'Premium Casual',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'browser',
    homepage: 'https://www.ralphlauren.co.uk/en/',
  },
  {
    id: 'B047', name: 'Tommy Hilfiger', cluster: 'Premium Casual',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'static',
    homepage: 'https://uk.tommy.com/',
  },
  {
    id: 'B048', name: 'Lacoste', cluster: 'Premium Casual',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'browser',
    homepage: 'https://www.lacoste.com/gb/',
  },
  {
    id: 'B049', name: 'Hugo Boss', cluster: 'Premium Casual',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'browser',
    homepage: 'https://www.hugoboss.com/uk/',
  },
  {
    id: 'B050', name: 'Levis', cluster: 'Premium Casual',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.levi.com/GB/en_GB/',
  },

  // ── OUTDOORSY/ACTIVE ───────────────────────────────────────────
  {
    id: 'B051', name: 'Nike', cluster: 'Active',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'browser',
    homepage: 'https://www.nike.com/gb/',
  },
  {
    id: 'B052', name: 'Adidas', cluster: 'Active',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'browser',
    homepage: 'https://www.adidas.co.uk/',
  },
  {
    id: 'B053', name: 'The North Face', cluster: 'Active',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'browser',
    homepage: 'https://www.thenorthface.com/en-gb',
  },
  {
    id: 'B054', name: 'Berghaus', cluster: 'Active',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.berghaus.com/',
  },
  {
    id: 'B055', name: 'Columbia', cluster: 'Active',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.columbiasportswear.co.uk/',
  },
  {
    id: 'B056', name: 'Patagonia', cluster: 'Active',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.patagonia.com/',
  },
  {
    id: 'B057', name: 'Timberland', cluster: 'Active',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.timberland.co.uk/',
  },
  {
    id: 'B058', name: 'Craghoppers', cluster: 'Active',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'static',
    homepage: 'https://www.craghoppers.com/',
  },
  {
    id: 'B059', name: 'Regatta', cluster: 'Active',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'static',
    homepage: 'https://www.regatta.com/',
  },
  {
    id: 'B060', name: 'Mountain Warehouse', cluster: 'Active',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'static',
    homepage: 'https://www.mountainwarehouse.com/',
  },

  // ── FOOTWEAR ───────────────────────────────────────────────────
  {
    id: 'B061', name: 'Schuh', cluster: 'Footwear',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'static',
    homepage: 'https://www.schuh.co.uk/',
  },
  {
    id: 'B062', name: 'Dune London', cluster: 'Footwear',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.dunelondon.com/',
  },
  {
    id: 'B063', name: 'Office', cluster: 'Footwear',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.office.co.uk/',
  },
  {
    id: 'B064', name: 'Clarks', cluster: 'Footwear',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'static',
    homepage: 'https://www.clarks.co.uk/',
  },
  {
    id: 'B065', name: 'Kurt Geiger', cluster: 'Footwear',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.kurtgeiger.com/',
  },
  {
    id: 'B066', name: 'Skechers', cluster: 'Footwear',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'static',
    homepage: 'https://www.skechers.co.uk/',
  },
  {
    id: 'B067', name: 'UGG', cluster: 'Footwear',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'browser',
    homepage: 'https://www.ugg.com/uk/',
  },
  {
    id: 'B069', name: 'New Balance', cluster: 'Footwear',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'browser',
    homepage: 'https://www.newbalance.co.uk/',
  },
  {
    id: 'B070', name: 'FLANNELS', cluster: 'Footwear',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'browser',
    homepage: 'https://www.flannels.com/',
  },

  // ── ACCESSORIES ────────────────────────────────────────────────
  {
    id: 'B071', name: 'Pandora', cluster: 'Accessories',
    womenswear: true, menswear: false, childrenswear: false,
    renderMode: 'browser',
    homepage: 'https://uk.pandora.net/en/',
  },
  {
    id: 'B072', name: 'Fossil', cluster: 'Accessories',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.fossil.com/en-gb/',
  },
  {
    id: 'B073', name: 'Swarovski', cluster: 'Accessories',
    womenswear: true, menswear: false, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.swarovski.com/en-GB/',
  },
  {
    id: 'B074', name: 'Radley', cluster: 'Accessories',
    womenswear: true, menswear: false, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.radley.co.uk/',
  },
  {
    id: 'B075', name: 'Flying Tiger', cluster: 'Accessories',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'static',
    homepage: 'https://flyingtiger.com/en-gb',
  },
  {
    id: 'B076', name: 'Lush', cluster: 'Accessories',
    womenswear: true, menswear: true, childrenswear: false,
    renderMode: 'static',
    homepage: 'https://www.lush.com/uk/en/',
  },
  {
    id: 'B077', name: 'John Lewis', cluster: 'Classic British',
    womenswear: true, menswear: true, childrenswear: true,
    renderMode: 'browser',
    homepage: 'https://www.johnlewis.com/',
  },
];

// Brands that require manual weekly check (bot-protected)
export const manualCheckBrands = brands.filter(b => b.manualCheck);

// Brands eligible for automated scraping
export const autoBrands = brands.filter(b => !b.manualCheck);
