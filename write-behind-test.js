#!/usr/bin/env node

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const COUNT = parseInt(process.argv[2] || "100", 10);

const categories = ["Electronics", "Clothing", "Books", "Home", "Sports", "Toys", "Food", "Beauty"];

const adjectives = [
  "Premium", "Ultra", "Smart", "Wireless", "Portable", "Mini", "Pro", "Eco",
  "Turbo", "Classic", "Modern", "Elite", "Compact", "Heavy-Duty", "Slim",
  "Vintage", "Solar", "Magnetic", "Foldable", "Waterproof",
];

const nouns = [
  "Widget", "Gadget", "Speaker", "Charger", "Lamp", "Keyboard", "Mouse",
  "Monitor", "Headphones", "Backpack", "Watch", "Camera", "Sensor", "Hub",
  "Adapter", "Stand", "Dock", "Cable", "Fan", "Bottle",
];

function randomProduct(index) {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const category = categories[Math.floor(Math.random() * categories.length)];
  const price = parseFloat((Math.random() * 200 + 5).toFixed(2));

  return {
    name: `${adj} ${noun} #${index}`,
    price,
    category,
  };
}

async function run() {
  console.log(`\n🚀 Write-Behind Bulk Insert — ${COUNT} products\n`);
  console.log(`   Target: POST ${BASE_URL}/products/write-behind\n`);

  const start = Date.now();
  const results = [];

  for (let i = 1; i <= COUNT; i++) {
    const product = randomProduct(i);
    const t0 = Date.now();

    try {
      const res = await fetch(`${BASE_URL}/products/write-behind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(product),
      });

      const data = await res.json();
      const ms = Date.now() - t0;

      results.push({ i, ms, status: res.status, name: product.name });

      if (i % 10 === 0 || i === 1) {
        console.log(`   [${i}/${COUNT}] ${product.name} → ${ms}ms (${data.status})`);
      }
    } catch (err) {
      results.push({ i, ms: Date.now() - t0, status: "error", name: product.name });
      console.error(`   [${i}/${COUNT}] FAILED: ${err.message}`);
    }
  }

  const totalMs = Date.now() - start;
  const times = results.map((r) => r.ms);
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const successful = results.filter((r) => r.status === 200).length;

  console.log(`\n✅ Done!\n`);
  console.log(`   Total:      ${totalMs}ms`);
  console.log(`   Successful: ${successful}/${COUNT}`);
  console.log(`   Avg:        ${avg}ms per request`);
  console.log(`   Min:        ${min}ms`);
  console.log(`   Max:        ${max}ms`);
  console.log(`\n💡 Check server logs — all ${COUNT} products were cached instantly.`);
  console.log(`   The BullMQ worker is inserting them into PostgreSQL in the background.\n`);
}

run();
