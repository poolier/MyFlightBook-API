// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const compression = require("compression");
const app = express();
const PORT = 4030;
const { Pool } = require("pg");

// Middleware pour parser du JSON
app.use(express.json());
app.use(cors());
app.use(compression())

const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});

app.get('/airports', async (req, res) => {
  try {
    const query = `
      SELECT name, latitude_deg, longitude_deg, municipality, iata_code
      FROM airports
      WHERE iata_code <> ''
    `;
    const result = await pool.query(query);

    res.status(200).json({ airports: result.rows });
  } catch (error) {
    console.error("Erreur lors de la récupération des aéroports :", error.message);
    res.status(500).json({ error: "Erreur lors de la récupération des aéroports", details: error.message });
  }
});

// Lancer le serveur
app.listen(PORT, () => {
  console.log(`Serveur lancé sur ${PORT}`);
});
