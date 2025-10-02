require("dotenv").config();
const express = require("express");
const cors = require("cors");
const compression = require("compression");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware pour parser du JSON
app.use(express.json());
app.use(cors());
app.use(compression());

// 🔒 Middleware pour forcer HTTPS
app.use((req, res, next) => {
  if (req.headers["x-forwarded-proto"] !== "https") {
    return res.redirect("https://" + req.headers.host + req.url);
  }
  next();
});

// Connexion DB
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});

// Routes
app.get("/", (req, res) => {
  res.send("Hello World 🚀 (HTTPS only)");
});

app.get("/airports", async (req, res) => {
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
    res.status(500).json({
      error: "Erreur lors de la récupération des aéroports",
      details: error.message,
    });
  }
});

// Lancer le serveur
app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur le port ${PORT}`);
});
