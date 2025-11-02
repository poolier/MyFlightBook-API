require("dotenv").config();
const express = require("express");
const cors = require("cors");
const compression = require("compression");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
// import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRETKEY;
const GoogleMapsKey = process.env.GOOGLEMAPSKEY;

const placesLimiter = rateLimit({
  windowMs: 5 * 1000, // 5 secondes
  max: 1, // 1 requête par fenêtre
  message: { error: "Trop de requêtes. Réessayez dans quelques secondes." },
  standardHeaders: true, // Ajoute les headers RateLimit-* dans la réponse
  legacyHeaders: false,  // Supprime les anciens headers X-RateLimit-*
});


// Middleware
app.use(express.json());
const allowedOrigins = [
  "https://flight.lolprostat.com",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);
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
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING flight_id
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
  da.latitude_deg::float AS departure_latitude,
  da.longitude_deg::float AS departure_longitude,
  aa.latitude_deg::float AS arrival_latitude,
  aa.longitude_deg::float AS arrival_longitude,
  111.045 * DEGREES(ACOS(
    COS(RADIANS(da.latitude_deg::float)) * COS(RADIANS(aa.latitude_deg::float)) *
    COS(RADIANS(da.longitude_deg::float - aa.longitude_deg::float)) +
    SIN(RADIANS(da.latitude_deg::float)) * SIN(RADIANS(aa.latitude_deg::float))
  )) AS distance_km,
  (111.045 * DEGREES(ACOS(
    COS(RADIANS(da.latitude_deg::float)) * COS(RADIANS(aa.latitude_deg::float)) *
    COS(RADIANS(da.longitude_deg::float - aa.longitude_deg::float)) +
    SIN(RADIANS(da.latitude_deg::float)) * SIN(RADIANS(aa.latitude_deg::float))
  )) / 800) AS estimated_flight_time_hours
FROM flight f
INNER JOIN airports da ON f.airport_from = da.iata_code
INNER JOIN airports aa ON f.airport_to = aa.iata_code
WHERE f.user_email = $1;
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

app.post("/placesSearch", placesLimiter, async (req, res) => {
  try {
    const body = req.body;

    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GoogleMapsKey,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location,places.types,places.id,places.rating,places.userRatingCount,places.businessStatus,places.primaryTypeDisplayName,places.primaryType",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Erreur Google Places :", errorText);
      return res.status(response.status).json({ error: "Erreur depuis Google Places API", details: errorText });
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    console.error("Erreur /placesSearch :", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Requête de lieux 
app.get("/placesDetails", async (req, res) => {
  const { googlemapid } = req.query;
  if (!googlemapid) return res.status(400).json({ error: "Place ID is missing" });

  try {
    // 1️⃣ Vérifie si le lieu est déjà en base
    const placeQuery = "SELECT * FROM place WHERE googlemapid = $1";
    const placeResult = await pool.query(placeQuery, [googlemapid]);

    if (placeResult.rows.length > 0) {
      return res.status(200).json({ data: placeResult.rows[0] });
    }

    // 2️⃣ Appel Google Places API
    const response = await fetch(`https://places.googleapis.com/v1/places/${googlemapid}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GoogleMapsKey,
        "X-Goog-FieldMask": "displayName,formattedAddress,rating,userRatingCount,location,photos,reviews,primaryType,types,regularOpeningHours,priceLevel,websiteUri,nationalPhoneNumber",
      },
    });

    if (!response.ok) {
      throw new Error("Erreur lors de l'appel à Google Places API");
    }

    const placeData = await response.json();
    const {
      displayName,
      formattedAddress,
      rating,
      userRatingCount,
      location,
      photos,
      primaryType,
      types,
      priceLevel,
      websiteUri,
      nationalPhoneNumber,
      regularOpeningHours,
      reviews,
    } = placeData;

    const latitude = location?.latitude || null;
    const longitude = location?.longitude || null;

    // 3️⃣ Récupère les URL finales des photos
    let photosUrls = [];

    if (photos && photos.length > 0) {
      // Création d'un tableau de promesses pour récupérer les URLs finales
      const photoPromises = photos.map(async (p) => {
        if (!p.name) return null;

        const photoUrl = `https://places.googleapis.com/v1/${p.name}/media?maxHeightPx=800&key=${GoogleMapsKey}`;

        try {
          const response = await fetch(photoUrl, { method: "GET", redirect: "manual" });

          if (response.status === 302) {
            // On récupère l'URL finale dans l'en-tête Location
            return response.headers.get("location");
          } else if (response.ok) {
            // Pas de redirection : on garde l'URL directe
            return photoUrl;
          }
        } catch (err) {
          console.error("Erreur récupération photo :", err.message);
          return null;
        }
      });

      // On attend que toutes les promesses soient résolues
      const resolvedUrls = await Promise.all(photoPromises);

      // On filtre les null
      photosUrls = resolvedUrls.filter(Boolean);
    }

    // 4️⃣ Insertion en base
    const insertQuery = `
      INSERT INTO place (
        googlemapid,
        display_name,
        formatted_address,
        rating,
        user_rating_count,
        latitude,
        longitude,
        photos,
        primary_type,
        types,
        price_level,
        website_uri,
        national_phone_number,
        review,
        horaire
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *;
    `;

    const insertValues = [
      googlemapid,
      displayName?.text || displayName || null,
      formattedAddress || null,
      rating || null,
      userRatingCount || null,
      latitude,
      longitude,
      JSON.stringify(photosUrls), // 🔹 on stocke ici les URL directes des images
      primaryType || null,
      types ? JSON.stringify(types) : null,
      priceLevel || null,
      websiteUri || null,
      nationalPhoneNumber || null,
      reviews ? JSON.stringify(reviews) : null,
      regularOpeningHours ? JSON.stringify(regularOpeningHours) : null,
    ];

    const insertResult = await pool.query(insertQuery, insertValues);
    return res.status(201).json({ data: insertResult.rows[0] });
  } catch (error) {
    console.error("Erreur /placesDetails :", error.message);
    res.status(500).json({ error: error.message });
  }
});


app.post("/togglePlaceLoved", async (req, res) => {
  const { googlemapid, user_id } = req.body; // ou googlemapid selon ton modèle

  if (!googlemapid || !user_id) {
    return res.status(400).json({ error: "place_id et user_id requis" });
  }

  try {
    // 1. Transformation googlemapid en place_id
    const [rows] = await db.execute(
      "SELECT id FROM place WHERE googlemapid = ?",
      [googlemapid]
    );

    let place_id = rows[0].id

    const [rows2] = await db.execute(
      "SELECT * FROM place_loved WHERE place_id = ? AND account_id = ?",
      [place_id, user_id]
    );

    if (rows.length > 0) {
      // 2️⃣ Déjà présent → on supprime
      await db.execute(
        "DELETE FROM place_loved WHERE place_id = ? AND user_id = ?",
        [place_id, user_id]
      );
      return res.json({ loved: false, message: "Lieu retiré des favoris" });
    } else {
      // 3️⃣ Pas encore aimé → on ajoute
      await db.execute(
        "INSERT INTO place_loved (place_id, user_id, created_at) VALUES (?, ?, NOW())",
        [place_id, user_id]
      );
      return res.json({ loved: true, message: "Lieu ajouté aux favoris" });
    }
  } catch (err) {
    console.error("Erreur SQL:", err);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
});


// --- Lancer serveur ---
app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur le port ${PORT}`);
});

