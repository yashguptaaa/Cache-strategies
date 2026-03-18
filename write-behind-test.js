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

  // Collect all products into an array
  console.log(`   Generating ${COUNT} products...`);
  const products = [];
  for (let i = 1; i <= COUNT; i++) {
    products.push(randomProduct(i));
  }
  console.log(`   ✅ ${products.length} products generated\n`);

  // Send all products in ONE bulk request
  console.log(`   Sending bulk request (${products.length} products as array)...`);
  const start = Date.now();

  try {
    const res = await fetch(`${BASE_URL}/products/write-behind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(products),
    });

    const data = await res.json();
    const totalMs = Date.now() - start;

    console.log(`\n✅ Done!\n`);
    console.log(`   Status:     ${data.status}`);
    console.log(`   Count:      ${data.count} products`);
    console.log(`   Total:      ${totalMs}ms`);
    console.log(`   Message:    ${data.message}`);
    console.log(`\n💡 All ${COUNT} products were pushed to Redis & queued for DB in one batch.`);
    console.log(`   The BullMQ worker is inserting them into PostgreSQL in the background.\n`);
  } catch (err) {
    const totalMs = Date.now() - start;
    console.error(`\n❌ FAILED after ${totalMs}ms: ${err.message}\n`);
  }
}

run();
