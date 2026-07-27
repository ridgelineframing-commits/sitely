/* QuoteEngine — Sitely's native material-takeoff + rough-quote calculation engine.
 *
 * Replaces the emulated Excel workbook for estimating. Everything here is a plain rule:
 * takeoff inputs × unit prices × waste = quantities and dollars. No sheets, no cells.
 * The full logic spec (interviewed line-by-line with Zac, Jul 2026) lives in the
 * Bid Builder engine: material takeoff, package pricing and the 14-category bid.
 *
 * Two independent products from one set of inputs:
 *   computeMaterials(takeoff, priceBook, rates) -> vendor material list + package subtotals
 *   computeQuote(takeoff, rates, opts)          -> the job's rough-quote lines by category
 * The bid's material-package lines source three ways: material list -> per-SF backup
 * -> manual ($0 + flag). vendorSheet(priceBook) prints the qty-1 pricing sheet for suppliers.
 */
(function () {
  'use strict';

  const r2 = n => Math.round(n * 100) / 100;
  const up = (qty, waste) => Math.ceil(qty * (1 + (waste || 0)));

  // ---------- price book (per-piece prices — the way you order and vendors quote) ----------
  // Seeds converted from the old workbook's $/MBF-and-$/MSF supplier quote (BFS QT#4269124),
  // so day-one numbers match the old engine. All editable; the vendor sheet refreshes them.
  function defaultPriceBook() {
    return [
      // Framing lumber
      { id: 'pt26', group: 'Framing lumber', desc: '2×6-16′ PT (mudsill)', unit: 'EA', price: 21.81 },
      { id: 'pt28', group: 'Framing lumber', desc: '2×8-16′ PT (deck framing)', unit: 'EA', price: 26.94 },
      { id: 'df26', group: 'Framing lumber', desc: '2×6-16′ #2&Btr DF (plates)', unit: 'EA', price: 12.80 },
      { id: 'df24', group: 'Framing lumber', desc: '2×4-16′ Std&Btr DF (int. plates / bracing)', unit: 'EA', price: 7.95 },
      { id: 'stud26_8', group: 'Framing lumber', desc: '2×6 stud 92⅝″ (8′ walls)', unit: 'EA', price: 6.10 },
      { id: 'stud26_9', group: 'Framing lumber', desc: '2×6 stud 104⅝″ (9′ walls)', unit: 'EA', price: 6.87 },
      { id: 'stud24_8', group: 'Framing lumber', desc: '2×4 stud 92⅝″', unit: 'EA', price: 4.30 },
      { id: 'stud24_9', group: 'Framing lumber', desc: '2×4 stud 104⅝″', unit: 'EA', price: 4.86 },
      { id: 'hdr410', group: 'Framing lumber', desc: '4×10-14′ #2 DF (window headers)', unit: 'EA', price: 46.62 },
      { id: 'glulam', group: 'Framing lumber', desc: 'Glulam 5½×11⅞ (garage / long-span headers)', unit: 'LF', price: 22.29 },
      { id: 'ijoist95', group: 'Framing lumber', desc: 'I-joist 9½″', unit: 'LF', price: 3.19 },
      { id: 'ijoist118', group: 'Framing lumber', desc: 'I-joist 11⅞″', unit: 'LF', price: 3.29 },
      { id: 'rim', group: 'Framing lumber', desc: 'Rim board 1¼×9½', unit: 'LF', price: 3.50 },
      { id: 'pt44', group: 'Framing lumber', desc: '4×4-12′ PT post', unit: 'EA', price: 26.75 },
      { id: 'pt66', group: 'Framing lumber', desc: '6×6-12′ PT post', unit: 'EA', price: 67.79 },
      // Sheet goods
      { id: 'osb716_8', group: 'Sheet goods', desc: '7/16″ OSB 4×8 (roof / pony wall)', unit: 'SHT', price: 11.90 },
      { id: 'osb716_9', group: 'Sheet goods', desc: '7/16″ OSB 4×9 (walls)', unit: 'SHT', price: 14.94 },
      { id: 'osb716_10', group: 'Sheet goods', desc: '7/16″ OSB 4×10 (walls)', unit: 'SHT', price: 16.60 },
      { id: 'sub34', group: 'Sheet goods', desc: '¾″ T&G subfloor 4×8 (16″ OC)', unit: 'SHT', price: 28.00 },
      { id: 'sub78', group: 'Sheet goods', desc: '⅞″ T&G subfloor 4×8 (24″ OC)', unit: 'SHT', price: 33.00 },
      { id: 'sub118', group: 'Sheet goods', desc: '1⅛″ T&G subfloor 4×8 (32″ OC)', unit: 'SHT', price: 38.24 },
      // Siding & exterior trim
      { id: 'lap', group: 'Siding & exterior trim', desc: 'Hardie lap 8¼″×12′ Cedarmill', unit: 'PC', price: 10.96 },
      { id: 'panel', group: 'Siding & exterior trim', desc: 'Hardie panel 4×8 5/16″ (gables)', unit: 'SHT', price: 50.62 },
      { id: 'trim54_4', group: 'Siding & exterior trim', desc: 'Hardie trim 5/4×4×12′', unit: 'PC', price: 21.03 },
      { id: 'trim54_6', group: 'Siding & exterior trim', desc: 'Hardie trim 5/4×6×12′', unit: 'PC', price: 33.05 },
      { id: 'fascia56', group: 'Siding & exterior trim', desc: 'Fascia 5/4×6-20′ primed', unit: 'PC', price: 57.11 },
      { id: 'fascia54', group: 'Siding & exterior trim', desc: 'Fascia 5/4×4-20′ primed', unit: 'PC', price: 36.10 },
      { id: 'subfascia', group: 'Siding & exterior trim', desc: 'Subfascia 2×6-20′ primed', unit: 'PC', price: 76.86 },
      { id: 'barge28', group: 'Siding & exterior trim', desc: 'Barge 2×8-20′ primed', unit: 'PC', price: 104.24 },
      { id: 'bargetrim', group: 'Siding & exterior trim', desc: 'Barge trim 1×2-20′ primed', unit: 'PC', price: 12.59 },
      { id: 'soffit', group: 'Siding & exterior trim', desc: 'Soffit panel 4×8 prefinished', unit: 'SHT', price: 34.99 },
      { id: 'wrap', group: 'Siding & exterior trim', desc: 'House wrap 9′×150′', unit: 'ROLL', price: 209.99 },
      { id: 'seamtape', group: 'Siding & exterior trim', desc: 'Seam tape', unit: 'ROLL', price: 21.99 },
      { id: 'flashtape', group: 'Siding & exterior trim', desc: 'Window flashing tape 4″', unit: 'ROLL', price: 17.99 },
      { id: 'zflash', group: 'Siding & exterior trim', desc: 'High-back / Z flashing', unit: 'PC', price: 8.49 },
      { id: 'sillseal', group: 'Siding & exterior trim', desc: 'Sill seal 50′', unit: 'ROLL', price: 14.95 },
      // Fasteners & consumables
      { id: 'framenails', group: 'Fasteners & consumables', desc: 'Framing nails 3¼″ (box)', unit: 'BOX', price: 64.99 },
      { id: 'sheathnails', group: 'Fasteners & consumables', desc: 'Sheathing / coil nails (box)', unit: 'BOX', price: 48.99 },
      { id: 'sidingnails', group: 'Fasteners & consumables', desc: 'Siding nails (box)', unit: 'BOX', price: 67.99 },
      { id: 'adhesive', group: 'Fasteners & consumables', desc: 'Subfloor adhesive', unit: 'TUBE', price: 8.99 },
      { id: 'bolt', group: 'Fasteners & consumables', desc: 'Anchor bolt ½″×10″ w/ nut & washer', unit: 'EA', price: 1.85 },
      { id: 'clips', group: 'Fasteners & consumables', desc: 'Plywood clips (bag)', unit: 'BAG', price: 15.00 },
      { id: 'caulk', group: 'Fasteners & consumables', desc: 'Exterior caulk', unit: 'TUBE', price: 5.19 },
      // Decking
      { id: 'deckbrd', group: 'Decking', desc: 'Composite decking board 16′ (house default)', unit: 'PC', price: 54.99 },
      { id: 'railsec', group: 'Decking', desc: 'Deck rail section 6′ (house default style)', unit: 'EA', price: 249.99 },
      { id: 'hanger', group: 'Decking', desc: 'Joist hanger 2×8', unit: 'EA', price: 3.29 }
    ];
  }

  // ---------- rates & allowances (every number editable; seeds = old engine's behavior) ----------
  function defaultRates() {
    return {
      waste: { framing: 0.10, sheet: 0.10, siding: 0.15, trim: 0.10 },
      // 0100 General Conditions
      permitPctOfValuation: 2.0, permitAllowance: 8000,
      pudAllowance: 7500, gasAllowance: 2500,
      excavationPerLF: 21.55, excavationUtilPerLF: 18.47,
      backfillLaborPerLF: 30.79, backfillGravelPerLF: 30.79,
      septicInstall: 14040, septicDesign: 1404, septicPermit: 1170, wellAllowance: 0,
      cleaningPerSF: 1.63, dumpingPerSF: 3.25, portaPottyMonthly: 270,
      // 0200 Site Work
      concretePerCY: 440, concreteRoundCY: 5, footingWidthIn: 16, footingDepthIn: 8, pumpTruck: 1872,
      // 0300 Rough Structure
      framingLaborLivingPerSF: 12, framingLaborGaragePerSF: 9,
      trussBackupPerRoofSF: 2.15, beamsAllowance: 1404,
      pkgBackupPerSF: { floor: 3.60, wall: 4.20, roof: 2.40, siding: 6.50 },
      // 0400 Windows & Doors
      windowEach: 380, sgdEach: 2200, extDoorEach: 650, garageDoorEach: 1500, openerEach: 450,
      frontDoorTiers: { basic: 1800, mid: 3500, custom: 5265 }, frontDoorTier: 'custom',
      // 0500 Exterior Finishes
      roofingTypes: { comp: { material: 425, labor: 250 }, metal: { material: 750, labor: 350 } },
      gutterPerEaveLF: 6, downspoutEach: 45,
      sidingLaborPerSF: 4, soffitLaborPerEaveLF: 14.75, postWrapEach: 351,
      extPaintPerSF: 1.60, drivewayPerSF: 7, patioPerSF: 6, garageSlabPerSF: 6, culturedStoneAllowance: 0,
      // 0600–0900
      hvacPerSF: 9.50, plumbingPerSF: 9.75, electricalPerSF: 11.70,
      lowVoltage: 1500, evCircuit: 900, fireplaceAllowance: 5850,
      insulWallPerSF: 2.25, insulCeilPerSF: 1.50,
      // 1000–1100
      drywallPerSF: 2.10, intPaintPerSF: 1.10, intWallLFperSF: 0.125,
      perFullBath: { showerGlass: 1500, showerPan: 1200, mirror: 150, accessories: 125 },
      perHalfBath: { mirror: 150, accessories: 125 },
      tileLaborPerSF: 10, tileMatPerSF: 5, lvtLaborPerSF: 2.50, lvtMatPerSF: 4, carpetLaborPerSF: 1.25, carpetMatPerSF: 3,
      // 1200–1500
      trimPackPerSF: 2.50, finishLaborPerSF: 2.50, cabinetsPerLF: 350,
      counterPerLF: 136.50, backsplashPerLF: 37.50,
      windowCoveringEach: 180, applianceAllowance: 0, finalGrade: 3000,
      deckStairAllowance: 800
    };
  }

  // ---------- takeoff (per-job inputs) ----------
  function defaultTakeoff() {
    return {
      floors: [{ sf: 1800, perimeter: 190, wallHeight: 9, joistSpacing: 16 }],
      foundationType: 'crawl',            // crawl | slab | basement
      ponyWallHeight: 2, ponyExterior: false,
      concreteWallHeight: 4, concreteThicknessIn: 8,
      garageSF: 400, porchSF: 120,
      roofPitch: 6, roofStructure: 'truss', // truss | stick
      roofingType: 'comp',
      eaveLF: null, rakeLF: null, overhangFt: 1.5, // null -> derived from perimeter
      buildingWidth: 30, gableSF: null,            // null -> auto from width × pitch
      corners: 4, windows: 18, extDoors: 3, sgd: 1, garageDoors: 1, postWraps: 4, downspouts: 4,
      kitchenLF: 20, bathsFull: 2, bathsHalf: 0,
      tileSF: 400, carpetSF: 0,
      deckSF: 0, deckHeightFt: 2,
      drivewayLen: 40, drivewayWidth: 11, patioSF: 600,
      septic: true, well: false, fireplace: true
    };
  }

  const pitchFactor = pitch => Math.sqrt(1 + Math.pow((Number(pitch) || 0) / 12, 2));
  const lfPerSF = spacing => spacing === 24 ? 0.55 : (spacing === 32 ? 0.42 : 0.80); // joist LF per floor SF
  const subfloorSku = spacing => spacing === 24 ? 'sub78' : (spacing === 32 ? 'sub118' : 'sub34');
  const studSku = (w, ht) => (ht <= 8 ? (w === 4 ? 'stud24_8' : 'stud26_8') : (w === 4 ? 'stud24_9' : 'stud26_9'));

  function derived(t) {
    const f1 = t.floors[0] || { sf: 0, perimeter: 0, wallHeight: 9 };
    const footprint = (f1.sf || 0) + (t.garageSF || 0) + (t.porchSF || 0);
    const roofSF = footprint * pitchFactor(t.roofPitch);
    const eave = t.eaveLF != null ? t.eaveLF : Math.round((f1.perimeter || 0) * 0.75);
    const rake = t.rakeLF != null ? t.rakeLF : Math.round((f1.perimeter || 0) * 0.25);
    const gable = t.gableSF != null ? t.gableSF
      : Math.round(Math.pow(t.buildingWidth || 0, 2) * (Number(t.roofPitch) || 0) / 24); // both gable ends
    const livingSF = t.floors.reduce((s, f) => s + (f.sf || 0), 0);
    const wallSF = t.floors.reduce((s, f) => s + (f.perimeter || 0) * (f.wallHeight || 0), 0);
    const openingsSF = (t.windows || 0) * 15 + (t.extDoors || 0) * 21 + (t.sgd || 0) * 40 + (t.garageDoors || 0) * 130;
    return { footprint, roofSF, eave, rake, gable, livingSF, wallSF, openingsSF, f1 };
  }

  // ---------- material list ----------
  function computeMaterials(takeoff, priceBook, rates) {
    const t = Object.assign(defaultTakeoff(), takeoff || {});
    const rt = Object.assign(defaultRates(), rates || {});
    const W = Object.assign(defaultRates().waste, (rates || {}).waste || {});
    const book = {};
    for (const p of (priceBook && priceBook.length ? priceBook : defaultPriceBook())) book[p.id] = p;
    const d = derived(t);
    const lines = [];
    const add = (pkg, skuId, qty, note) => {
      qty = Math.max(0, Math.ceil(qty));
      if (!qty) return;
      const sku = book[skuId] || { desc: skuId, unit: 'EA', price: 0 };
      const prev = lines.find(l => l.pkg === pkg && l.skuId === skuId);
      if (prev) { prev.qty += qty; prev.total = r2(prev.qty * prev.unitPrice); return; }
      lines.push({ pkg, skuId, desc: sku.desc, unit: sku.unit, qty, unitPrice: Number(sku.price) || 0, total: r2(qty * (Number(sku.price) || 0)), note: note || '' });
    };

    // -- Foundation & floor structure --
    const perim = d.f1.perimeter || 0;
    add('floor', 'pt26', up(perim / 16, W.framing));
    add('floor', 'sillseal', Math.ceil(perim / 50));
    add('floor', 'bolt', Math.ceil(perim / 4) + 2 * (t.corners || 0));
    const framedFloors = t.floors.filter((f, i) => i > 0 || t.foundationType !== 'slab');
    let framedSF = 0, sheathSF = 0;
    for (const f of framedFloors) {
      framedSF += f.sf || 0;
      add('floor', 'ijoist95', up((f.sf || 0) * lfPerSF(f.joistSpacing || 16), W.framing), 'floor ' + (t.floors.indexOf(f) + 1));
      add('floor', 'rim', up(f.perimeter || 0, W.framing));
      add('floor', subfloorSku(f.joistSpacing || 16), up((f.sf || 0) / 32, W.sheet));
    }
    if (t.foundationType === 'crawl' && framedFloors.length) {
      add('floor', 'df26', up(perim * 2 / 16, W.framing), 'pony wall plates');
      add('floor', studSku(6, 8), up(perim * 0.75, W.framing), 'pony wall studs');
      if (t.ponyExterior) { sheathSF += perim * (t.ponyWallHeight || 2); add('floor', 'osb716_8', up(perim * (t.ponyWallHeight || 2) / 32, W.sheet), 'exterior pony sheathing'); }
    }
    if (framedSF) {
      add('floor', 'adhesive', Math.ceil(framedSF / 500));
      add('floor', 'framenails', Math.ceil(framedSF / 2000));
    }

    // -- Wall framing --
    for (const f of t.floors) {
      const p = f.perimeter || 0, ht = f.wallHeight || 9;
      add('wall', 'df26', up(p * 3 / 16, W.framing), 'plates');
      add('wall', studSku(6, ht), up(p * 0.75, W.framing) + 2 * (t.corners || 0), 'studs + corners');
      const sku = ht > 9 ? 'osb716_10' : (ht > 8 ? 'osb716_9' : 'osb716_8');
      const perSheet = ht > 9 ? 40 : (ht > 8 ? 36 : 32);
      sheathSF += p * ht;
      add('wall', sku, up(p * ht / perSheet, W.sheet), 'wall sheathing');
      const intLF = (f.sf || 0) * (rt.intWallLFperSF || 0.125);
      add('wall', 'df24', up(intLF * 3 / 16, W.framing), 'interior plates');
      add('wall', studSku(4, ht), up(intLF * 0.75, W.framing), 'interior studs');
    }
    const openings = (t.windows || 0) + (t.extDoors || 0) + (t.sgd || 0);
    if (openings) add('wall', 'hdr410', up(openings * 3.5 / 14, W.framing), 'window/door headers');
    if (t.garageDoors) add('wall', 'glulam', up((t.garageDoors || 0) * 20, 0), 'garage-door headers');
    if (sheathSF) add('wall', 'sheathnails', Math.ceil(sheathSF / 2000));

    // -- Roof framing & trim --
    add('roof', 'osb716_8', up(d.roofSF / 32, W.sheet), 'roof sheathing');
    add('roof', 'clips', Math.ceil(d.roofSF / 64) / 20 >= 1 ? Math.ceil(d.roofSF / 1280) : 1, 'plywood clips');
    add('roof', 'fascia56', up(d.eave * 1.05 / 20, 0));
    add('roof', 'subfascia', up(d.eave * 1.05 / 20, 0));
    add('roof', 'barge28', up(d.rake / 20, W.trim));
    add('roof', 'bargetrim', Math.ceil(d.rake / 20));
    add('roof', 'soffit', up(d.eave * (t.overhangFt || 1.5) / 16, W.sheet));
    add('roof', 'df24', Math.ceil(d.roofSF / 500), 'roof bracing');
    if (t.roofStructure === 'stick') add('roof', 'barge28', up(d.roofSF * 0.55 / 20, W.framing), 'rafters (stick-framed)');

    // -- Siding & exterior trim --
    const sidingSF = Math.max(0, d.wallSF - d.openingsSF) + d.gable;
    add('siding', 'lap', up(sidingSF / 7, W.siding));
    add('siding', 'wrap', Math.ceil(d.wallSF / 1200));
    add('siding', 'seamtape', Math.ceil(d.wallSF / 2000) + 1);
    if (openings) {
      add('siding', 'flashtape', Math.ceil(openings * 12 / 75));
      add('siding', 'zflash', t.windows || 0);
      add('siding', 'trim54_4', up((t.windows + t.extDoors) * 16 / 12, W.trim), 'window/door casing');
    }
    add('siding', 'trim54_4', up((t.corners || 0) * (d.f1.wallHeight || 9) * 2 / 12, W.trim), 'outside corners');
    add('siding', 'trim54_6', up(perim * 1.05 / 12, W.trim), 'band / frieze');
    if (d.gable > 0) add('siding', 'panel', up(d.gable / 32, W.siding), 'gable panels');
    add('siding', 'caulk', Math.ceil(openings / 4 + (t.corners || 0) / 2));
    add('siding', 'sidingnails', Math.ceil(sidingSF / 1500) || 1);

    // -- Deck (only when there is one) --
    if ((t.deckSF || 0) > 0) {
      const joists = Math.ceil((t.deckSF * 0.8) / 16);
      add('deck', 'pt28', up(joists, W.framing), 'deck joists');
      add('deck', 'hanger', joists);
      add('deck', (t.deckHeightFt || 0) > 4 ? 'pt66' : 'pt44', Math.ceil(t.deckSF / 50), 'posts');
      add('deck', 'deckbrd', up(t.deckSF / 7.33, W.framing), 'decking');
      const railLF = Math.ceil(Math.sqrt(t.deckSF) * 3);
      add('deck', 'railsec', Math.ceil(railLF / 6));
    }

    const packages = { floor: 0, wall: 0, roof: 0, siding: 0, deck: 0 };
    for (const l of lines) packages[l.pkg] = r2((packages[l.pkg] || 0) + l.total);
    const total = r2(lines.reduce((s, l) => s + l.total, 0));
    return { lines, packages, total, derived: d };
  }

  // ---------- vendor price sheet (qty 1 of every SKU — print, price, key back in) ----------
  function vendorSheet(priceBook) {
    const book = priceBook && priceBook.length ? priceBook : defaultPriceBook();
    const groups = [];
    for (const p of book) {
      let g = groups.find(x => x.group === p.group);
      if (!g) { g = { group: p.group, items: [] }; groups.push(g); }
      g.items.push({ id: p.id, desc: p.desc, unit: p.unit, qty: 1, price: Number(p.price) || 0 });
    }
    return groups;
  }

  // ---------- the bid ----------
  // opts: { materials: packages-object|null, quotes: {trusses,windows,hvac,plumbing,electrical,cabinets,countertops},
  //         manual: {lineKey: $}, months: schedule length in months|null, valuation: contract $|null }
  function computeQuote(takeoff, rates, opts) {
    const t = Object.assign(defaultTakeoff(), takeoff || {});
    const rt = Object.assign(defaultRates(), rates || {});
    if (rates && rates.pkgBackupPerSF) rt.pkgBackupPerSF = Object.assign(defaultRates().pkgBackupPerSF, rates.pkgBackupPerSF);
    if (rates && rates.roofingTypes) rt.roofingTypes = Object.assign(defaultRates().roofingTypes, rates.roofingTypes);
    const o = opts || {};
    const q = o.quotes || {};
    const manual = o.manual || {};
    const mat = o.materials || null;
    const d = derived(t);
    const cats = [];
    let cat = null;
    const C = (code, name) => { cat = { code, name, lines: [], subtotal: 0 }; cats.push(cat); };
    // source: calc | material | backup | quote | allowance | manual
    const L = (key, desc, amount, source) => {
      let src = source || 'calc';
      let amt = amount;
      if (manual[key] != null) { amt = Number(manual[key]) || 0; src = 'manual'; }
      amt = r2(Math.max(0, amt || 0));
      cat.lines.push({ key, desc, amount: amt, source: src, rough: src !== 'quote' && src !== 'manual' });
      cat.subtotal = r2(cat.subtotal + amt);
    };
    // material-package line: material list -> backup rate -> 0/manual
    const P = (key, desc, pkg, backupSF) => {
      if (mat && mat[pkg] != null) L(key, desc, mat[pkg], 'material');
      else if (rt.pkgBackupPerSF[pkg]) L(key, desc, backupSF * rt.pkgBackupPerSF[pkg], 'backup');
      else L(key, desc, 0, 'manual');
    };
    // sub-quote pattern: real quote when keyed, else backup calc
    const Q = (key, desc, quoteVal, backupAmt) => {
      if (quoteVal != null && quoteVal !== '') L(key, desc, Number(quoteVal), 'quote');
      else L(key, desc, backupAmt, 'backup');
    };

    const perim = d.f1.perimeter || 0;

    C('0100', 'General Conditions');
    L('permit', 'Building permit', o.valuation ? o.valuation * (rt.permitPctOfValuation / 100) : rt.permitAllowance, o.valuation ? 'calc' : 'allowance');
    L('pud', 'Electrical utility connection (PUD)', rt.pudAllowance, 'allowance');
    L('gas', 'Gas service connection', rt.gasAllowance, 'allowance');
    L('excavation', 'Excavation', perim * rt.excavationPerLF);
    L('excavUtil', 'Excavation — utilities & contingency', perim * rt.excavationUtilPerLF);
    L('backfillLabor', 'Backfill — labor', perim * rt.backfillLaborPerLF);
    L('backfillGravel', 'Backfill — gravel & fill', perim * rt.backfillGravelPerLF);
    if (t.septic) { L('septicInstall', 'Septic system install', rt.septicInstall, 'allowance'); L('septicDesign', 'Septic design', rt.septicDesign, 'allowance'); L('septicPermit', 'Septic permit', rt.septicPermit, 'allowance'); }
    if (t.well) L('well', 'Well drilling & setup', rt.wellAllowance, 'allowance');
    L('cleaning', 'Home cleaning @ final', d.livingSF * rt.cleaningPerSF);
    L('portaPotty', 'Portable toilet', (o.months || 6) * rt.portaPottyMonthly);
    L('dumping', 'Dumping fees / site cleanup', d.livingSF * rt.dumpingPerSF);

    C('0200', 'Site Work');
    const wallCF = perim * (t.concreteWallHeight || 0) * ((t.concreteThicknessIn || 8) / 12);
    const footingCF = perim * (rt.footingWidthIn / 12) * (rt.footingDepthIn / 12);
    const cy = Math.ceil((wallCF + footingCF) / 27 / rt.concreteRoundCY) * rt.concreteRoundCY;
    L('foundation', 'Foundation — footings, walls, labor & concrete (' + cy + ' CY)', cy * rt.concretePerCY);
    L('pumpTruck', 'Pump truck', rt.pumpTruck, 'allowance');

    C('0300', 'Rough Structure');
    P('matFloor', 'Materials — floor structure', 'floor', d.livingSF);
    P('matWall', 'Materials — exterior & interior walls', 'wall', d.livingSF);
    P('matRoof', 'Materials — roof pack', 'roof', d.livingSF);
    Q('trusses', 'Trusses', q.trusses, d.roofSF * rt.trussBackupPerRoofSF);
    L('beams', 'Beams, hardware & posts', rt.beamsAllowance, 'allowance');
    L('framingLabor', 'Framing labor — living space', d.livingSF * rt.framingLaborLivingPerSF);
    L('framingLaborGar', 'Framing labor — garage & porch', ((t.garageSF || 0) + (t.porchSF || 0)) * rt.framingLaborGaragePerSF);

    C('0400', 'Windows & Doors');
    Q('windows', 'Windows (' + (t.windows || 0) + ')', q.windows, (t.windows || 0) * rt.windowEach);
    L('sgd', 'Sliding glass doors (' + (t.sgd || 0) + ')', (t.sgd || 0) * rt.sgdEach);
    L('frontDoor', 'Front door — ' + (rt.frontDoorTier || 'custom'), rt.frontDoorTiers[rt.frontDoorTier] != null ? rt.frontDoorTiers[rt.frontDoorTier] : rt.frontDoorTiers.custom, 'allowance');
    L('extDoors', 'Other exterior doors (' + (t.extDoors || 0) + ')', (t.extDoors || 0) * rt.extDoorEach);
    L('garageDoors', 'Garage doors (' + (t.garageDoors || 0) + ')', (t.garageDoors || 0) * rt.garageDoorEach);
    L('openers', 'Garage door openers', (t.garageDoors || 0) * rt.openerEach);

    C('0500', 'Exterior Finishes');
    const sidingSF = Math.max(0, d.wallSF - d.openingsSF) + d.gable;
    P('matSiding', 'Siding materials package', 'siding', d.livingSF);
    L('sidingLabor', 'Siding labor', sidingSF * rt.sidingLaborPerSF);
    L('soffitLabor', 'Siding labor — soffits', d.eave * rt.soffitLaborPerEaveLF);
    L('postWraps', 'Post wraps (' + (t.postWraps || 0) + ')', (t.postWraps || 0) * rt.postWrapEach);
    const squares = d.roofSF / 100;
    const rtype = rt.roofingTypes[t.roofingType] || rt.roofingTypes.comp;
    L('roofingMat', 'Roofing material — ' + (t.roofingType || 'comp') + ' (' + r2(squares) + ' sq)', squares * rtype.material);
    L('roofingLabor', 'Roofing labor', squares * rtype.labor);
    L('gutters', 'Gutters & downspouts', d.eave * rt.gutterPerEaveLF + (t.downspouts || 0) * rt.downspoutEach);
    L('extPaint', 'Exterior painting', sidingSF * rt.extPaintPerSF);
    L('driveway', 'Driveway (' + (t.drivewayLen || 0) + '′ × ' + (t.drivewayWidth || 0) + '′)', (t.drivewayLen || 0) * (t.drivewayWidth || 0) * rt.drivewayPerSF);
    L('patio', 'Exterior concrete — patio & walkways', (t.patioSF || 0) * rt.patioPerSF);
    L('garageSlab', 'Garage slab', (t.garageSF || 0) * rt.garageSlabPerSF);
    L('culturedStone', 'Cultured stone', rt.culturedStoneAllowance, 'allowance');

    C('0600', 'HVAC');
    Q('hvac', 'HVAC system', q.hvac, d.livingSF * rt.hvacPerSF);
    if (t.fireplace) L('fireplace', 'Fireplace install & flue', rt.fireplaceAllowance, 'allowance');

    C('0700', 'Plumbing');
    Q('plumbing', 'Plumbing complete', q.plumbing, d.livingSF * rt.plumbingPerSF);

    C('0800', 'Electrical');
    Q('electrical', 'Electrical system', q.electrical, d.livingSF * rt.electricalPerSF);
    L('lowVoltage', 'Low-voltage rough-in', rt.lowVoltage, 'allowance');
    L('evCircuit', 'EV charger circuit', rt.evCircuit, 'allowance');

    C('0900', 'Insulation');
    L('insulation', 'Insulation — walls & ceiling', d.wallSF * rt.insulWallPerSF + d.livingSF * rt.insulCeilPerSF);

    C('1000', 'Interior Wall & Ceiling Finishes');
    const intWallSF = d.livingSF * (rt.intWallLFperSF || 0.125) * 8 * 2; // both faces at ~8' avg
    const drywallSF = d.wallSF + intWallSF + d.livingSF; // ext walls (inside face) + int walls + ceilings
    L('drywall', 'Drywall — hang, tape, texture (' + Math.round(drywallSF) + ' SF)', drywallSF * rt.drywallPerSF);
    L('intPaint', 'Interior paint — walls, ceilings, trim', drywallSF * rt.intPaintPerSF);
    const fb = t.bathsFull || 0, hb = t.bathsHalf || 0;
    L('bathItems', 'Bathroom mirrors, accessories, shower glass & pans (' + fb + ' full / ' + hb + ' half)',
      fb * (rt.perFullBath.showerGlass + rt.perFullBath.showerPan + rt.perFullBath.mirror + rt.perFullBath.accessories) +
      hb * (rt.perHalfBath.mirror + rt.perHalfBath.accessories));

    C('1100', 'Flooring');
    const lvtSF = Math.max(0, d.livingSF - (t.tileSF || 0) - (t.carpetSF || 0));
    L('tile', 'Tile — labor & material (' + (t.tileSF || 0) + ' SF)', (t.tileSF || 0) * (rt.tileLaborPerSF + rt.tileMatPerSF));
    L('lvt', 'LVT / laminate — labor & material (' + lvtSF + ' SF)', lvtSF * (rt.lvtLaborPerSF + rt.lvtMatPerSF));
    if (t.carpetSF > 0) L('carpet', 'Carpet — labor & material (' + t.carpetSF + ' SF)', t.carpetSF * (rt.carpetLaborPerSF + rt.carpetMatPerSF));

    C('1200', 'Woodwork / Cabinets / Millwork');
    L('trimPack', 'Interior trim pack', d.livingSF * rt.trimPackPerSF);
    L('finishLabor', 'Finish carpentry labor', d.livingSF * rt.finishLaborPerSF);
    Q('cabinets', 'Cabinets — supply & install', q.cabinets, (t.kitchenLF || 0) * rt.cabinetsPerLF);
    Q('countertops', 'Countertops', q.countertops, (t.kitchenLF || 0) * rt.counterPerLF);
    L('backsplash', 'Backsplash', (t.kitchenLF || 0) * rt.backsplashPerLF);

    C('1300', 'Appliances & Window Coverings');
    L('appliances', 'Appliances — purchase & install', rt.applianceAllowance, 'allowance');
    L('windowCoverings', 'Window coverings / blinds', (t.windows || 0) * rt.windowCoveringEach);

    C('1500', 'Final Grade & Site');
    L('finalGrade', 'Final grade & rough landscaping', rt.finalGrade, 'allowance');
    if ((t.deckSF || 0) > 0) L('deckStairs', 'Deck stairs', rt.deckStairAllowance, 'allowance');

    const total = r2(cats.reduce((s, c) => s + c.subtotal, 0));
    return { categories: cats, total, derived: d };
  }

  const api = { defaultPriceBook, defaultRates, defaultTakeoff, pitchFactor, computeMaterials, computeQuote, vendorSheet };
  if (typeof window !== 'undefined') window.QuoteEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
