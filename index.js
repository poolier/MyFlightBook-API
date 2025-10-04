require("dotenv").config();
const express = require("express");
const cors = require("cors");
const compression = require("compression");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRETKEY;

// Middleware
app.use(express.json());
app.use(cors());
app.use(compression());

// 🔒 Forcer HTTPS en prod
app.use((req, res, next) => {
  if (req.headers["x-forwarded-proto"] !== "https" && process.env.NODE_ENV === "production") {
    return res.redirect("https://" + req.headers.host + req.url);
  }
  next();
});

// Connexion DB PostgreSQL
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});

// --- ROUTES ---

// Test
app.get("/", (req, res) => {
  res.send("Hello World 🚀 (HTTPS only)");
});

// Liste des aéroports
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
    console.error("Erreur aéroports :", error.message);
    res.status(500).json({ error: error.message });
  }
});

// --- Authentification ---
app.post("/create", async (req, res) => {
  const { email, password, username } = req.body;

  try {
    // Vérifier email
    const existingEmail = await pool.query("SELECT * FROM account WHERE email = $1", [email]);
    if (existingEmail.rows.length > 0) {
      return res.status(400).json({ message: "L'email est déjà utilisé" });
    }

    // Vérifier username
    const existingUsername = await pool.query("SELECT * FROM account WHERE username = $1", [username]);
    if (existingUsername.rows.length > 0) {
      return res.status(400).json({ message: "Le nom d'utilisateur est déjà pris" });
    }

    // Hasher mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insérer
    await pool.query(
      "INSERT INTO account (username, password, email) VALUES ($1, $2, $3)",
      [username, hashedPassword, email]
    );

    res.status(201).json({ message: "Compte créé avec succès" });
  } catch (error) {
    console.error("Erreur création compte :", error.message);
    res.status(500).json({ message: "Erreur lors de la création du compte" });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query("SELECT * FROM account WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Utilisateur non trouvé" });
    }

    const user = result.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: "Mot de passe incorrect" });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, { expiresIn: "23d" });
    res.status(200).json({ message: "Connexion réussie", token });
  } catch (error) {
    console.error("Erreur login :", error.message);
    res.status(500).json({ message: "Erreur interne du serveur" });
  }
});

// --- Gestion des vols ---
app.post("/flights", async (req, res) => {
  const { airport_from, airport_to, flight_date, flight_number, airline, token } = req.body;
  if (!airport_from || !airport_to || !flight_date || !flight_number || !airline || !token) {
    return res.status(400).json({ error: "Tous les paramètres sont requis" });
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    const userEmail = decoded.email;

    const query = `
      INSERT INTO flight (airport_from, airport_to, flight_date, flight_number, airline, user_email)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
    `;
    const values = [airport_from, airport_to, flight_date, flight_number, airline, userEmail];
    const result = await pool.query(query, values);

    res.status(201).json({ message: "Vol ajouté avec succès", flightId: result.rows[0].id });
  } catch (error) {
    console.error("Erreur ajout vol :", error.message);
    res.status(401).json({ error: "Token invalide ou erreur insertion" });
  }
});

app.get("/user-flights", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Token manquant" });

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    const userEmail = decoded.email;
    const result = await pool.query("SELECT * FROM flight WHERE user_email = $1", [userEmail]);
    res.status(200).json({ flights: result.rows });
  } catch (error) {
    console.error("Erreur récupération vols :", error.message);
    res.status(401).json({ error: "Token invalide" });
  }
});

app.get("/user-flightsDemo", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "Email manquant" });

  try {
    const result = await pool.query("SELECT * FROM flight WHERE user_email = $1", [email]);
    res.status(200).json({ flights: result.rows });
  } catch (error) {
    console.error("Erreur récupération vols demo :", error.message);
    res.status(500).json({ error: error.message });
  }
});

// --- Gestion amis ---
app.post("/friendRequest", async (req, res) => {
  const { token, emailReceveur } = req.body;
  if (!token || !emailReceveur) return res.status(400).json({ error: "Tous les paramètres sont requis" });

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    const userEmail = decoded.email;

    await pool.query(
      "INSERT INTO friend_request (email_demandeur, email_receveur) VALUES ($1, $2)",
      [userEmail, emailReceveur]
    );

    res.status(201).json({ message: "Demande envoyée avec succès" });
  } catch (error) {
    console.error("Erreur ajout ami :", error.message);
    res.status(401).json({ error: "Token invalide" });
  }
});

app.get("/friendRequestList", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Token manquant" });

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    const userEmail = decoded.email;
    const result = await pool.query("SELECT * FROM friend_request WHERE email_receveur = $1", [userEmail]);
    res.status(200).json({ requests: result.rows });
  } catch (error) {
    res.status(401).json({ error: "Token invalide" });
  }
});

app.get("/friendList", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Token manquant" });

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    const userEmail = decoded.email;
    const result = await pool.query("SELECT * FROM friend WHERE email_one = $1", [userEmail]);
    res.status(200).json({ friends: result.rows });
  } catch (error) {
    res.status(401).json({ error: "Token invalide" });
  }
});

// Accept friend request (transaction)
app.post("/friendRequestAccept", async (req, res) => {
  const { token, emailReceveur } = req.body;
  if (!token || !emailReceveur) return res.status(400).json({ error: "Tous les paramètres sont requis" });

  const client = await pool.connect();
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    const userEmail = decoded.email;

    await client.query("BEGIN");

    // Insertion réciproque
    await client.query("INSERT INTO friend (email_one, email_two) VALUES ($1, $2)", [userEmail, emailReceveur]);
    await client.query("INSERT INTO friend (email_one, email_two) VALUES ($1, $2)", [emailReceveur, userEmail]);

    // Suppression de la demande
    await client.query(
      "DELETE FROM friend_request WHERE (email_demandeur = $1 AND email_receveur = $2) OR (email_demandeur = $2 AND email_receveur = $1)",
      [userEmail, emailReceveur]
    );

    await client.query("COMMIT");
    res.status(201).json({ message: "Ami ajouté avec succès" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erreur transaction ami :", error.message);
    res.status(500).json({ error: "Erreur lors de l'ajout en amis" });
  } finally {
    client.release();
  }
});

// Récupérer vols d’un ami
app.get("/flightFriend", async (req, res) => {
  const { token, email_two } = req.query;
  if (!token || !email_two) return res.status(400).json({ error: "Paramètres manquants" });

  try {
    jwt.verify(token, SECRET_KEY);
    const result = await pool.query("SELECT * FROM flight WHERE user_email = $1", [email_two]);
    res.status(200).json({ flights: result.rows });
  } catch (error) {
    res.status(401).json({ error: "Token invalide" });
  }
});

// Statistiques vols
app.get("/flightStat", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Token manquant" });

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    const userEmail = decoded.email;

    const query = `
      SELECT f.*,
        da.latitude_deg AS departure_latitude,
        da.longitude_deg AS departure_longitude,
        aa.latitude_deg AS arrival_latitude,
        aa.longitude_deg AS arrival_longitude,
        111.045 * DEGREES(ACOS(
          COS(RADIANS(da.latitude_deg)) * COS(RADIANS(aa.latitude_deg)) *
          COS(RADIANS(da.longitude_deg - aa.longitude_deg)) +
          SIN(RADIANS(da.latitude_deg)) * SIN(RADIANS(aa.latitude_deg))
        )) AS distance_km,
        (111.045 * DEGREES(ACOS(
          COS(RADIANS(da.latitude_deg)) * COS(RADIANS(aa.latitude_deg)) *
          COS(RADIANS(da.longitude_deg - aa.longitude_deg)) +
          SIN(RADIANS(da.latitude_deg)) * SIN(RADIANS(aa.latitude_deg))
        )) / 800) AS estimated_flight_time_hours
      FROM flight f
      INNER JOIN airports da ON f.airport_from = da.iata_code
      INNER JOIN airports aa ON f.airport_to = aa.iata_code
      WHERE f.user_email = $1
    `;
    const result = await pool.query(query, [userEmail]);
    res.status(200).json({ flights: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/flightStatDemo", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "Email manquant" });

  try {
    const query = `
      SELECT f.*,
        da.latitude_deg AS departure_latitude,
        da.longitude_deg AS departure_longitude,
        aa.latitude_deg AS arrival_latitude,
        aa.longitude_deg AS arrival_longitude,
        111.045 * DEGREES(ACOS(
          COS(RADIANS(da.latitude_deg)) * COS(RADIANS(aa.latitude_deg)) *
          COS(RADIANS(da.longitude_deg - aa.longitude_deg)) +
          SIN(RADIANS(da.latitude_deg)) * SIN(RADIANS(aa.latitude_deg))
        )) AS distance_km,
        (111.045 * DEGREES(ACOS(
          COS(RADIANS(da.latitude_deg)) * COS(RADIANS(aa.latitude_deg)) *
          COS(RADIANS(da.longitude_deg - aa.longitude_deg)) +
          SIN(RADIANS(da.latitude_deg)) * SIN(RADIANS(aa.latitude_deg))
        )) / 800) AS estimated_flight_time_hours
      FROM flight f
      INNER JOIN airports da ON f.airport_from = da.iata_code
      INNER JOIN airports aa ON f.airport_to = aa.iata_code
      WHERE f.user_email = $1
    `;
    const result = await pool.query(query, [email]);
    res.status(200).json({ flights: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Lancer serveur ---
app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur le port ${PORT}`);
});
