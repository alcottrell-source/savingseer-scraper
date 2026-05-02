// seed.js
// Re-seeds the brands table in Supabase with gender tags and cluster from brands.js.
// Run after applying supabase/migrations/20260502_add_personalisation.sql.
//
// Usage: node seed.js

import { createClient } from '@supabase/supabase-js';
import { brands } from './brands.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function seedBrands() {
  console.log(`Seeding ${brands.length} brands...`);

  const rows = brands.map(b => ({
    id:            b.id,
    name:          b.name,
    cluster:       b.cluster,
    womenswear:    b.womenswear,
    menswear:      b.menswear,
    childrenswear: b.childrenswear,
  }));

  const { error } = await supabase
    .from('brands')
    .upsert(rows, { onConflict: 'id' });

  if (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  }

  console.log(`✓ Seeded ${rows.length} brands`);

  // Verification: check no brand has all three flags false
  const invalid = brands.filter(b => !b.womenswear && !b.menswear && !b.childrenswear);
  if (invalid.length > 0) {
    console.warn(`⚠ ${invalid.length} brand(s) have all gender flags false (excluded from all personal scores):`);
    invalid.forEach(b => console.warn(`  - ${b.id} ${b.name}`));
  } else {
    console.log('✓ All brands have at least one gender flag set');
  }
}

seedBrands().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
