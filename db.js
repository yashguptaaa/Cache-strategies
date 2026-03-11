require("dotenv").config();
const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;
const DB_DELAY_MS = parseInt(process.env.DB_DELAY_MS || "0", 10);

let pool = null;

function getPool() {
  if (!pool) {
    if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
    const url = new URL(
      DATABASE_URL.replace(/^postgres:\/\//, "postgresql://"),
    );
    const config = {
      host: url.hostname,
      port: url.port || 5432,
      database: url.pathname.slice(1).replace(/\/.*$/, "") || undefined,
      user: url.username || undefined,
      password:
        url.password !== undefined && url.password !== "" ? url.password : "",
      ssl:
        url.searchParams.get("sslmode") === "require"
          ? { rejectUnauthorized: false }
          : undefined,
    };
    pool = new Pool(config);
  }
  return pool;
}

async function init() {}

async function getProductById(id) {
  const productId = parseInt(id, 10);
  if (Number.isNaN(productId)) return null;

  if (DB_DELAY_MS > 0) {
    await new Promise((r) => setTimeout(r, DB_DELAY_MS));
  }

  const p = getPool();
  const result = await p.query(
    "SELECT id, name, price, category FROM products WHERE id = $1",
    [productId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    price: parseFloat(row.price),
    category: row.category,
  };
}

async function getAllProducts() {
  if (DB_DELAY_MS > 0) {
    await new Promise((r) => setTimeout(r, DB_DELAY_MS));
  }

  const p = getPool();
  const result = await p.query(
    "SELECT id, name, price, category FROM products ORDER BY id",
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: parseFloat(row.price),
    category: row.category,
  }));
}

async function insertProduct(name, price, category) {
  if (DB_DELAY_MS > 0) {
    await new Promise((r) => setTimeout(r, DB_DELAY_MS));
  }

  const p = getPool();
  const result = await p.query(
    "INSERT INTO products (name, price, category) VALUES ($1, $2, $3) RETURNING id, name, price, category",
    [name, price, category],
  );
  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    price: parseFloat(row.price),
    category: row.category,
  };
}

/**
 * Partial update of a product by id. Only provided fields are updated.
 * @returns {Promise<object|null>} Updated product or null if not found
 */
async function updateProduct(id, patch) {
  const productId = parseInt(id, 10);
  if (Number.isNaN(productId)) return null;

  const p = getPool();
  const updates = [];
  const values = [];
  let i = 1;
  if (patch.name !== undefined) {
    updates.push(`name = $${i++}`);
    values.push(patch.name);
  }
  if (patch.price !== undefined) {
    updates.push(`price = $${i++}`);
    values.push(patch.price);
  }
  if (patch.category !== undefined) {
    updates.push(`category = $${i++}`);
    values.push(patch.category);
  }
  if (updates.length === 0) return getProductById(id);

  values.push(productId);
  const result = await p.query(
    `UPDATE products SET ${updates.join(", ")} WHERE id = $${i} RETURNING id, name, price, category`,
    values,
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    price: parseFloat(row.price),
    category: row.category,
  };
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  getProductById,
  getAllProducts,
  insertProduct,
  updateProduct,
  init,
  close,
};
