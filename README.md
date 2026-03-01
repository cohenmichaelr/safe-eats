# 🛡️ Safe Eats USA

Safe Eats USA is a real-time restaurant discovery platform that combines the rich location data of **Google Maps** with official **Florida Health Inspection** records. It allows users to find restaurants and instantly see their safety history via color-coded pins and detailed inspection logs.

## 🚀 Features

- **Interactive Map**: Fully integrated Google Maps JS API with dynamic restaurant markers.
- **Health-Status Pins**: Map pins are color-coded in real-time:
  - 🟢 **Green**: Satisfactory / Pass
  - 🟡 **Yellow**: Warning (Violations found)
  - 🔴 **Red**: Fail (High-risk or Closed)
  - 🔵 **Blue**: Unknown (Record not found)
- **Place Sheets**: Modern Google Maps-style detail sheets with photos, ratings, contact info, and directions.
- **Inspection History**: A 12-month log of past inspections for every restaurant.
- **Smart Search**: "Search this area" functionality as you pan the map.
- **Privacy-First**: API keys are managed via `.env` and never exposed in the source code.

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js, Axios
- **Frontend**: Vanilla JS, Google Maps JS API, CSS3
- **Data**: Google Places API, Florida DOH ArcGIS API, Florida DBPR (CSV Support)

## 📋 Prerequisites

- **Node.js** (v18 or higher)
- **Google Maps API Key**: With *Maps JavaScript API* and *Places API* enabled.
- **Yelp Fusion API Key**: (Optional) For additional review data.

## ⚙️ Installation

1. **Clone the repository**:
   ```bash
   git clone <your-repository-url>
   cd safe-eats-usa
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Create a `.env` file in the root directory and add your keys:
   ```env
   PORT=3000
   APP_API_KEY=your_secret_backend_key
   GOOGLE_MAPS_API_KEY=AIza...
   YELP_API_KEY=...
   ```

## 🧪 Running the App

1. **Start the server**:
   ```bash
   npm start
   ```
2. **Open your browser**: Go to `http://localhost:3000`

## 📊 Real-Time Florida Data

By default, the app uses **Smart Mock Data** for regular restaurants to ensure the UI is functional. To use **100% Real Florida DBPR Data**:

1. Download the latest CSV from the [Official Florida DBPR Portal](https://www.myfloridalicense.com/dbpr/hr/inspections/StatewideFoodServiceInspectionsFY2425.csv).
2. Save it as `florida_inspections_2024_2025.csv` in the `data/` folder.
3. The server will automatically detect the file and switch to real records.

---
Created by [Michael Cohen](mailto:cohenmichaelr@gmail.com)
