const form = document.getElementById("search-form");
const input = document.getElementById("place-input");
const minRatingSelect = document.getElementById("min-rating");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const weatherEl = document.getElementById("weather");

const MAX_RESULTS = 8;            // כמה מסלולים להציג
const MIN_HIKE_REVIEWS = 50;      // מקום נכלל רק עם 50 ביקורות ומעלה (מסנן פינות זניחות)
const DEFAULT_RADIUS_KM = 20;     // טווח חיפוש כשלא הוזן מרחק
const MAX_RADIUS_KM = 50;         // הטווח המקסימלי שגוגל מאפשר

// סוגי המקומות שמחפשים בגוגל: אזורי טיול, גנים לאומיים ושמורות טבע
const HIKE_TYPES = ["hiking_area", "national_park", "nature_preserve", "state_park"];

// מקומות שהסוג הראשי שלהם לינה או חניון – לא נכללים (גם לא במסעדות)
const EXCLUDED_TYPES = ["hotel", "lodging", "guest_house", "hostel", "inn", "motel",
  "resort_hotel", "bed_and_breakfast", "extended_stay_hotel", "cottage", "farmstay",
  "parking", "parking_lot"];

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (!query) return;

  statusEl.textContent = "מחפש…";
  resultsEl.innerHTML = "";
  weatherEl.innerHTML = "";
  restaurantsEl.innerHTML = "";

  const location = await findLocation(query);
  if (!location) {
    statusEl.textContent = `לא מצאנו את "${query}" בישראל. נסו שם אחר.`;
    return;
  }

  showHikes(location);
  showWeather(location);
  showRestaurants(location);
});

// הופך שם מקום ל- { name, lat, lng }
async function findLocation(query) {
  // 1. רשימת המקומות שלנו (מהיר, תומך בעברית ובאנגלית)
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

// ---------------- מסלולים (חיפוש דינמי ב-Google Places) ----------------
async function showHikes(location) {
  const minRating = parseFloat(minRatingSelect.value) || 0;
  const userKm = parseFloat(document.getElementById("max-distance").value);
  const radiusKm = Math.min(userKm || DEFAULT_RADIUS_KM, MAX_RADIUS_KM);

  statusEl.textContent = "מחפש מסלולים באזור…";
  try {
    let hikes = pickTopHikes(await searchHikes(location, radiusKm), minRating);
    // בלי מרחק שהמשתמש קבע ומעט תוצאות – מרחיבים את החיפוש
    if (!userKm && hikes.length < 3) {
      hikes = pickTopHikes(await searchHikes(location, MAX_RADIUS_KM), minRating);
    }

    if (hikes.length === 0) {
      statusEl.textContent = "לא נמצאו מסלולים שמתאימים לחיפוש. נסו להגדיל את המרחק או להוריד את הדירוג המינימלי.";
      return;
    }

    const capNote = userKm > MAX_RADIUS_KM ? ` (החיפוש מוגבל ל-${MAX_RADIUS_KM} ק״מ)` : "";
    statusEl.textContent = `${hikes.length} המסלולים המומלצים ליד ${location.name}${capNote}:`;
    resultsEl.innerHTML = hikes.map((h) => renderCard(h, location)).join("");
  } catch (err) {
    console.error("Hikes failed:", err);
    statusEl.textContent = "לא ניתן לטעון מסלולים כרגע. נסו שוב בעוד רגע.";
  }
}

// מבקש מגוגל עד 20 אזורי טיול פופולריים בטווח, ומשאיר רק את מה שבתוך הטווח באמת
async function searchHikes(location, radiusKm) {
  const places = await searchNearbyPlaces(location, radiusKm * 1000, HIKE_TYPES, [
    "displayName", "rating", "userRatingCount", "location", "googleMapsUri",
    "primaryType", "primaryTypeDisplayName", "editorialSummary",
  ]);
  return places
    .filter((p) => p.location)
    .map((p) => ({
      ...p,
      distance: distanceKm(location.lat, location.lng, p.location.latitude, p.location.longitude),
    }))
    .filter((p) => p.distance <= radiusKm);
}

// 50+ ביקורות, דירוג מינימלי, בלי מלונות/חניונים; ממוין לפי דירוג ואז מספר ביקורות
function pickTopHikes(places, minRating) {
  return places
    .filter((p) => p.rating && p.rating >= minRating)
    .filter((p) => (p.userRatingCount || 0) >= MIN_HIKE_REVIEWS)
    .filter((p) => !EXCLUDED_TYPES.includes(p.primaryType))
    .sort((a, b) => b.rating - a.rating || b.userRatingCount - a.userRatingCount)
    .slice(0, MAX_RESULTS);
}

function renderCard(hike, location) {
  const name = hike.displayName?.text || "";
  const lat = hike.location.latitude;
  const lng = hike.location.longitude;
  const mapsLink = hike.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  // מפת Mapeak, בפורמט: /map/{zoom}/{lat}/{lng}
  const mapeakLink = `https://mapeak.com/map/15/${lat}/${lng}`;
  // אתרי טיולים עם תיאור המסלול (חיפוש בגוגל מוגבל לכל אתר)
  const siteSearch = (site) =>
    `https://www.google.com/search?q=${encodeURIComponent(name + " site:" + site)}`;
  const type = hike.primaryTypeDisplayName?.text;
  const summary = hike.editorialSummary?.text;
  return `
    <div class="card">
      <h3>${escapeHtml(name)}</h3>
      <div class="meta">
        <span class="stars">⭐ ${hike.rating.toFixed(1)}</span>
        (${hike.userRatingCount.toLocaleString("he-IL")} ביקורות)${type ? " · " + escapeHtml(type) : ""}
        · כ־${Math.round(hike.distance)} ק״מ מ${escapeHtml(location.name)}
      </div>
      ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
      <div class="links">
        <a href="${escapeHtml(mapsLink)}" target="_blank" rel="noopener">📍 פתיחה ב־Google Maps ←</a>
        <a href="${mapeakLink}" target="_blank" rel="noopener">🥾 פתיחה ב־Mapeak ←</a>
        <a href="${siteSearch("tiuli.com")}" target="_blank" rel="noopener">📝 תיאור באתר טיולי ←</a>
        <a href="${siteSearch("masa.co.il")}" target="_blank" rel="noopener">📝 תיאור באתר מסע אחר ←</a>
        <a href="${siteSearch("baliletayel.co.il")}" target="_blank" rel="noopener">📝 תיאור באתר בא לי לטייל ←</a>
        <a href="${siteSearch("nakeb.co.il")}" target="_blank" rel="noopener">📝 תיאור באתר נאקב ←</a>
      </div>
    </div>
  `;
}

// חיפוש מקומות ליד נקודה ב-Google Places API (New) – משמש גם למסלולים וגם למסעדות
async function searchNearbyPlaces(location, radiusMeters, includedTypes, fields) {
  const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_API_KEY,
      "X-Goog-FieldMask": fields.map((f) => "places." + f).join(","),
    },
    body: JSON.stringify({
      includedTypes,
      maxResultCount: 20,
      rankPreference: "POPULARITY",
      languageCode: "he",
      locationRestriction: {
        circle: { center: { latitude: location.lat, longitude: location.lng }, radius: radiusMeters },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Places API ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  return data.places || [];
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

// ---------------- מסעדות (Google Places API New) ----------------
const restaurantsEl = document.getElementById("restaurants");
const MIN_REVIEWS = 200;     // מסעדה נכללת רק עם 200 ביקורות ומעלה
const MAX_RESTAURANTS = 6;

const PRICE_LEVELS = {
  PRICE_LEVEL_INEXPENSIVE: "מחיר זול",
  PRICE_LEVEL_MODERATE: "מחיר בינוני",
  PRICE_LEVEL_EXPENSIVE: "יקר",
  PRICE_LEVEL_VERY_EXPENSIVE: "יקר מאוד",
};

async function showRestaurants(location) {
  if (!GOOGLE_API_KEY) return; // אין מפתח – לא מציגים את האזור

  restaurantsEl.innerHTML = "<p>טוען מסעדות…</p>";
  try {
    // קודם ברדיוס 5 ק״מ; אם יש מעט תוצאות, מרחיבים ל-20 ק״מ
    let top = pickTopRestaurants(await searchRestaurants(location, 5000));
    if (top.length < 3) {
      top = pickTopRestaurants(await searchRestaurants(location, 20000));
    }

    if (top.length === 0) {
      restaurantsEl.innerHTML = `<h2>🍽️ מסעדות מומלצות ליד ${escapeHtml(location.name)}</h2>
        <p>לא נמצאו בסביבה מסעדות עם ${MIN_REVIEWS} ביקורות או יותר.</p>`;
      return;
    }

    restaurantsEl.innerHTML = `
      <h2>🍽️ מסעדות מומלצות ליד ${escapeHtml(location.name)}</h2>
      <p class="sub">המדורגות ביותר בגוגל, עם ${MIN_REVIEWS} ביקורות ומעלה</p>
      <div class="restaurant-grid">
        ${top.map((r) => renderRestaurant(r, location)).join("")}
      </div>
      <p class="attribution">נתוני מסעדות: Google Maps</p>`;
  } catch (err) {
    console.error("Restaurants failed:", err);
    restaurantsEl.innerHTML = "<p>לא ניתן לטעון המלצות למסעדות כרגע.</p>";
  }
}

// חיפוש מסעדות ליד נקודה (עד 20 תוצאות, לפי פופולריות)
function searchRestaurants(location, radiusMeters) {
  return searchNearbyPlaces(location, radiusMeters, ["restaurant"], [
    "displayName", "rating", "userRatingCount", "formattedAddress", "googleMapsUri",
    "location", "priceLevel", "primaryType", "primaryTypeDisplayName",
  ]);
}

// רק 200+ ביקורות, בלי בתי מלון, ממוינות לפי דירוג (ובשוויון – לפי מספר ביקורות)
function pickTopRestaurants(places) {
  return places
    .filter((p) => (p.userRatingCount || 0) >= MIN_REVIEWS && p.rating)
    .filter((p) => !EXCLUDED_TYPES.includes(p.primaryType))
    .sort((a, b) => b.rating - a.rating || b.userRatingCount - a.userRatingCount)
    .slice(0, MAX_RESTAURANTS);
}

function renderRestaurant(place, location) {
  const name = escapeHtml(place.displayName?.text || "");
  const type = escapeHtml(place.primaryTypeDisplayName?.text || "מסעדה");
  const address = escapeHtml(place.formattedAddress || "");
  const price = PRICE_LEVELS[place.priceLevel] || "";
  const km = place.location
    ? Math.round(distanceKm(location.lat, location.lng, place.location.latitude, place.location.longitude) * 10) / 10
    : null;
  return `
    <div class="restaurant">
      <h3>${name}</h3>
      <div class="rating">⭐ ${place.rating.toFixed(1)} <span>(${place.userRatingCount.toLocaleString("he-IL")} ביקורות)</span></div>
      <div class="meta">${type}${price ? " · " + price : ""}${km !== null ? ` · כ־${km} ק״מ` : ""}</div>
      <div class="address">${address}</div>
      <a href="${escapeHtml(place.googleMapsUri || "")}" target="_blank" rel="noopener">📍 פתיחה ב־Google Maps ←</a>
    </div>`;
}

// מונע הזרקת HTML מתוך שמות וכתובות שמגיעים מגוגל
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
