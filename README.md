# MyFlightApi

A simple Node.js REST API to retrieve airport data from a PostgreSQL database.

## Features
- Express.js server
- PostgreSQL connection using `pg`
- CORS and compression middleware
- `/airports` endpoint to fetch airport data (name, coordinates, municipality, IATA code)
- Environment variable support via `.env`

## Requirements
- Node.js (v14+ recommended)
- PostgreSQL database with an `airports` table

## Setup
1. Clone the repository and install dependencies:
   ```sh
   npm install
   ```
2. Create a `.env` file in the root directory with the following variables:
   ```env
   PGUSER=your_pg_user
   PGHOST=your_pg_host
   PGDATABASE=your_pg_database
   PGPASSWORD=your_pg_password
   PGPORT=your_pg_port
   ```
3. Start the server:
   ```sh
   node index.js
   ```
   The server will run on port 4030 by default.

## API Endpoints
### GET `/airports`
Returns a list of airports with the following fields:
- `name`
- `latitude_deg`
- `longitude_deg`
- `municipality`
- `iata_code`

Example response:
```json
{
  "airports": [
    {
      "name": "Los Angeles International Airport",
      "latitude_deg": 33.9425,
      "longitude_deg": -118.4081,
      "municipality": "Los Angeles",
      "iata_code": "LAX"
    },
    ...
  ]
}
```

## License
MIT
