const form = document.getElementById("search-form");
const input = document.getElementById("place-input");
const minRatingSelect = document.getElementById("min-rating");
const difficultySelect = document.getElementById("difficulty");
const maxLengthInput = document.getElementById("max-length");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const weatherEl = document.getElementById("weather");

const MAX_RESULTS = 8;            // כמה מסלולים להציג
const MIN_HIKE_REVIEWS = 50;      // מקום נכלל רק עם 50 ביקורות ומעלה (מסנן פינות זניחות)
const DEFAULT_RADIUS_KM = 20;     // טווח חיפוש כשלא הוזן מרחק
const MAX_RADIUS_KM = 50;         // הטווח המקסימלי שגוגל מאפשר

// שמות דרגות הקושי בעברית (הערכים בקוד נשארים באנגלית)
const DIFFICULTY_HE = { Easy: "קל", Moderate: "בינוני", Hard: "קשה" };

// סוגי המקומות שמחפשים בגוגל: אזורי טיול, גנים לאומיים ושמורות טבע
const HIKE_TYPES = ["hiking_area", "national_park", "nature_preserve", "state_park"];

// מקומות שהסוג הראשי שלהם לינה או חניון – לא נכללים (גם לא במסעדות)
const EXCLUDED_TYPES = ["hotel", "lodging", "guest_house", "hostel", "inn", "motel",
  "resort_hotel", "bed_and_breakfast", "extended_stay_hotel", "cottage", "farmstay",
  "parking", "parking_lot"];

// מקומות מעבר לגבול (למשל עקבה מול אילת) – לא נכללים
const FOREIGN_COUNTRIES = ["ירדן", "מצרים", "לבנון", "סוריה", "Jordan", "Egypt", "Lebanon", "Syria"];
function isAbroad(place) {
  const address = place.formattedAddress || "";
  return FOREIGN_COUNTRIES.some((country) => address.endsWith(country));
}

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
  const filters = {
    minRating: parseFloat(minRatingSelect.value) || 0,
    difficulty: difficultySelect.value,                         // "all" / Easy / Moderate / Hard
    maxLength: parseFloat(maxLengthInput.value) || Infinity,    // תיבה ריקה = בלי הגבלה
  };
  const userKm = parseFloat(document.getElementById("max-distance").value);
  const radiusKm = Math.min(userKm || DEFAULT_RADIUS_KM, MAX_RADIUS_KM);

  statusEl.textContent = "מחפש מסלולים באזור…";
  try {
    let hikes = await findHikes(location, radiusKm, filters);
    // בלי מרחק שהמשתמש קבע ומעט תוצאות – מרחיבים את החיפוש
    if (!userKm && hikes.length < 3) {
      hikes = await findHikes(location, MAX_RADIUS_KM, filters);
    }

    if (hikes.length === 0) {
      statusEl.textContent = "לא נמצאו מסלולים שמתאימים לחיפוש. נסו להגדיל את המרחק או את האורך, או לשנות את דרגת הקושי והדירוג.";
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
    "primaryType", "primaryTypeDisplayName", "editorialSummary", "formattedAddress",
  ]);
  return places
    .filter((p) => p.location)
    .map((p) => ({
      ...p,
      distance: distanceKm(location.lat, location.lng, p.location.latitude, p.location.longitude),
    }))
    .filter((p) => p.distance <= radiusKm);
}

// מחפש, מעריך אורך וקושי לכל מקום, מסנן לפי הפילטרים וממיין לפי דירוג
async function findHikes(location, radiusKm, filters) {
  const candidates = qualifyHikes(await searchHikes(location, radiusKm), filters.minRating);
  await addEstimates(candidates);
  return candidates
    .filter((h) => filters.difficulty === "all" || h.estimate.difficulty === filters.difficulty)
    .filter((h) => h.estimate.km <= filters.maxLength)
    .sort((a, b) => b.rating - a.rating || b.userRatingCount - a.userRatingCount)
    .slice(0, MAX_RESULTS);
}

// 50+ ביקורות, דירוג מינימלי, בלי מלונות/חניונים ובלי מקומות מעבר לגבול
function qualifyHikes(places, minRating) {
  return places
    .filter((p) => p.rating && p.rating >= minRating)
    .filter((p) => (p.userRatingCount || 0) >= MIN_HIKE_REVIEWS)
    .filter((p) => !EXCLUDED_TYPES.includes(p.primaryType) && !isAbroad(p));
}

// ---------------- הערכת אורך ודרגת קושי ----------------
// 1. אם המקום תואם מסלול מוכר (known-trails.js) – לוקחים את הנתונים משם.
// 2. אחרת – הערכה לפי הפרשי הגובה סביב המקום (Open-Meteo Elevation, חינמי):
//    פחות מ-100 מ׳ = קל, 100–280 מ׳ = בינוני, מעל 280 מ׳ = קשה.
//    האורך: בסיס לפי סוג המקום, ועוד 1–2 ק״מ בשטח הררי.
const RELIEF_EASY_MAX = 100;       // מטרים
const RELIEF_MODERATE_MAX = 280;   // מטרים
const SAMPLE_OFFSET_KM = 1.2;      // כמה רחוק מהמקום מודדים גובה (4 כיוונים)
const BASE_KM_BY_TYPE = { hiking_area: 5, nature_preserve: 4, state_park: 4, national_park: 3 };
const DEFAULT_BASE_KM = 4;

// מילים כלליות שלא עוזרות לזהות מסלול לפי שם
const GENERIC_WORDS = ["שמורת", "שמורה", "טבע", "גן", "לאומי", "פארק", "נחל", "הר", "עין",
  "מסלול", "יער", "מפל", "מפלי", "חניון", "לילה", "שביל", "מערות"];

async function addEstimates(hikes) {
  const unknown = [];
  for (const hike of hikes) {
    const known = matchKnownTrail(hike);
    if (known) {
      hike.estimate = { km: known.km, difficulty: known.difficulty, source: "known" };
    } else {
      unknown.push(hike);
    }
  }
  if (unknown.length === 0) return;

  let reliefs = [];
  try {
    reliefs = await fetchReliefs(unknown.map((h) => h.location));
  } catch (err) {
    console.error("Elevation failed:", err); // בלי נתוני גובה – הערכה לפי סוג המקום בלבד
  }
  unknown.forEach((hike, i) => {
    hike.estimate = estimateFromTerrain(hike.primaryType, reliefs[i]);
  });
}

function estimateFromTerrain(type, relief) {
  let difficulty = "Moderate";
  let extraKm = 1;
  if (Number.isFinite(relief)) {
    if (relief < RELIEF_EASY_MAX) { difficulty = "Easy"; extraKm = 0; }
    else if (relief < RELIEF_MODERATE_MAX) { difficulty = "Moderate"; extraKm = 1; }
    else { difficulty = "Hard"; extraKm = 2; }
  }
  return { km: (BASE_KM_BY_TYPE[type] || DEFAULT_BASE_KM) + extraKm, difficulty, source: "estimate" };
}

// מקום תואם מסלול מוכר אם יש להם מילה משמעותית משותפת בשם והוא במרחק עד KNOWN_MATCH_KM ממנו
// (נחלים ארוכים – לגוגל ולנו יכולות להיות נקודות שונות לאורך אותו נחל)
const KNOWN_MATCH_KM = 8;
function matchKnownTrail(hike) {
  const words = significantWords(hike.displayName?.text || "");
  return KNOWN_TRAILS.find((trail) =>
    distanceKm(hike.location.latitude, hike.location.longitude, trail.lat, trail.lng) <= KNOWN_MATCH_KM &&
    significantWords(trail.name).some((w) => words.some((v) => sameWord(w, v))));
}

function significantWords(name) {
  return name.split(/[\s\-–(),'"׳]+/).filter((w) => w.length >= 3 && !GENERIC_WORDS.includes(w));
}

// "סטף" ו"הסטף" נחשבות אותה מילה (אות אחת נוספת בהתחלה, כמו ה' הידיעה)
function sameWord(a, b) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long === short || (long.length - short.length === 1 && long.endsWith(short));
}

// מודד גובה במרכז המקום ו-4 נקודות סביבו; מחזיר לכל מקום את ההפרש בין הגבוה לנמוך
async function fetchReliefs(locations) {
  const POINTS = 5;
  const lats = [];
  const lngs = [];
  for (const loc of locations) {
    const dLat = SAMPLE_OFFSET_KM / 111;
    const dLng = SAMPLE_OFFSET_KM / (111 * Math.cos((loc.latitude * Math.PI) / 180));
    for (const [a, b] of [[0, 0], [dLat, 0], [-dLat, 0], [0, dLng], [0, -dLng]]) {
      lats.push((loc.latitude + a).toFixed(4));
      lngs.push((loc.longitude + b).toFixed(4));
    }
  }
  // השירות מקבל עד 100 נקודות בבקשה
  const elevations = [];
  for (let i = 0; i < lats.length; i += 100) {
    const url = "https://api.open-meteo.com/v1/elevation?latitude=" + lats.slice(i, i + 100).join(",")
      + "&longitude=" + lngs.slice(i, i + 100).join(",");
    const response = await fetch(url);
    if (!response.ok) throw new Error("Elevation API " + response.status);
    elevations.push(...(await response.json()).elevation);
  }
  return locations.map((_, i) => {
    const group = elevations.slice(i * POINTS, i * POINTS + POINTS);
    return Math.max(...group) - Math.min(...group);
  });
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
      <div class="estimate">
        <span class="badge ${hike.estimate.difficulty}">${DIFFICULTY_HE[hike.estimate.difficulty]}</span>
        כ־${hike.estimate.km} ק״מ
        ${hike.estimate.source === "known"
          ? '<span class="est-note">לפי המאגר שלנו</span>'
          : '<span class="est-note" title="הערכה לפי סוג המקום והפרשי הגובה בסביבתו">הערכה</span>'}
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
    .filter((p) => !EXCLUDED_TYPES.includes(p.primaryType) && !isAbroad(p))
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
