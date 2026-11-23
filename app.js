const form = document.getElementById("search-form");
const input = document.getElementById("place-input");
const difficultySelect = document.getElementById("difficulty");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const weatherEl = document.getElementById("weather");

const MAX_RESULTS = 6;

// שמות רמות הקושי בעברית (הערכים בנתונים נשארים באנגלית)
const DIFFICULTY_HE = { Easy: "קל", Moderate: "בינוני", Hard: "קשה" };

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (!query) return;

  statusEl.textContent = "מחפש…";
  resultsEl.innerHTML = "";
  weatherEl.innerHTML = "";

  const location = await findLocation(query);
  if (!location) {
    statusEl.textContent = `לא מצאנו את "${query}" בישראל. נסו שם אחר.`;
    return;
  }

  showHikes(location);
  showWeather(location);
});

// הופך שם מקום ל- { name, lat, lng }
async function findLocation(query) {
  // 1. רשימת המקומות שלנו (מהיר, עובד גם בלי אינטרנט)
  const key = query.toLowerCase().replace(/['"]/g, "");
  if (PLACES[key]) {
    return { name: query, lat: PLACES[key][0], lng: PLACES[key][1] };
  }

  // 2. שירות המפות החינמי של OpenStreetMap, מוגבל לישראל
  try {
    const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=il&q="
      + encodeURIComponent(query);
    const response = await fetch(url, { headers: { "Accept-Language": "he" } });
    const data = await response.json();
    if (data.length > 0) {
      return {
        name: data[0].display_name.split(",")[0],
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
      };
    }
  } catch (err) {
    console.error("Geocoding failed:", err);
  }
  return null;
}

function showHikes(location) {
  const difficulty = difficultySelect.value;
  // תיבה ריקה = בלי הגבלה
  const maxLength = parseFloat(document.getElementById("max-length").value) || Infinity;
  const maxDistance = parseFloat(document.getElementById("max-distance").value) || Infinity;

  const hikes = TRAILS
    .filter((t) => difficulty === "all" || t.difficulty === difficulty)
    .filter((t) => parseFloat(t.length) <= maxLength) // "3.5 ק״מ" -> 3.5
    .map((t) => ({ ...t, distance: distanceKm(location.lat, location.lng, t.lat, t.lng) }))
    .filter((t) => t.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_RESULTS);

  if (hikes.length === 0) {
    statusEl.textContent = "אין מסלולים שמתאימים לסינון. נסו להגדיל את מגבלת הק״מ או לשנות את רמת הקושי.";
    return;
  }

  statusEl.textContent = `${hikes.length} המסלולים המומלצים ליד ${location.name}:`;
  resultsEl.innerHTML = hikes.map(renderCard).join("");
}

function renderCard(hike) {
  const mapsLink = `https://www.google.com/maps/search/?api=1&query=${hike.lat},${hike.lng}`;
  // מפת Mapeak, בפורמט: /map/{zoom}/{lat}/{lng}
  const mapeakLink = `https://mapeak.com/map/15/${hike.lat}/${hike.lng}`;
  // אתרי טיולים עם תיאור המסלול (חיפוש בגוגל מוגבל לכל אתר)
  const siteSearch = (site) =>
    `https://www.google.com/search?q=${encodeURIComponent(hike.name + " site:" + site)}`;
  const tiuliLink = siteSearch("tiuli.com");
  const masaLink = siteSearch("masa.co.il");
  const baliLink = siteSearch("baliletayel.co.il");
  const nakebLink = siteSearch("nakeb.co.il");
  return `
    <div class="card">
      <h3>${hike.name}</h3>
      <div class="meta">
        <span class="badge ${hike.difficulty}">${DIFFICULTY_HE[hike.difficulty]}</span>
        ${hike.region} · ${hike.length} · ${hike.time} · כ־${Math.round(hike.distance)} ק״מ ממך
      </div>
      <p>${hike.description}</p>
      <div class="links">
        <a href="${mapsLink}" target="_blank" rel="noopener">📍 פתיחה ב־Google Maps ←</a>
        <a href="${mapeakLink}" target="_blank" rel="noopener">🥾 פתיחה ב־Mapeak ←</a>
        <a href="${tiuliLink}" target="_blank" rel="noopener">📝 תיאור באתר טיולי ←</a>
        <a href="${masaLink}" target="_blank" rel="noopener">📝 תיאור באתר מסע אחר ←</a>
        <a href="${baliLink}" target="_blank" rel="noopener">📝 תיאור באתר בא לי לטייל ←</a>
        <a href="${nakebLink}" target="_blank" rel="noopener">📝 תיאור באתר נאקב ←</a>
      </div>
    </div>
  `;
}

// מרחק בקו אווירי בין שתי נקודות (נוסחת Haversine)
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------------- מזג אוויר (Open-Meteo, חינמי, בלי מפתח API) ----------------

// קודי מזג אוויר -> [אייקון, תיאור]  (https://open-meteo.com/en/docs)
function describeWeather(code) {
  if (code === 0) return ["☀️", "בהיר"];
  if (code <= 2) return ["🌤️", "מעונן חלקית"];
  if (code === 3) return ["☁️", "מעונן"];
  if (code <= 48) return ["🌫️", "ערפל"];
  if (code <= 57) return ["🌦️", "טפטוף"];
  if (code <= 67) return ["🌧️", "גשם"];
  if (code <= 77) return ["❄️", "שלג"];
  if (code <= 82) return ["🌧️", "ממטרים"];
  if (code <= 86) return ["🌨️", "ממטרי שלג"];
  return ["⛈️", "סופת רעמים"];
}

async function showWeather(location) {
  weatherEl.innerHTML = "<p>טוען תחזית…</p>";
  try {
    const url = "https://api.open-meteo.com/v1/forecast"
      + `?latitude=${location.lat}&longitude=${location.lng}`
      + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max"
      + "&timezone=Asia%2FJerusalem&forecast_days=5"; // היום + 4 ימים קדימה
    const response = await fetch(url);
    const data = await response.json();
    const d = data.daily;

    const days = d.time.map((date, i) => {
      const [icon, text] = describeWeather(d.weather_code[i]);
      const label = i === 0 ? "היום"
        : new Date(date + "T12:00").toLocaleDateString("he-IL", { weekday: "short", day: "numeric" });
      return `
        <div class="day" title="${text}">
          <div class="name">${label}</div>
          <div class="icon">${icon}</div>
          <div class="desc">${text}</div>
          <div class="temp">${Math.round(d.temperature_2m_max[i])}° / ${Math.round(d.temperature_2m_min[i])}°</div>
          <div class="extra">💧 ${d.precipitation_probability_max[i] ?? 0}%</div>
          <div class="extra">💨 ${Math.round(d.wind_speed_10m_max[i])} קמ״ש</div>
        </div>`;
    }).join("");

    weatherEl.innerHTML = `
      <h2>תחזית מזג האוויר ליד ${location.name} – 5 הימים הקרובים</h2>
      <div class="forecast">${days}</div>
      ${hikingWarnings(d)}`;
  } catch (err) {
    console.error("Weather failed:", err);
    weatherEl.innerHTML = "<p>לא ניתן לטעון את תחזית מזג האוויר כרגע.</p>";
  }
}

// טיפים בטיחותיים לפי התחזית
function hikingWarnings(d) {
  const warnings = [];
  if (Math.max(...d.temperature_2m_max) >= 32) {
    warnings.push("🔥 צפויים ימים חמים — צאו מוקדם, קחו לפחות 3 ליטר מים לאדם, והימנעו ממסלולים מדבריים חשופים בשעות הצהריים.");
  }
  if (Math.max(...d.precipitation_probability_max.map((p) => p ?? 0)) >= 50) {
    warnings.push("🌊 צפוי גשם — אל תיכנסו לקניונים ולערוצי נחלים יבשים (סכנת שיטפונות, במיוחד בנגב, בים המלח ובאזור אילת).");
  }
  if (Math.max(...d.wind_speed_10m_max) >= 40) {
    warnings.push("💨 רוחות חזקות — היזהרו על מצוקים ורכסים חשופים.");
  }
  return warnings.map((w) => `<div class="warning">${w}</div>`).join("");
}
