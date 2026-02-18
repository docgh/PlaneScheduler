const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

async function initializeDatabase() {
  const connection = await pool.getConnection();
  try {
    // Read and execute schema
    const schema = fs.readFileSync(
      path.join(__dirname, 'schema.sql'),
      'utf8'
    );

    // Split on semicolons, filter blanks, execute each statement
    const statements = schema
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    for (const stmt of statements) {
      await connection.query(stmt);
    }

    console.log('Database initialized successfully');
  } catch (err) {
    // If tables already exist that's fine, just log other errors
    if (err.code !== 'ER_TABLE_EXISTS_ERROR') {
      console.error('Database initialization error:', err.message);
    }
  } finally {
    connection.release();
  }
}

module.exports = { initializeDatabase };
